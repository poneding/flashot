//! CRNN text recogniser. One crop in → one (text, confidence) out.

use ndarray::Array4;
use ort::value::Tensor;

use crate::ocr::engine::Engine;
use crate::ocr::types::OcrError;

const REC_HEIGHT: u32 = 48;
const REC_MIN_WIDTH: u32 = 320;
const REC_MAX_WIDTH: u32 = 1536;

/// Resize a text-line crop to a bounded dynamic width while preserving aspect ratio.
pub fn build_rec_tensor(rgba: &[u8], w: u32, h: u32) -> Array4<f32> {
    let aspect = w as f32 / h as f32;
    let target_w = ((REC_HEIGHT as f32 * aspect).ceil() as u32).clamp(REC_MIN_WIDTH, REC_MAX_WIDTH);

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
    let output_name = session
        .outputs
        .first()
        .ok_or_else(|| OcrError::InferenceFailed("recognizer session has no outputs".into()))?
        .name
        .clone();
    let outputs = session
        .run(ort::inputs![input_name => Tensor::from_array(tensor)
            .map_err(|e| OcrError::InferenceFailed(e.to_string()))?])
        .map_err(|e| OcrError::InferenceFailed(e.to_string()))?;

    let output = outputs
        .get(&output_name)
        .ok_or_else(|| OcrError::InferenceFailed("recognizer returned no outputs".into()))?;
    let (shape, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|e| OcrError::InferenceFailed(e.to_string()))?;
    let (t, c) = validate_rec_output_shape(shape, data.len(), engine.rec_keys())?;
    // outputs/session are kept alive across `ctc_greedy_decode` because `data`
    // borrows from `outputs`; scope end handles drop.
    let result = ctc_greedy_decode(data, t, c, engine.rec_keys());
    Ok(result)
}

fn validate_rec_output_shape(
    shape: &[i64],
    data_len: usize,
    keys: &[String],
) -> Result<(usize, usize), OcrError> {
    if shape.len() != 3 || shape[0] != 1 || shape[1] <= 0 || shape[2] <= 0 {
        return Err(OcrError::InferenceFailed(format!(
            "unexpected recognizer output shape: {shape:?}"
        )));
    }

    let t = shape[1] as usize;
    let c = shape[2] as usize;
    let expected_len = t
        .checked_mul(c)
        .ok_or_else(|| OcrError::InferenceFailed("recognizer output dimensions overflow".into()))?;
    if data_len != expected_len {
        return Err(OcrError::InferenceFailed(format!(
            "unexpected recognizer output length: expected {expected_len}, got {data_len}"
        )));
    }
    if c > keys.len() {
        return Err(OcrError::InferenceFailed(format!(
            "recognizer class count {c} exceeds key table length {}",
            keys.len()
        )));
    }

    Ok((t, c))
}

/// CTC greedy decode: argmax per timestep, collapse consecutive duplicates,
/// drop blanks (index 0). Confidence is mean of kept timestep probabilities.
pub fn ctc_greedy_decode(logits: &[f32], t: usize, c: usize, keys: &[String]) -> (String, f32) {
    let mut text = String::new();
    let mut probs = Vec::<f32>::new();
    let mut prev = usize::MAX;
    for ti in 0..t {
        let row = &logits[ti * c..(ti + 1) * c];
        let (mut max_idx, mut max_val) = (0usize, f32::NEG_INFINITY);
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
    fn rec_tensor_uses_minimum_width_for_short_crops() {
        let rgba = vec![255u8; 20 * 20 * 4];

        let tensor = build_rec_tensor(&rgba, 20, 20);

        assert_eq!(
            tensor.dim(),
            (1, 3, REC_HEIGHT as usize, REC_MIN_WIDTH as usize)
        );
    }

    #[test]
    fn rec_tensor_caps_very_long_crops() {
        let rgba = vec![255u8; 2000 * 20 * 4];

        let tensor = build_rec_tensor(&rgba, 2000, 20);

        assert_eq!(
            tensor.dim(),
            (1, 3, REC_HEIGHT as usize, REC_MAX_WIDTH as usize)
        );
    }

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

    #[test]
    fn ctc_decode_keeps_non_consecutive_duplicates() {
        // keys: ["", "a", "b"]
        let keys = vec!["".into(), "a".into(), "b".into()];
        // Sequence a, b, a → "aba" (a repeats are separated by b, so both kept)
        let mut logits = vec![0.0; 3 * 3];
        let set = |logits: &mut Vec<f32>, t: usize, idx: usize, v: f32| {
            logits[t * 3 + idx] = v;
        };
        set(&mut logits, 0, 1, 5.0); // a
        set(&mut logits, 1, 2, 5.0); // b
        set(&mut logits, 2, 1, 5.0); // a
        let (text, _conf) = ctc_greedy_decode(&logits, 3, 3, &keys);
        assert_eq!(text, "aba");
    }

    #[test]
    fn recognizer_output_shape_validation_rejects_bad_lengths() {
        let keys = vec!["".into(), "a".into()];
        let err = validate_rec_output_shape(&[1, 3, 2], 5, &keys).unwrap_err();

        assert!(matches!(err, OcrError::InferenceFailed(_)));
        assert!(err
            .to_string()
            .contains("unexpected recognizer output length"));
    }

    #[test]
    fn recognizer_output_shape_validation_rejects_unknown_classes() {
        let keys = vec!["".into(), "a".into()];
        let err = validate_rec_output_shape(&[1, 3, 4], 12, &keys).unwrap_err();

        assert!(matches!(err, OcrError::InferenceFailed(_)));
        assert!(err.to_string().contains("exceeds key table length"));
    }
}
