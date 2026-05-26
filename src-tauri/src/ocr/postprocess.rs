//! Pure functions over recognised lines: sort by reading order, concatenate
//! into a single text buffer, filter low-confidence noise.

use crate::ocr::types::{OcrLine, TextBox};

const CONFIDENCE_FLOOR: f32 = 0.5;

/// Sort lines into reading order: top-to-bottom by y, then left-to-right by x
/// within rows that overlap vertically. Two boxes are considered "same row" if
/// their y-centers are within half the shorter height.
pub fn sort_reading_order(mut lines: Vec<OcrLine>) -> Vec<OcrLine> {
    lines.sort_by(|a, b| {
        let ay = bbox_center_y(&a.bbox);
        let by = bbox_center_y(&b.bbox);
        let ah = bbox_height(&a.bbox);
        let bh = bbox_height(&b.bbox);
        let overlap = (ay - by).abs() < ah.min(bh) * 0.5;
        if overlap {
            bbox_min_x(&a.bbox)
                .partial_cmp(&bbox_min_x(&b.bbox))
                .unwrap()
        } else {
            ay.partial_cmp(&by).unwrap()
        }
    });
    lines
}

/// Drop lines with confidence below CONFIDENCE_FLOOR.
pub fn filter_low_confidence(lines: Vec<OcrLine>) -> Vec<OcrLine> {
    lines
        .into_iter()
        .filter(|l| l.confidence >= CONFIDENCE_FLOOR)
        .collect()
}

/// Concatenate line texts, separating rows with '\n'. Adjacent lines whose
/// y-spans overlap (i.e. "same row") are joined with a single space instead.
pub fn concatenate(lines: &[OcrLine]) -> String {
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        let text = line.text.trim();
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            let prev = &lines[i - 1];
            let same_row = (bbox_center_y(&line.bbox) - bbox_center_y(&prev.bbox)).abs()
                < bbox_height(&line.bbox).min(bbox_height(&prev.bbox)) * 0.5;
            out.push(if same_row { ' ' } else { '\n' });
        }
        out.push_str(text);
    }
    out
}

fn bbox_center_y(b: &TextBox) -> f32 {
    b.points.iter().map(|p| p.1).sum::<f32>() / 4.0
}
fn bbox_height(b: &TextBox) -> f32 {
    let ys: Vec<f32> = b.points.iter().map(|p| p.1).collect();
    ys.iter().cloned().fold(f32::MIN, f32::max) - ys.iter().cloned().fold(f32::MAX, f32::min)
}
fn bbox_min_x(b: &TextBox) -> f32 {
    b.points.iter().map(|p| p.0).fold(f32::MAX, f32::min)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, conf: f32, cx: f32, cy: f32, w: f32, h: f32) -> OcrLine {
        OcrLine {
            text: text.into(),
            confidence: conf,
            bbox: TextBox {
                points: [
                    (cx - w / 2.0, cy - h / 2.0),
                    (cx + w / 2.0, cy - h / 2.0),
                    (cx + w / 2.0, cy + h / 2.0),
                    (cx - w / 2.0, cy + h / 2.0),
                ],
            },
        }
    }

    #[test]
    fn sort_orders_top_to_bottom_then_left_to_right() {
        let l = vec![
            line("b", 1.0, 100.0, 50.0, 30.0, 20.0), // row 1, right
            line("c", 1.0, 50.0, 100.0, 30.0, 20.0), // row 2
            line("a", 1.0, 50.0, 50.0, 30.0, 20.0),  // row 1, left
        ];
        let sorted = sort_reading_order(l);
        assert_eq!(
            sorted.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn filter_drops_low_confidence() {
        let l = vec![
            line("keep", 0.9, 0.0, 0.0, 10.0, 10.0),
            line("drop", 0.3, 0.0, 0.0, 10.0, 10.0),
        ];
        let kept = filter_low_confidence(l);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].text, "keep");
    }

    #[test]
    fn concatenate_uses_space_within_row_newline_between_rows() {
        let l = vec![
            line("hello", 1.0, 50.0, 50.0, 30.0, 20.0),
            line("world", 1.0, 100.0, 50.0, 30.0, 20.0), // same row
            line("foo", 1.0, 50.0, 100.0, 30.0, 20.0),   // next row
        ];
        let text = concatenate(&l);
        assert_eq!(text, "hello world\nfoo");
    }

    #[test]
    fn concatenate_trims_each_line() {
        let l = vec![line("  hi  ", 1.0, 50.0, 50.0, 30.0, 20.0)];
        assert_eq!(concatenate(&l), "hi");
    }
}
