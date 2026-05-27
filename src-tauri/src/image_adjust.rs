use crate::types::ImageAdjustments;

pub fn apply_image_adjustments(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    adjustments: ImageAdjustments,
) {
    let adjustments = normalize_adjustments(adjustments);
    let pixel_count = width as usize * height as usize;
    if pixel_count == 0 || rgba.len() < pixel_count * 4 || is_no_op(adjustments) {
        return;
    }

    if adjustments.auto_levels {
        apply_auto_levels(rgba, pixel_count);
    }

    for px in rgba.chunks_exact_mut(4).take(pixel_count) {
        let mut r = px[0] as f32;
        let mut g = px[1] as f32;
        let mut b = px[2] as f32;

        if adjustments.grayscale {
            let gray = luminance(r, g, b);
            r = gray;
            g = gray;
            b = gray;
        }

        if adjustments.brightness != 0 {
            let offset = adjustments.brightness as f32 * 255.0 / 100.0;
            r += offset;
            g += offset;
            b += offset;
        }

        if adjustments.contrast != 0 {
            let factor = 1.0 + adjustments.contrast as f32 / 100.0;
            r = (r - 128.0) * factor + 128.0;
            g = (g - 128.0) * factor + 128.0;
            b = (b - 128.0) * factor + 128.0;
        }

        if adjustments.saturation != 0 {
            let factor = 1.0 + adjustments.saturation as f32 / 100.0;
            let gray = luminance(r, g, b);
            r = gray + (r - gray) * factor;
            g = gray + (g - gray) * factor;
            b = gray + (b - gray) * factor;
        }

        px[0] = channel(r);
        px[1] = channel(g);
        px[2] = channel(b);
    }

    if adjustments.sharpness > 0 {
        apply_sharpness(rgba, width as usize, height as usize, adjustments.sharpness);
    }
}

fn normalize_adjustments(mut adjustments: ImageAdjustments) -> ImageAdjustments {
    adjustments.brightness = adjustments.brightness.clamp(-100, 100);
    adjustments.contrast = adjustments.contrast.clamp(-100, 100);
    adjustments.saturation = adjustments.saturation.clamp(-100, 100);
    adjustments.sharpness = adjustments.sharpness.min(100);
    adjustments
}

fn is_no_op(adjustments: ImageAdjustments) -> bool {
    !adjustments.grayscale
        && !adjustments.auto_levels
        && adjustments.brightness == 0
        && adjustments.contrast == 0
        && adjustments.saturation == 0
        && adjustments.sharpness == 0
}

fn luminance(r: f32, g: f32, b: f32) -> f32 {
    0.299 * r + 0.587 * g + 0.114 * b
}

fn channel(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

fn apply_auto_levels(rgba: &mut [u8], pixel_count: usize) {
    let mut min_luma = 255.0_f32;
    let mut max_luma = 0.0_f32;

    for px in rgba.chunks_exact(4).take(pixel_count) {
        let luma = luminance(px[0] as f32, px[1] as f32, px[2] as f32);
        min_luma = min_luma.min(luma);
        max_luma = max_luma.max(luma);
    }

    let span = max_luma - min_luma;
    if span < 1.0 {
        return;
    }

    for px in rgba.chunks_exact_mut(4).take(pixel_count) {
        for channel in &mut px[..3] {
            let stretched = (*channel as f32 - min_luma) * 255.0 / span;
            *channel = self::channel(stretched);
        }
    }
}

fn apply_sharpness(rgba: &mut [u8], width: usize, height: usize, sharpness: u32) {
    if width < 3 || height < 3 {
        return;
    }

    let original = rgba.to_vec();
    let amount = sharpness as f32 / 100.0;

    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let idx = (y * width + x) * 4;
            for channel_index in 0..3 {
                let center = original[idx + channel_index] as f32;
                let left = original[idx + channel_index - 4] as f32;
                let right = original[idx + channel_index + 4] as f32;
                let up = original[idx + channel_index - width * 4] as f32;
                let down = original[idx + channel_index + width * 4] as f32;
                let sharpened = center * (1.0 + 4.0 * amount) - (left + right + up + down) * amount;
                rgba[idx + channel_index] = channel(sharpened);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adjustments(partial: impl FnOnce(&mut ImageAdjustments)) -> ImageAdjustments {
        let mut adjustments = ImageAdjustments::default();
        partial(&mut adjustments);
        adjustments
    }

    fn first_pixel(rgba: &[u8]) -> [u8; 4] {
        [rgba[0], rgba[1], rgba[2], rgba[3]]
    }

    #[test]
    fn no_op_adjustments_leave_pixels_unchanged() {
        let mut rgba = vec![10, 20, 30, 40, 200, 190, 180, 170];
        let before = rgba.clone();

        apply_image_adjustments(&mut rgba, 2, 1, ImageAdjustments::default());

        assert_eq!(rgba, before);
    }

    #[test]
    fn grayscale_makes_color_channels_equal_and_preserves_alpha() {
        let mut rgba = vec![30, 90, 210, 77];

        apply_image_adjustments(
            &mut rgba,
            1,
            1,
            adjustments(|a| a.grayscale = true),
        );

        let [r, g, b, a] = first_pixel(&rgba);
        assert_eq!(r, g);
        assert_eq!(g, b);
        assert_eq!(a, 77);
    }

    #[test]
    fn brightness_increase_raises_color_channels_and_preserves_alpha() {
        let mut rgba = vec![80, 90, 100, 66];

        apply_image_adjustments(
            &mut rgba,
            1,
            1,
            adjustments(|a| a.brightness = 20),
        );

        let [r, g, b, a] = first_pixel(&rgba);
        assert!(r > 80);
        assert!(g > 90);
        assert!(b > 100);
        assert_eq!(a, 66);
    }

    #[test]
    fn contrast_increase_pushes_values_away_from_midpoint() {
        let mut rgba = vec![80, 128, 180, 255];

        apply_image_adjustments(
            &mut rgba,
            1,
            1,
            adjustments(|a| a.contrast = 50),
        );

        let [r, g, b, a] = first_pixel(&rgba);
        assert!(r < 80);
        assert_eq!(g, 128);
        assert!(b > 180);
        assert_eq!(a, 255);
    }

    #[test]
    fn saturation_decrease_moves_channels_toward_luminance() {
        let mut rgba = vec![220, 40, 40, 128];
        let before_spread = 220 - 40;

        apply_image_adjustments(
            &mut rgba,
            1,
            1,
            adjustments(|a| a.saturation = -60),
        );

        let [r, g, b, a] = first_pixel(&rgba);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        assert!(u16::from(max - min) < before_spread);
        assert_eq!(a, 128);
    }

    #[test]
    fn zero_sharpness_is_no_op() {
        let mut rgba = vec![10, 20, 30, 255, 200, 190, 180, 128];
        let before = rgba.clone();

        apply_image_adjustments(
            &mut rgba,
            2,
            1,
            adjustments(|a| a.sharpness = 0),
        );

        assert_eq!(rgba, before);
    }
}
