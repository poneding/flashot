use crate::types::Rect;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PortalStreamInfo {
    pub node_id: u32,
    pub position: Option<(i32, i32)>,
    pub size: Option<(i32, i32)>,
    pub source_type_monitor: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RawFrameSize {
    pub width: u32,
    pub height: u32,
}

pub(crate) fn choose_monitor_stream(
    streams: &[PortalStreamInfo],
    monitor_rect: Rect,
) -> Option<PortalStreamInfo> {
    streams
        .iter()
        .filter(|s| s.source_type_monitor)
        .find(|s| stream_contains_monitor_center(s, monitor_rect))
        .cloned()
        .or_else(|| {
            streams
                .iter()
                .filter(|s| s.source_type_monitor)
                .find(|s| stream_matches_monitor_bounds(s, monitor_rect))
                .cloned()
        })
        .or_else(|| {
            let mut monitor_streams = streams.iter().filter(|s| s.source_type_monitor);
            let first = monitor_streams.next()?;
            monitor_streams.next().is_none().then(|| first.clone())
        })
}

fn stream_contains_monitor_center(stream: &PortalStreamInfo, monitor_rect: Rect) -> bool {
    let Some((sx, sy)) = stream.position else {
        return false;
    };
    let Some((sw, sh)) = stream.size else {
        return false;
    };
    let cx = monitor_rect.x + monitor_rect.width as i32 / 2;
    let cy = monitor_rect.y + monitor_rect.height as i32 / 2;
    cx >= sx && cy >= sy && cx < sx + sw && cy < sy + sh
}

fn stream_matches_monitor_bounds(stream: &PortalStreamInfo, monitor_rect: Rect) -> bool {
    stream.position == Some((monitor_rect.x, monitor_rect.y))
        && stream.size == Some((monitor_rect.width as i32, monitor_rect.height as i32))
}

pub(crate) fn map_logical_selection_to_raw_crop(
    stream: &PortalStreamInfo,
    raw: RawFrameSize,
    monitor_rect: Rect,
    selection: Rect,
) -> anyhow::Result<Rect> {
    let (sx, sy) = stream.position.unwrap_or((monitor_rect.x, monitor_rect.y));
    let (logical_w, logical_h) = stream.size.unwrap_or((
        monitor_rect.width as i32,
        monitor_rect.height as i32,
    ));
    if logical_w <= 0 || logical_h <= 0 {
        anyhow::bail!("portal stream has invalid logical size");
    }

    let scale_x = raw.width as f32 / logical_w as f32;
    let scale_y = raw.height as f32 / logical_h as f32;
    let x = ((monitor_rect.x + selection.x - sx) as f32 * scale_x).round() as i32;
    let y = ((monitor_rect.y + selection.y - sy) as f32 * scale_y).round() as i32;
    let width = (selection.width as f32 * scale_x).round().max(1.0) as u32;
    let height = (selection.height as f32 * scale_y).round().max(1.0) as u32;

    Ok(clamp_rect_to_raw(Rect { x, y, width, height }, raw))
}

fn clamp_rect_to_raw(rect: Rect, raw: RawFrameSize) -> Rect {
    let width = rect.width.min(raw.width);
    let height = rect.height.min(raw.height);
    let max_x = raw.width.saturating_sub(width) as i32;
    let max_y = raw.height.saturating_sub(height) as i32;
    Rect {
        x: rect.x.clamp(0, max_x),
        y: rect.y.clamp(0, max_y),
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooses_stream_containing_monitor_center() {
        let streams = vec![
            PortalStreamInfo {
                node_id: 1,
                position: Some((0, 0)),
                size: Some((1920, 1080)),
                source_type_monitor: true,
            },
            PortalStreamInfo {
                node_id: 2,
                position: Some((1920, 0)),
                size: Some((2560, 1440)),
                source_type_monitor: true,
            },
        ];

        let chosen = choose_monitor_stream(
            &streams,
            Rect {
                x: 1920,
                y: 0,
                width: 2560,
                height: 1440,
            },
        )
        .unwrap();

        assert_eq!(chosen.node_id, 2);
    }

    #[test]
    fn maps_fractional_scale_selection_to_raw_crop() {
        let stream = PortalStreamInfo {
            node_id: 7,
            position: Some((0, 0)),
            size: Some((1600, 900)),
            source_type_monitor: true,
        };

        let crop = map_logical_selection_to_raw_crop(
            &stream,
            RawFrameSize {
                width: 2400,
                height: 1350,
            },
            Rect {
                x: 0,
                y: 0,
                width: 1600,
                height: 900,
            },
            Rect {
                x: 100,
                y: 50,
                width: 300,
                height: 200,
            },
        )
        .unwrap();

        assert_eq!(
            (crop.x, crop.y, crop.width, crop.height),
            (150, 75, 450, 300)
        );
    }
}
