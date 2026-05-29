use crate::types::Rect;
use anyhow::{bail, Result};

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
}
