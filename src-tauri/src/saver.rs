use crate::settings_store::{self, Settings};
use anyhow::{bail, Context, Result};
use chrono::{Local, NaiveDateTime};
use rfd::FileDialog;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

pub fn save_image_dialog(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    settings: &Settings,
) -> Result<Option<PathBuf>> {
    let Some(path) = choose_save_path(settings)? else {
        return Ok(None);
    };

    save_image_to_path(rgba, width, height, &path)?;
    Ok(Some(path))
}

pub fn choose_save_path(settings: &Settings) -> Result<Option<PathBuf>> {
    let initial_dir = initial_save_dir(settings)?;
    std::fs::create_dir_all(&initial_dir).context("Failed to create default save directory")?;

    Ok(FileDialog::new()
        .set_directory(&initial_dir)
        .set_file_name(filename_for_timestamp(Local::now().naive_local()))
        .add_filter("PNG Image", &["png"])
        .save_file())
}

pub fn choose_directory(current_dir: Option<&str>) -> Result<Option<PathBuf>> {
    let initial_dir = current_dir
        .filter(|p| !p.trim().is_empty())
        .map(expand_user_path)
        .unwrap_or_else(|| PathBuf::from(settings_store::default_save_dir()));
    std::fs::create_dir_all(&initial_dir).context("Failed to create default save directory")?;

    Ok(FileDialog::new().set_directory(&initial_dir).pick_folder())
}

pub fn save_image_to_path(rgba: Vec<u8>, width: u32, height: u32, path: &Path) -> Result<()> {
    use image::{
        codecs::png::{CompressionType, FilterType, PngEncoder},
        ExtendedColorType, ImageEncoder,
    };

    if rgba.len() != (width as usize) * (height as usize) * 4 {
        bail!("Invalid image dimensions");
    }

    let file = std::fs::File::create(path).context("Failed to create image file")?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::Adaptive);
    if rgba_is_opaque(&rgba) {
        let rgb = rgba_to_rgb(&rgba);
        encoder
            .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
            .context("Failed to save image file")?;
    } else {
        encoder
            .write_image(&rgba, width, height, ExtendedColorType::Rgba8)
            .context("Failed to save image file")?;
    }
    Ok(())
}

fn rgba_is_opaque(rgba: &[u8]) -> bool {
    rgba.chunks_exact(4).all(|pixel| pixel[3] == 255)
}

fn rgba_to_rgb(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.chunks_exact(4) {
        rgb.extend_from_slice(&pixel[..3]);
    }
    rgb
}

fn initial_save_dir(settings: &Settings) -> Result<PathBuf> {
    if !settings.default_save_dir.trim().is_empty() {
        return Ok(expand_user_path(&settings.default_save_dir));
    }

    Ok(PathBuf::from(settings_store::default_save_dir()))
}

fn expand_user_path(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }

    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

#[cfg(test)]
fn default_save_dir_from_pictures(pictures: &Path) -> PathBuf {
    pictures.join("Flashot")
}

fn filename_for_timestamp(now: NaiveDateTime) -> String {
    format!("Flashot_{}.png", now.format("%Y-%m-%d_%H-%M-%S"))
}

pub fn remember_last_save_dir(settings: &mut Settings, saved_file: &Path) {
    if let Some(parent) = saved_file.parent() {
        settings.last_save_dir = Some(parent.to_string_lossy().to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings_store::Settings;
    use chrono::NaiveDate;
    use std::path::Path;

    #[test]
    fn default_save_dir_uses_pictures_flashot() {
        assert_eq!(
            default_save_dir_from_pictures(Path::new("/Users/dp/Pictures")),
            PathBuf::from("/Users/dp/Pictures/Flashot"),
        );
    }

    #[test]
    fn filename_uses_flashot_timestamp_png_format() {
        let now = NaiveDate::from_ymd_opt(2026, 5, 12)
            .unwrap()
            .and_hms_opt(9, 8, 7)
            .unwrap();

        assert_eq!(
            filename_for_timestamp(now),
            "Flashot_2026-05-12_09-08-07.png"
        );
    }

    #[test]
    fn remember_last_save_dir_uses_saved_file_parent() {
        let mut settings = Settings::default();

        remember_last_save_dir(
            &mut settings,
            Path::new("/Users/dp/Pictures/Flashot/Flashot_2026-05-12_09-08-07.png"),
        );

        assert_eq!(
            settings.last_save_dir,
            Some("/Users/dp/Pictures/Flashot".to_string()),
        );
    }

    #[test]
    fn initial_save_dir_prefers_configured_default_over_last_save_dir() {
        let settings = Settings {
            default_save_dir: "/Users/dp/Desktop/Shots".to_string(),
            last_save_dir: Some("/Users/dp/Downloads".to_string()),
            ..Settings::default()
        };

        assert_eq!(
            initial_save_dir(&settings).unwrap(),
            PathBuf::from("/Users/dp/Desktop/Shots"),
        );
    }

    #[test]
    fn save_image_to_path_uses_optimized_png_encoder() {
        let source = include_str!("saver.rs").replace("\r\n", "\n");
        let start = source.find("pub fn save_image_to_path").unwrap();
        let end = source[start..]
            .find("fn initial_save_dir")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(body.contains("PngEncoder::new_with_quality"));
        assert!(body.contains("CompressionType::Fast"));
        assert!(body.contains("FilterType::Adaptive"));
        assert!(!body.contains("ImageBuffer::from_raw"));
    }

    #[test]
    fn save_image_to_path_writes_decodable_png() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scroll.png");

        save_image_to_path(vec![255, 0, 0, 255, 0, 255, 0, 255], 2, 1, &path)
            .expect("PNG should be written");

        let decoded = image::open(&path).unwrap().to_rgba8();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 1);
        assert_eq!(decoded.as_raw(), &[255, 0, 0, 255, 0, 255, 0, 255]);
    }

    #[test]
    fn save_image_to_path_writes_opaque_images_as_rgb_png() {
        use image::{codecs::png::PngDecoder, ColorType, ImageDecoder};
        use std::io::Cursor;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opaque.png");

        save_image_to_path(vec![10, 20, 30, 255, 40, 50, 60, 255], 2, 1, &path)
            .expect("PNG should be written");

        let bytes = std::fs::read(&path).unwrap();
        let decoder = PngDecoder::new(Cursor::new(bytes)).expect("PNG should decode");
        assert_eq!(decoder.color_type(), ColorType::Rgb8);

        let decoded = image::open(&path).unwrap().to_rgba8();
        assert_eq!(decoded.as_raw(), &[10, 20, 30, 255, 40, 50, 60, 255]);
    }

    #[test]
    fn save_image_to_path_preserves_transparent_alpha_channel() {
        use image::{codecs::png::PngDecoder, ColorType, ImageDecoder};
        use std::io::Cursor;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("transparent.png");
        let pixels = vec![10, 20, 30, 0, 40, 50, 60, 128];

        save_image_to_path(pixels.clone(), 2, 1, &path).expect("PNG should be written");

        let bytes = std::fs::read(&path).unwrap();
        let decoder = PngDecoder::new(Cursor::new(bytes)).expect("PNG should decode");
        assert_eq!(decoder.color_type(), ColorType::Rgba8);

        let decoded = image::open(&path).unwrap().to_rgba8();
        assert_eq!(decoded.as_raw(), &pixels);
    }
}
