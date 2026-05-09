use anyhow::{Context, Result};
use image::{ImageBuffer, Rgba};
use rfd::FileDialog;
use std::path::PathBuf;

pub fn save_image_dialog(rgba: Vec<u8>, width: u32, height: u32) -> Result<Option<PathBuf>> {
    let path = FileDialog::new()
        .set_file_name("screenshot.png")
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
