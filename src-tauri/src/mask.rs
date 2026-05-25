/// Multiply the alpha channel of a straight-alpha RGBA buffer by a
/// rounded-rectangle coverage mask. Mutates `rgba` in place.
///
/// `radius_logical` is in logical (CSS) pixels. The mask radius in physical
/// pixels is `radius_logical * scale_factor`, clamped so neither axis
/// crosses the centerline. The four corner squares are processed with 2x2
/// supersampling for an anti-aliased boundary; the rest of the buffer is
/// untouched.
pub fn apply_rounded_corners(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    radius_logical: u32,
    scale_factor: f32,
) {
    if width == 0 || height == 0 || radius_logical == 0 || !scale_factor.is_finite() {
        return;
    }

    let Some(pixel_count) = (width as usize).checked_mul(height as usize) else {
        return;
    };
    let Some(required_len) = pixel_count.checked_mul(4) else {
        return;
    };
    if rgba.len() < required_len || scale_factor <= 0.0 {
        return;
    }

    let max_radius_physical = width.min(height) / 2;
    if max_radius_physical == 0 {
        return;
    }

    let max_radius_logical = max_radius_physical as f32 / scale_factor;
    let clamped_radius_logical = (radius_logical as f32).min(max_radius_logical);
    let radius_physical = ((clamped_radius_logical * scale_factor).round() as u32)
        .min(max_radius_physical);
    if radius_physical == 0 {
        return;
    }

    let radius = radius_physical as f32;
    let left_center = radius;
    let right_center = width as f32 - radius;
    let top_center = radius;
    let bottom_center = height as f32 - radius;

    for y in 0..radius_physical {
        for x in 0..radius_physical {
            apply_corner_pixel(rgba, width, x, y, left_center, top_center, radius);
            apply_corner_pixel(
                rgba,
                width,
                width - radius_physical + x,
                y,
                right_center,
                top_center,
                radius,
            );
            apply_corner_pixel(
                rgba,
                width,
                x,
                height - radius_physical + y,
                left_center,
                bottom_center,
                radius,
            );
            apply_corner_pixel(
                rgba,
                width,
                width - radius_physical + x,
                height - radius_physical + y,
                right_center,
                bottom_center,
                radius,
            );
        }
    }
}

fn apply_corner_pixel(
    rgba: &mut [u8],
    width: u32,
    x: u32,
    y: u32,
    center_x: f32,
    center_y: f32,
    radius: f32,
) {
    let pixel_center_x = x as f32 + 0.5;
    let pixel_center_y = y as f32 + 0.5;
    let dx = pixel_center_x - center_x;
    let dy = pixel_center_y - center_y;
    let distance = dx.hypot(dy);

    let covered_samples = if (distance - radius).abs() < 1.5 {
        covered_supersamples(x, y, center_x, center_y, radius)
    } else if distance <= radius {
        4
    } else {
        0
    };

    if covered_samples == 4 {
        return;
    }

    let alpha_offset = ((y * width + x) * 4 + 3) as usize;
    let alpha = rgba[alpha_offset] as u16;
    rgba[alpha_offset] = ((alpha * covered_samples + 2) / 4) as u8;
}

fn covered_supersamples(x: u32, y: u32, center_x: f32, center_y: f32, radius: f32) -> u16 {
    const OFFSETS: [(f32, f32); 4] = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)];

    OFFSETS
        .iter()
        .filter(|(offset_x, offset_y)| {
            let dx = x as f32 + offset_x - center_x;
            let dy = y as f32 + offset_y - center_y;
            dx.hypot(dy) <= radius
        })
        .count() as u16
}

#[cfg(test)]
mod tests {
    use super::apply_rounded_corners;

    fn rgba_buffer(width: u32, height: u32, alpha: u8) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for i in 0..(width * height) {
            rgba.push((i % 251) as u8);
            rgba.push(((i + 17) % 251) as u8);
            rgba.push(((i + 31) % 251) as u8);
            rgba.push(alpha);
        }
        rgba
    }

    fn pixel(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
        let offset = ((y * width + x) * 4) as usize;
        [
            rgba[offset],
            rgba[offset + 1],
            rgba[offset + 2],
            rgba[offset + 3],
        ]
    }

    #[test]
    fn apply_rounded_corners_zero_radius_is_noop() {
        let mut rgba = rgba_buffer(6, 4, 255);
        let original = rgba.clone();

        apply_rounded_corners(&mut rgba, 6, 4, 0, 1.0);

        assert_eq!(rgba, original);
    }

    #[test]
    fn apply_rounded_corners_clears_corner_alpha_to_zero() {
        let mut rgba = rgba_buffer(10, 10, 255);
        let original_rgb = &rgba[0..3];
        let original_rgb = [original_rgb[0], original_rgb[1], original_rgb[2]];

        apply_rounded_corners(&mut rgba, 10, 10, 4, 1.0);

        assert_eq!(pixel(&rgba, 10, 0, 0)[0..3], original_rgb);
        assert_eq!(pixel(&rgba, 10, 0, 0)[3], 0);
        assert_eq!(pixel(&rgba, 10, 9, 0)[3], 0);
        assert_eq!(pixel(&rgba, 10, 0, 9)[3], 0);
        assert_eq!(pixel(&rgba, 10, 9, 9)[3], 0);
    }

    #[test]
    fn apply_rounded_corners_preserves_center_pixels() {
        let mut rgba = rgba_buffer(12, 10, 255);
        let center = pixel(&rgba, 12, 6, 5);

        apply_rounded_corners(&mut rgba, 12, 10, 4, 1.0);

        assert_eq!(pixel(&rgba, 12, 6, 5), center);
    }

    #[test]
    fn apply_rounded_corners_anti_aliases_boundary() {
        let mut rgba = rgba_buffer(10, 10, 255);

        apply_rounded_corners(&mut rgba, 10, 10, 4, 1.0);

        let alpha = pixel(&rgba, 10, 0, 2)[3];
        assert!(alpha > 0, "expected partial coverage, got {alpha}");
        assert!(alpha < 255, "expected partial coverage, got {alpha}");
    }

    #[test]
    fn apply_rounded_corners_clamps_oversized_radius_to_half_min_dimension() {
        let mut oversized = rgba_buffer(8, 6, 255);
        let mut clamped = rgba_buffer(8, 6, 255);

        apply_rounded_corners(&mut oversized, 8, 6, 100, 1.0);
        apply_rounded_corners(&mut clamped, 8, 6, 3, 1.0);

        assert_eq!(pixel(&oversized, 8, 0, 0)[3], 0);
        assert_eq!(oversized, clamped);
    }

    #[test]
    fn apply_rounded_corners_scales_with_scale_factor() {
        let mut scaled = rgba_buffer(12, 12, 255);
        let mut physical = rgba_buffer(12, 12, 255);

        apply_rounded_corners(&mut scaled, 12, 12, 3, 2.0);
        apply_rounded_corners(&mut physical, 12, 12, 6, 1.0);

        assert_eq!(pixel(&scaled, 12, 0, 0)[3], 0);
        assert_eq!(scaled, physical);
    }

    #[test]
    fn apply_rounded_corners_respects_existing_alpha() {
        let mut rgba = rgba_buffer(10, 10, 128);

        apply_rounded_corners(&mut rgba, 10, 10, 4, 1.0);

        let alpha = pixel(&rgba, 10, 0, 2)[3];
        assert!(alpha > 0, "expected partial coverage, got {alpha}");
        assert!(alpha < 128, "expected alpha to be multiplied, got {alpha}");
        assert_eq!(pixel(&rgba, 10, 4, 4)[3], 128);
    }
}
