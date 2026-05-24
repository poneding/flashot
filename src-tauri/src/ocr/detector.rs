//! DBNet text detector. Pipeline: RGBA input → resize to ≤960px long edge
//! (padded to multiple of 32) → normalise → NCHW float32 tensor → det.onnx →
//! probability map → polygon extraction.

use ndarray::Array4;
use ort::value::Tensor;

use crate::ocr::engine::Engine;
use crate::ocr::types::{OcrError, TextBox};

pub const MAX_LONG_EDGE: u32 = 960;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Resize so the long edge is at most `MAX_LONG_EDGE`, both edges are
/// multiples of 32 (DBNet requirement), and aspect ratio is preserved as
/// closely as possible. Returns `(resized_rgba, new_w, new_h, scale_x, scale_y)`
/// where `scale` lets the caller map polygon coordinates back into the
/// original image space (scale_x = original_w / new_w).
pub fn resize_for_det(rgba: &[u8], w: u32, h: u32) -> (Vec<u8>, u32, u32, f32, f32) {
    let long_edge = w.max(h);
    let ratio = if long_edge > MAX_LONG_EDGE {
        MAX_LONG_EDGE as f32 / long_edge as f32
    } else {
        1.0
    };
    let new_w = ((w as f32 * ratio).round() as u32).next_multiple_of(32).max(32);
    let new_h = ((h as f32 * ratio).round() as u32).next_multiple_of(32).max(32);

    let resized = resize_rgba_bilinear(rgba, w, h, new_w, new_h);
    let scale_x = w as f32 / new_w as f32;
    let scale_y = h as f32 / new_h as f32;
    (resized, new_w, new_h, scale_x, scale_y)
}

/// Bilinear resize of an RGBA buffer. We avoid pulling a full `image` op
/// dependency for this single function.
fn resize_rgba_bilinear(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    let mut dst = vec![0u8; (dw * dh * 4) as usize];
    let x_ratio = sw as f32 / dw as f32;
    let y_ratio = sh as f32 / dh as f32;
    for y in 0..dh {
        for x in 0..dw {
            let sx = (x as f32 + 0.5) * x_ratio - 0.5;
            let sy = (y as f32 + 0.5) * y_ratio - 0.5;
            let x0 = sx.floor().max(0.0) as u32;
            let y0 = sy.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(sw - 1);
            let y1 = (y0 + 1).min(sh - 1);
            let fx = sx - x0 as f32;
            let fy = sy - y0 as f32;
            for c in 0..4 {
                let p00 = src[((y0 * sw + x0) * 4 + c) as usize] as f32;
                let p10 = src[((y0 * sw + x1) * 4 + c) as usize] as f32;
                let p01 = src[((y1 * sw + x0) * 4 + c) as usize] as f32;
                let p11 = src[((y1 * sw + x1) * 4 + c) as usize] as f32;
                let top = p00 * (1.0 - fx) + p10 * fx;
                let bot = p01 * (1.0 - fx) + p11 * fx;
                dst[((y * dw + x) * 4 + c) as usize] = (top * (1.0 - fy) + bot * fy).round() as u8;
            }
        }
    }
    dst
}

/// Public wrapper around the bilinear resize so other OCR modules (e.g. the
/// recognizer in Task 12) can reuse it without going through detector's
/// resize_for_det path.
pub(crate) fn resize_rgba_bilinear_pub(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    resize_rgba_bilinear(src, sw, sh, dw, dh)
}

/// Build the NCHW float32 tensor expected by DBNet.
pub fn build_det_tensor(rgba: &[u8], w: u32, h: u32) -> Array4<f32> {
    let mut tensor = Array4::<f32>::zeros((1, 3, h as usize, w as usize));
    for y in 0..h as usize {
        for x in 0..w as usize {
            let off = (y * w as usize + x) * 4;
            for c in 0..3 {
                let v = rgba[off + c] as f32 / 255.0;
                tensor[[0, c, y, x]] = (v - MEAN[c]) / STD[c];
            }
        }
    }
    tensor
}

const DB_BINARIZE_THRESHOLD: f32 = 0.3;
const DB_BOX_THRESHOLD: f32 = 0.5;
const DB_UNCLIP_RATIO: f32 = 1.6;
const DB_MIN_EDGE: f32 = 3.0;

pub fn detect(rgba: &[u8], w: u32, h: u32) -> Result<Vec<TextBox>, OcrError> {
    let (resized, rw, rh, sx, sy) = resize_for_det(rgba, w, h);
    let tensor = build_det_tensor(&resized, rw, rh);

    let engine = Engine::global();
    let mut session = engine.det();
    let input_name = session.inputs[0].name.clone();
    let outputs = session
        .run(ort::inputs![input_name => Tensor::from_array(tensor)
            .map_err(|e| OcrError::InferenceFailed(e.to_string()))?])
        .map_err(|e| OcrError::InferenceFailed(e.to_string()))?;

    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| OcrError::InferenceFailed(e.to_string()))?;
    // Expected shape: [1, 1, rh, rw]
    debug_assert_eq!(&**shape, &[1i64, 1, rh as i64, rw as i64][..]);

    let polygons = polygons_from_probability_map(data, rw, rh);

    // Map polygon coordinates back to original image space.
    let mut out = Vec::with_capacity(polygons.len());
    for poly in polygons {
        let scaled = TextBox {
            points: [
                (poly.points[0].0 * sx, poly.points[0].1 * sy),
                (poly.points[1].0 * sx, poly.points[1].1 * sy),
                (poly.points[2].0 * sx, poly.points[2].1 * sy),
                (poly.points[3].0 * sx, poly.points[3].1 * sy),
            ],
        };
        if min_edge_length(&scaled) >= DB_MIN_EDGE {
            out.push(scaled);
        }
    }
    Ok(out)
}

fn min_edge_length(b: &TextBox) -> f32 {
    let mut min = f32::MAX;
    for i in 0..4 {
        let (x1, y1) = b.points[i];
        let (x2, y2) = b.points[(i + 1) % 4];
        let d = ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
        if d < min {
            min = d;
        }
    }
    min
}

/// Convert the DBNet probability map into a list of quadrilateral text boxes.
fn polygons_from_probability_map(prob: &[f32], w: u32, h: u32) -> Vec<TextBox> {
    // STEP 1: Binarise the probability map.
    let mut binary = vec![0u8; prob.len()];
    for (i, &p) in prob.iter().enumerate() {
        if p > DB_BINARIZE_THRESHOLD {
            binary[i] = 255;
        }
    }

    // STEP 2: Connected-component labelling on the binary map (4-connected).
    let img = image::GrayImage::from_raw(w, h, binary.clone()).expect("dims match");
    let labels = imageproc::region_labelling::connected_components(
        &img,
        imageproc::region_labelling::Connectivity::Four,
        image::Luma([0u8]),
    );

    // Collect points per label.
    use std::collections::HashMap;
    let mut groups: HashMap<u32, Vec<(f32, f32)>> = HashMap::new();
    for (x, y, pix) in labels.enumerate_pixels() {
        let label = pix[0];
        if label != 0 {
            groups
                .entry(label)
                .or_default()
                .push((x as f32, y as f32));
        }
    }

    // STEP 3: For each component, fit min-area rect and score it.
    let mut boxes = Vec::new();
    for (_label, pts) in groups {
        if pts.len() < 4 {
            continue;
        }
        let rect = min_area_rect(&pts);

        let score = mean_probability_in_box(&rect, prob, w, h);
        if score < DB_BOX_THRESHOLD {
            continue;
        }

        // STEP 4: Unclip the box outward by DB_UNCLIP_RATIO.
        let unclipped = unclip(&rect, DB_UNCLIP_RATIO);
        boxes.push(unclipped);
    }
    boxes
}

/// Minimum-area bounding rectangle around a point cloud.
///
/// v1 simplification: an axis-aligned bounding box. This works well for
/// upright screenshot text (the overwhelming case) but undersells rotated
/// text. A future iteration should replace with proper rotating-calipers
/// minAreaRect (OpenCV-style). Reference: RapidOCR `db_postprocess.py`
/// calls cv2.minAreaRect; oar-ocr's Rust port has a direct analogue.
///
/// Corner order: top-left, top-right, bottom-right, bottom-left.
fn min_area_rect(points: &[(f32, f32)]) -> TextBox {
    let (mut min_x, mut min_y) = (f32::MAX, f32::MAX);
    let (mut max_x, mut max_y) = (f32::MIN, f32::MIN);
    for &(x, y) in points {
        if x < min_x {
            min_x = x;
        }
        if y < min_y {
            min_y = y;
        }
        if x > max_x {
            max_x = x;
        }
        if y > max_y {
            max_y = y;
        }
    }
    TextBox {
        points: [
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ],
    }
}

/// Mean probability inside the axis-aligned bounding box of `b`. Cheap
/// approximation of OpenCV's polygon-mask version sufficient for filtering
/// noise components.
fn mean_probability_in_box(b: &TextBox, prob: &[f32], w: u32, _h: u32) -> f32 {
    let (mut min_x, mut min_y) = (f32::MAX, f32::MAX);
    let (mut max_x, mut max_y) = (f32::MIN, f32::MIN);
    for &(x, y) in &b.points {
        if x < min_x {
            min_x = x;
        }
        if y < min_y {
            min_y = y;
        }
        if x > max_x {
            max_x = x;
        }
        if y > max_y {
            max_y = y;
        }
    }
    let (xmin, ymin) = (min_x.floor().max(0.0) as u32, min_y.floor().max(0.0) as u32);
    let (xmax, ymax) = (max_x.ceil() as u32, max_y.ceil() as u32);
    let mut sum = 0.0f32;
    let mut count = 0u32;
    for y in ymin..ymax {
        for x in xmin..xmax {
            let idx = (y * w + x) as usize;
            if idx < prob.len() {
                sum += prob[idx];
                count += 1;
            }
        }
    }
    if count == 0 {
        0.0
    } else {
        sum / count as f32
    }
}

/// Outward dilation of a quadrilateral by `ratio`. v1 simplification:
/// scale each corner outward from the box centroid by `ratio`. This is
/// looser than a proper Vatti clipping unclip (used by PaddleOCR's
/// pyclipper.PyclipperOffset) and may produce slightly oversized boxes,
/// but it's adequate for v1 recognition accuracy on screenshot text.
fn unclip(b: &TextBox, ratio: f32) -> TextBox {
    let cx = b.points.iter().map(|p| p.0).sum::<f32>() / 4.0;
    let cy = b.points.iter().map(|p| p.1).sum::<f32>() / 4.0;
    let mut out = b.points;
    for p in out.iter_mut() {
        p.0 = cx + (p.0 - cx) * ratio;
        p.1 = cy + (p.1 - cy) * ratio;
    }
    TextBox { points: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_preserves_smaller_images() {
        let rgba = vec![128u8; 64 * 64 * 4];
        let (_, w, h, sx, sy) = resize_for_det(&rgba, 64, 64);
        assert_eq!(w % 32, 0);
        assert_eq!(h % 32, 0);
        assert!((sx - 64.0 / w as f32).abs() < 1e-6);
        assert!((sy - 64.0 / h as f32).abs() < 1e-6);
    }

    #[test]
    fn resize_clamps_long_edge_to_960() {
        let rgba = vec![0u8; (2000 * 1000 * 4) as usize];
        let (_, w, h, _, _) = resize_for_det(&rgba, 2000, 1000);
        assert!(w <= 960);
        assert!(w % 32 == 0);
        assert!(h % 32 == 0);
        assert!((w as f32 / h as f32 - 2.0).abs() < 0.1);
    }

    #[test]
    fn det_tensor_shape() {
        let rgba = vec![255u8; 32 * 32 * 4];
        let t = build_det_tensor(&rgba, 32, 32);
        assert_eq!(t.dim(), (1, 3, 32, 32));
        // Normalisation makes pure white pixels approximately (1 - mean) / std.
        let expected = (1.0 - MEAN[0]) / STD[0];
        assert!((t[[0, 0, 0, 0]] - expected).abs() < 1e-4);
    }
}
