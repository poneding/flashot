use crate::settings_store::Settings;
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
    let initial_dir = initial_save_dir(settings.last_save_dir.as_deref())?;
    std::fs::create_dir_all(&initial_dir).context("Failed to create default save directory")?;

    Ok(FileDialog::new()
        .set_directory(&initial_dir)
        .set_file_name(filename_for_timestamp(Local::now().naive_local()))
        .add_filter("PNG Image", &["png"])
        .save_file())
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
    PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::NoFilter)
        .write_image(&rgba, width, height, ExtendedColorType::Rgba8)
        .context("Failed to save image file")?;
    Ok(())
}

fn initial_save_dir(last_save_dir: Option<&str>) -> Result<PathBuf> {
    if let Some(path) = last_save_dir.filter(|p| !p.trim().is_empty()) {
        return Ok(PathBuf::from(path));
    }

    let pictures = dirs::picture_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Pictures")))
        .context("Failed to locate Pictures directory")?;
    Ok(default_save_dir_from_pictures(&pictures))
}

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
    fn save_image_to_path_uses_fast_png_encoder() {
        let source = include_str!("saver.rs").replace("\r\n", "\n");
        let start = source.find("pub fn save_image_to_path").unwrap();
        let end = source[start..]
            .find("fn initial_save_dir")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(body.contains("PngEncoder::new_with_quality"));
        assert!(body.contains("CompressionType::Fast"));
        assert!(body.contains("FilterType::NoFilter"));
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
}
