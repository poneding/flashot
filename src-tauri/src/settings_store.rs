use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub hotkey: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "CommandOrControl+Shift+A".to_string(),
        }
    }
}

pub fn load() -> Result<Settings> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let json = fs::read_to_string(&path)
        .context("Failed to read settings file")?;
    let settings: Settings = serde_json::from_str(&json)
        .context("Failed to parse settings JSON")?;
    Ok(settings)
}

pub fn save(settings: &Settings) -> Result<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .context("Failed to create settings directory")?;
    }
    let json = serde_json::to_string_pretty(settings)
        .context("Failed to serialize settings")?;
    fs::write(&path, json)
        .context("Failed to write settings file")?;
    Ok(())
}

fn settings_path() -> Result<PathBuf> {
    let config_dir = dirs::config_dir()
        .context("Failed to locate config directory")?;
    Ok(config_dir.join("flashot").join("settings.json"))
}
