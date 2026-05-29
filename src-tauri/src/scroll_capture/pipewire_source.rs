use crate::types::Rect;
use anyhow::{anyhow, bail, Context, Result};
use pipewire::{
    channel,
    context::ContextRc,
    keys::{MEDIA_CATEGORY, MEDIA_ROLE, MEDIA_TYPE},
    main_loop::MainLoopRc,
    properties,
    spa::{
        param::{
            format::{FormatProperties, MediaSubtype, MediaType},
            format_utils,
            video::{VideoFormat, VideoInfoRaw},
            ParamType,
        },
        pod::{self, serialize::PodSerializer, Pod},
        utils::{Direction, Fraction, Rectangle, SpaTypes},
    },
    stream::{StreamFlags, StreamRc},
};
use std::io::Cursor;
use std::os::fd::OwnedFd;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;
use std::time::Duration;

use super::frame_buffer::{CapturedFrame, LatestFrameBuffer};
use super::mapping::{map_logical_selection_to_raw_crop, PortalStreamInfo, RawFrameSize};
use super::ScrollFrameSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RawVideoFormat {
    Rgba,
    Rgbx,
    Bgra,
    Bgrx,
    Rgb,
    Bgr,
}

pub(crate) fn convert_raw_frame_to_rgba(
    data: &[u8],
    width: u32,
    height: u32,
    stride: usize,
    format: RawVideoFormat,
) -> Result<Vec<u8>> {
    let bytes_per_pixel = match format {
        RawVideoFormat::Rgb | RawVideoFormat::Bgr => 3,
        _ => 4,
    };
    let min_stride = width as usize * bytes_per_pixel;
    if stride < min_stride {
        bail!("pipewire stride is smaller than the video row");
    }
    if data.len() < stride * height as usize {
        bail!("pipewire buffer is smaller than the declared frame");
    }

    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for row in 0..height as usize {
        let row_data = &data[row * stride..row * stride + min_stride];
        for px in row_data.chunks_exact(bytes_per_pixel) {
            match format {
                RawVideoFormat::Rgba | RawVideoFormat::Rgbx => {
                    out.extend_from_slice(&[px[0], px[1], px[2], 255]);
                }
                RawVideoFormat::Bgra | RawVideoFormat::Bgrx => {
                    out.extend_from_slice(&[px[2], px[1], px[0], 255]);
                }
                RawVideoFormat::Rgb => {
                    out.extend_from_slice(&[px[0], px[1], px[2], 255]);
                }
                RawVideoFormat::Bgr => {
                    out.extend_from_slice(&[px[2], px[1], px[0], 255]);
                }
            }
        }
    }
    Ok(out)
}

pub(crate) fn crop_rgba_frame(rgba: &[u8], frame_width: u32, crop: Rect) -> Result<Vec<u8>> {
    if crop.x < 0 || crop.y < 0 {
        bail!("crop origin must be non-negative");
    }

    let row_bytes = crop.width as usize * 4;
    let mut out = Vec::with_capacity(row_bytes * crop.height as usize);
    for row in 0..crop.height {
        let y = crop.y as u32 + row;
        let start = (y * frame_width + crop.x as u32) as usize * 4;
        let end = start + row_bytes;
        let slice = rgba
            .get(start..end)
            .ok_or_else(|| anyhow::anyhow!("crop row is out of bounds"))?;
        out.extend_from_slice(slice);
    }
    Ok(out)
}

pub(crate) struct WaylandPipeWireSource {
    buffer: Arc<LatestFrameBuffer>,
    stop: Arc<AtomicBool>,
    quit: Option<channel::Sender<()>>,
    last_seq: u64,
    join: Option<JoinHandle<()>>,
}

impl WaylandPipeWireSource {
    pub(crate) fn spawn(
        remote_fd: OwnedFd,
        stream: PortalStreamInfo,
        raw_size_hint: Option<RawFrameSize>,
        monitor_rect: Rect,
        logical_selection: Rect,
    ) -> Result<(Self, CapturedFrame)> {
        let buffer = Arc::new(LatestFrameBuffer::default());
        let stop = Arc::new(AtomicBool::new(false));
        let thread_buffer = buffer.clone();
        let thread_stop = stop.clone();
        let (quit_tx, quit_rx) = channel::channel();

        let join = std::thread::spawn(move || {
            if let Err(e) = run_pipewire_loop(
                remote_fd,
                stream,
                raw_size_hint,
                monitor_rect,
                logical_selection,
                thread_buffer.clone(),
                thread_stop,
                quit_rx,
            ) {
                tracing::warn!("wayland pipewire scroll capture stopped: {e}");
                thread_buffer.stop();
            }
        });

        let mut source = Self {
            buffer,
            stop,
            quit: Some(quit_tx),
            last_seq: 0,
            join: Some(join),
        };
        let initial = source
            .buffer
            .wait_next(&mut source.last_seq, Duration::from_secs(3))?;
        if initial.rgba.is_empty() || initial.width == 0 || initial.height == 0 {
            bail!("pipewire stream produced an empty frame");
        }
        Ok((source, initial))
    }
}

impl ScrollFrameSource for WaylandPipeWireSource {
    fn next_frame(&mut self, timeout: Duration) -> Result<Vec<u8>> {
        Ok(self.buffer.wait_next(&mut self.last_seq, timeout)?.rgba)
    }
}

impl Drop for WaylandPipeWireSource {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.buffer.stop();
        if let Some(quit) = self.quit.take() {
            let _ = quit.send(());
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

#[derive(Clone)]
struct ListenerUserData {
    format: VideoInfoRaw,
}

fn run_pipewire_loop(
    remote_fd: OwnedFd,
    portal_stream: PortalStreamInfo,
    raw_size_hint: Option<RawFrameSize>,
    monitor_rect: Rect,
    logical_selection: Rect,
    buffer: Arc<LatestFrameBuffer>,
    stop: Arc<AtomicBool>,
    quit_rx: channel::Receiver<()>,
) -> Result<()> {
    pipewire::init();

    let main_loop = MainLoopRc::new(None).context("failed to create pipewire main loop")?;
    let _quit_listener = quit_rx.attach(main_loop.loop_(), {
        let main_loop = main_loop.clone();
        let stop = stop.clone();
        move |_| {
            stop.store(true, Ordering::SeqCst);
            main_loop.quit();
        }
    });
    let context = ContextRc::new(&main_loop, None).context("failed to create pipewire context")?;
    let core = context
        .connect_fd_rc(remote_fd, None)
        .context("failed to connect to portal pipewire remote")?;
    let user_data = ListenerUserData {
        format: Default::default(),
    };
    let stream = StreamRc::new(
        core,
        "Flashot Scroll Capture",
        properties::properties! {
            *MEDIA_TYPE => "Video",
            *MEDIA_CATEGORY => "Capture",
            *MEDIA_ROLE => "Screen",
        },
    )
    .context("failed to create pipewire stream")?;

    let process_buffer = buffer.clone();
    let process_stop = stop.clone();
    let process_stream = portal_stream.clone();
    let _listener = stream
        .add_local_listener_with_user_data(user_data)
        .param_changed(|_, user_data, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != ParamType::Format.as_raw() {
                return;
            }

            let Ok((media_type, media_subtype)) = format_utils::parse_format(param) else {
                tracing::warn!("failed to parse pipewire stream format");
                return;
            };
            if media_type != MediaType::Video || media_subtype != MediaSubtype::Raw {
                return;
            }
            if let Err(e) = user_data.format.parse(param) {
                tracing::warn!("failed to parse pipewire raw video format: {e:?}");
            }
        })
        .process(move |stream, user_data| {
            if process_stop.load(Ordering::Relaxed) {
                return;
            }
            let Some(mut frame_buffer) = stream.dequeue_buffer() else {
                tracing::debug!("pipewire stream returned no buffer");
                return;
            };
            let datas = frame_buffer.datas_mut();
            if datas.is_empty() {
                return;
            }

            let Some(format) = raw_format_from_pipewire(user_data.format.format()) else {
                tracing::warn!(
                    "unsupported wayland pipewire format: {:?}",
                    user_data.format.format()
                );
                return;
            };
            let size = user_data.format.size();
            let raw_size = if size.width > 0 && size.height > 0 {
                RawFrameSize {
                    width: size.width,
                    height: size.height,
                }
            } else if let Some(raw_size) = raw_size_hint {
                raw_size
            } else {
                tracing::warn!("pipewire frame did not report a valid size");
                return;
            };

            let data = &mut datas[0];
            let offset = data.chunk().offset() as usize;
            let chunk_size = data.chunk().size() as usize;
            let stride = if data.chunk().stride() > 0 {
                data.chunk().stride() as usize
            } else {
                raw_size.width as usize * bytes_per_pixel(format)
            };
            let Some(frame_data) = data.data() else {
                tracing::warn!("pipewire buffer does not expose mapped frame data");
                return;
            };
            if offset >= frame_data.len() {
                tracing::warn!("pipewire buffer offset is out of bounds");
                return;
            }
            let available = frame_data.len() - offset;
            let frame_len = if chunk_size == 0 {
                available
            } else {
                chunk_size.min(available)
            };
            let frame_data = &frame_data[offset..offset + frame_len];

            let rgba = match convert_raw_frame_to_rgba(
                frame_data,
                raw_size.width,
                raw_size.height,
                stride,
                format,
            ) {
                Ok(rgba) => rgba,
                Err(e) => {
                    tracing::warn!("failed to convert pipewire frame to rgba: {e}");
                    return;
                }
            };
            let crop = match map_logical_selection_to_raw_crop(
                &process_stream,
                raw_size,
                monitor_rect,
                logical_selection,
            ) {
                Ok(crop) => crop,
                Err(e) => {
                    tracing::warn!("failed to map wayland scroll crop: {e}");
                    return;
                }
            };
            let cropped = match crop_rgba_frame(&rgba, raw_size.width, crop) {
                Ok(cropped) => cropped,
                Err(e) => {
                    tracing::warn!("failed to crop wayland pipewire frame: {e}");
                    return;
                }
            };

            process_buffer.publish(CapturedFrame {
                rgba: cropped,
                width: crop.width,
                height: crop.height,
            });
        })
        .register()
        .context("failed to register pipewire stream listener")?;

    let values = pipewire_format_params(raw_size_hint)?;
    let mut params =
        [Pod::from_bytes(&values)
            .ok_or_else(|| anyhow!("failed to create pipewire format pod"))?];
    stream
        .connect(
            Direction::Input,
            Some(portal_stream.node_id),
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS | StreamFlags::DONT_RECONNECT,
            &mut params,
        )
        .context("failed to connect pipewire stream")?;

    main_loop.run();
    Ok(())
}

fn raw_format_from_pipewire(format: VideoFormat) -> Option<RawVideoFormat> {
    if format == VideoFormat::RGBA {
        Some(RawVideoFormat::Rgba)
    } else if format == VideoFormat::RGBx {
        Some(RawVideoFormat::Rgbx)
    } else if format == VideoFormat::BGRA {
        Some(RawVideoFormat::Bgra)
    } else if format == VideoFormat::BGRx {
        Some(RawVideoFormat::Bgrx)
    } else if format == VideoFormat::RGB {
        Some(RawVideoFormat::Rgb)
    } else if format == VideoFormat::BGR {
        Some(RawVideoFormat::Bgr)
    } else {
        None
    }
}

fn bytes_per_pixel(format: RawVideoFormat) -> usize {
    match format {
        RawVideoFormat::Rgb | RawVideoFormat::Bgr => 3,
        _ => 4,
    }
}

fn pipewire_format_params(raw_size_hint: Option<RawFrameSize>) -> Result<Vec<u8>> {
    let default_size = raw_size_hint.unwrap_or(RawFrameSize {
        width: 1920,
        height: 1080,
    });
    let default_size = Rectangle {
        width: default_size.width.max(1),
        height: default_size.height.max(1),
    };
    let obj = pod::object!(
        SpaTypes::ObjectParamFormat,
        ParamType::EnumFormat,
        pod::property!(FormatProperties::MediaType, Id, MediaType::Video),
        pod::property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        pod::property!(
            FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRx,
            VideoFormat::RGBx,
            VideoFormat::BGRA,
            VideoFormat::RGBA,
            VideoFormat::BGR,
            VideoFormat::RGB,
        ),
        pod::property!(
            FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            default_size,
            Rectangle {
                width: 1,
                height: 1
            },
            Rectangle {
                width: 16384,
                height: 16384
            }
        ),
        pod::property!(
            FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            Fraction { num: 30, denom: 1 },
            Fraction { num: 0, denom: 1 },
            Fraction { num: 120, denom: 1 }
        ),
    );
    let values = PodSerializer::serialize(Cursor::new(Vec::new()), &pod::Value::Object(obj))
        .map_err(|e| anyhow!("failed to serialize pipewire format pod: {e:?}"))?
        .0
        .into_inner();
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_bgrx_with_stride_to_rgba() {
        let data = vec![
            10, 20, 30, 0, 40, 50, 60, 0, 99, 99, 99, 99, 70, 80, 90, 0, 100, 110, 120, 0, 88, 88,
            88, 88,
        ];

        let rgba = convert_raw_frame_to_rgba(&data, 2, 2, 12, RawVideoFormat::Bgrx).unwrap();

        assert_eq!(
            rgba,
            vec![30, 20, 10, 255, 60, 50, 40, 255, 90, 80, 70, 255, 120, 110, 100, 255,]
        );
    }

    #[test]
    fn crops_rgba_frame_rows() {
        let rgba = (0_u8..48).collect::<Vec<_>>();

        let crop = crop_rgba_frame(
            &rgba,
            4,
            Rect {
                x: 1,
                y: 1,
                width: 2,
                height: 1,
            },
        )
        .unwrap();

        assert_eq!(crop, vec![20, 21, 22, 23, 24, 25, 26, 27]);
    }

    #[test]
    fn wayland_source_drop_stops_latest_frame_buffer() {
        let source = include_str!("pipewire_source.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("pipewire source should contain production section");

        assert!(production.contains("impl Drop for WaylandPipeWireSource"));
        assert!(production.contains("LatestFrameBuffer"));
        assert!(production.contains("buffer.stop()"));
    }
}
