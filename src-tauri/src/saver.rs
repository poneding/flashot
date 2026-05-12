use crate::settings_store::Settings;
use anyhow::{Context, Result};
use chrono::{Local, NaiveDateTime};
use image::{ImageBuffer, Rgba};
use rfd::FileDialog;
use std::path::{Path, PathBuf};

pub fn save_image_dialog(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    settings: &Settings,
) -> Result<Option<PathBuf>> {
    let initial_dir = initial_save_dir(settings.last_save_dir.as_deref())?;
    std::fs::create_dir_all(&initial_dir).context("Failed to create default save directory")?;

    let path = FileDialog::new()
        .set_directory(&initial_dir)
        .set_file_name(filename_for_timestamp(Local::now().naive_local()))
        .add_filter("PNG Image", &["png"])
        .save_file();

    let Some(path) = path else {
        return Ok(None); // User cancelled
    };

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, rgba)
            .context("Invalid image dimensions")?;

    img.save(&path)
        .context("Failed to save image file")?;

    Ok(Some(path))
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

        assert_eq!(filename_for_timestamp(now), "Flashot_2026-05-12_09-08-07.png");
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
}
