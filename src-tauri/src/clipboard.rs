use anyhow::{Context, Result};
use arboard::Clipboard;
use image::{ImageBuffer, Rgba};
use std::{thread, time::Duration};

pub fn copy_image(rgba: Vec<u8>, width: u32, height: u32) -> Result<()> {
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, rgba).context("Invalid image dimensions")?;

    let img_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: img.as_raw().into(),
    };

    let mut clipboard = Clipboard::new().context("Failed to access clipboard")?;
    if let Err(first_err) = clipboard.set_image(img_data.clone()) {
        tracing::warn!("clipboard image write failed, retrying once: {first_err}");
        thread::sleep(Duration::from_millis(30));
        let mut retry_clipboard =
            Clipboard::new().context("Failed to access clipboard on retry")?;
        retry_clipboard
            .set_image(img_data)
            .context("Failed to set clipboard image")?;
    }
    Ok(())
}
