//! DBNet text detector. Pipeline: RGBA input → resize to ≤960px long edge
//! (padded to multiple of 32) → normalise → NCHW float32 tensor → det.onnx →
//! probability map → polygon extraction.
//!
//! Polygon extraction (full inference path) arrives in Task 11.

use ndarray::Array4;

use crate::ocr::types::TextBox;

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
#[allow(dead_code)]
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

/// Stub for the full detect pipeline. Implementation arrives in Task 11.
#[allow(dead_code)]
pub fn detect_stub(_rgba: &[u8], _w: u32, _h: u32) -> Vec<TextBox> {
    Vec::new()
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
