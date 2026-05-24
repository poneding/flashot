//! CRNN text recogniser. One crop in → one (text, confidence) out.

use ndarray::Array4;
use ort::value::Tensor;

use crate::ocr::engine::Engine;
use crate::ocr::types::OcrError;

const REC_HEIGHT: u32 = 48;
const REC_MIN_WIDTH: u32 = 320;

/// Resize a text-line crop to (REC_HEIGHT, W) where W = max(REC_MIN_WIDTH,
/// REC_HEIGHT * aspect). Returns NCHW float32 tensor normalised to [-1, 1].
pub fn build_rec_tensor(rgba: &[u8], w: u32, h: u32) -> Array4<f32> {
    let aspect = w as f32 / h as f32;
    let target_w = ((REC_HEIGHT as f32 * aspect).round() as u32).max(REC_MIN_WIDTH);

    let resized = super::detector::resize_rgba_bilinear_pub(rgba, w, h, target_w, REC_HEIGHT);
    let mut tensor = Array4::<f32>::zeros((1, 3, REC_HEIGHT as usize, target_w as usize));
    for y in 0..REC_HEIGHT as usize {
        for x in 0..target_w as usize {
            let off = (y * target_w as usize + x) * 4;
            for c in 0..3 {
                let v = resized[off + c] as f32 / 255.0;
                tensor[[0, c, y, x]] = (v - 0.5) / 0.5;
            }
        }
    }
    tensor
}

pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<(String, f32), OcrError> {
    let tensor = build_rec_tensor(rgba, w, h);
    let engine = Engine::global();
    let mut session = engine.rec();
    let input_name = session.inputs[0].name.clone();
    let outputs = session
        .run(ort::inputs![input_name => Tensor::from_array(tensor)
            .map_err(|e| OcrError::InferenceFailed(e.to_string()))?])
        .map_err(|e| OcrError::InferenceFailed(e.to_string()))?;

    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| OcrError::InferenceFailed(e.to_string()))?;
    // Expected shape: [1, T, C]
    debug_assert_eq!(shape.len(), 3);
    let t = shape[1] as usize;
    let c = shape[2] as usize;
    // Decode while `session` and `outputs` are still alive — `data` borrows
    // from `outputs[0]` and that borrow must outlive `ctc_greedy_decode`.
    let result = ctc_greedy_decode(data, t, c, engine.rec_keys());
    drop(outputs);
    drop(session);
    Ok(result)
}

/// CTC greedy decode: argmax per timestep, collapse consecutive duplicates,
/// drop blanks (index 0). Confidence is mean of kept timestep probabilities.
pub fn ctc_greedy_decode(logits: &[f32], t: usize, c: usize, keys: &[String]) -> (String, f32) {
    let mut text = String::new();
    let mut probs = Vec::<f32>::new();
    let mut prev = usize::MAX;
    for ti in 0..t {
        let row = &logits[ti * c..(ti + 1) * c];
        let (mut max_idx, mut max_val) = (0usize, f32::MIN);
        for (i, &v) in row.iter().enumerate() {
            if v > max_val {
                max_val = v;
                max_idx = i;
            }
        }
        if max_idx != 0 && max_idx != prev {
            if let Some(ch) = keys.get(max_idx) {
                text.push_str(ch);
                probs.push(max_val);
            }
        }
        prev = max_idx;
    }
    let conf = if probs.is_empty() {
        0.0
    } else {
        probs.iter().sum::<f32>() / probs.len() as f32
    };
    (text, conf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ctc_decode_collapses_repeats_and_drops_blanks() {
        // keys: ["", "a", "b", "c"]
        let keys = vec!["".into(), "a".into(), "b".into(), "c".into()];
        // 5 timesteps, 4 classes; argmax sequence = [a, a, blank, b, c]
        // Expected output: "abc"
        let mut logits = vec![0.0; 5 * 4];
        let set = |logits: &mut Vec<f32>, t: usize, idx: usize, v: f32| {
            logits[t * 4 + idx] = v;
        };
        set(&mut logits, 0, 1, 5.0); // a
        set(&mut logits, 1, 1, 5.0); // a (dup, dropped)
        set(&mut logits, 2, 0, 5.0); // blank
        set(&mut logits, 3, 2, 5.0); // b
        set(&mut logits, 4, 3, 5.0); // c
        let (text, conf) = ctc_greedy_decode(&logits, 5, 4, &keys);
        assert_eq!(text, "abc");
        assert!((conf - 5.0).abs() < 1e-6);
    }

    #[test]
    fn ctc_decode_empty_for_all_blanks() {
        let keys = vec!["".into(), "a".into()];
        let logits = vec![5.0, 0.0, 5.0, 0.0, 5.0, 0.0]; // 3 timesteps, all blank
        let (text, conf) = ctc_greedy_decode(&logits, 3, 2, &keys);
        assert!(text.is_empty());
        assert_eq!(conf, 0.0);
    }
}
