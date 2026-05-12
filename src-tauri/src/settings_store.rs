use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+A";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.to_string()
}

fn default_theme() -> Theme {
    Theme::System
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_theme")]
    pub theme: Theme,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default)]
    pub last_save_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            theme: default_theme(),
            launch_at_login: false,
            last_save_dir: None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_match_v0_defaults() {
        let settings = Settings::default();

        assert_eq!(settings.hotkey, "CommandOrControl+Shift+A");
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.last_save_dir, None);
    }

    #[test]
    fn legacy_settings_json_gets_new_field_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"hotkey":"Cmd+Shift+B"}"#).unwrap();

        assert_eq!(settings.hotkey, "Cmd+Shift+B");
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.last_save_dir, None);
    }

    #[test]
    fn settings_serialize_with_frontend_camel_case_fields() {
        let settings = Settings {
            hotkey: "Ctrl+Shift+A".to_string(),
            theme: Theme::Dark,
            launch_at_login: true,
            last_save_dir: Some("/Users/dp/Pictures/Flashot".to_string()),
        };

        let value = serde_json::to_value(settings).unwrap();

        assert_eq!(value["hotkey"], "Ctrl+Shift+A");
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["launchAtLogin"], true);
        assert_eq!(value["lastSaveDir"], "/Users/dp/Pictures/Flashot");
    }
}
