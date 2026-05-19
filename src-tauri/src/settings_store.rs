use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
pub const DEFAULT_CAPTURE_HOTKEY: &str = "Cmd+Shift+A";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_CAPTURE_HOTKEY: &str = "Ctrl+Shift+A";

#[cfg(target_os = "macos")]
pub const DEFAULT_FULLSCREEN_HOTKEY: &str = "Cmd+Shift+F";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_FULLSCREEN_HOTKEY: &str = "Ctrl+Shift+F";

#[cfg(target_os = "macos")]
pub const DEFAULT_ACTIVE_WINDOW_HOTKEY: &str = "Cmd+Shift+W";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_ACTIVE_WINDOW_HOTKEY: &str = "Ctrl+Shift+W";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

fn default_capture_hotkey() -> String {
    DEFAULT_CAPTURE_HOTKEY.to_string()
}

fn default_fullscreen_hotkey() -> String {
    DEFAULT_FULLSCREEN_HOTKEY.to_string()
}

fn default_active_window_hotkey() -> String {
    DEFAULT_ACTIVE_WINDOW_HOTKEY.to_string()
}

fn default_theme() -> Theme {
    Theme::System
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_capture_hotkey", alias = "hotkey")]
    pub capture_hotkey: String,
    #[serde(default = "default_fullscreen_hotkey")]
    pub fullscreen_hotkey: String,
    #[serde(default = "default_active_window_hotkey")]
    pub active_window_hotkey: String,
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
            capture_hotkey: default_capture_hotkey(),
            fullscreen_hotkey: default_fullscreen_hotkey(),
            active_window_hotkey: default_active_window_hotkey(),
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
    let json = fs::read_to_string(&path).context("Failed to read settings file")?;
    let settings: Settings =
        serde_json::from_str(&json).context("Failed to parse settings JSON")?;
    Ok(settings)
}

pub fn save(settings: &Settings) -> Result<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("Failed to create settings directory")?;
    }
    let json = serde_json::to_string_pretty(settings).context("Failed to serialize settings")?;
    fs::write(&path, json).context("Failed to write settings file")?;
    Ok(())
}

fn settings_path() -> Result<PathBuf> {
    let config_dir = dirs::config_dir().context("Failed to locate config directory")?;
    Ok(config_dir.join("flashot").join("settings.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_match_v0_defaults() {
        let settings = Settings::default();

        assert_eq!(settings.capture_hotkey, default_capture_hotkey());
        assert_eq!(settings.fullscreen_hotkey, default_fullscreen_hotkey());
        assert_eq!(
            settings.active_window_hotkey,
            default_active_window_hotkey()
        );
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.last_save_dir, None);
    }

    #[test]
    fn legacy_settings_json_gets_new_field_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"hotkey":"Cmd+Shift+B"}"#).unwrap();

        assert_eq!(settings.capture_hotkey, "Cmd+Shift+B");
        assert_eq!(settings.fullscreen_hotkey, default_fullscreen_hotkey());
        assert_eq!(
            settings.active_window_hotkey,
            default_active_window_hotkey()
        );
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.launch_at_login);
        assert_eq!(settings.last_save_dir, None);
    }

    #[test]
    fn partial_new_settings_json_gets_missing_hotkey_defaults() {
        let settings: Settings =
            serde_json::from_str(r#"{"captureHotkey":"Cmd+Shift+B"}"#).unwrap();

        assert_eq!(settings.capture_hotkey, "Cmd+Shift+B");
        assert_eq!(settings.fullscreen_hotkey, default_fullscreen_hotkey());
        assert_eq!(
            settings.active_window_hotkey,
            default_active_window_hotkey()
        );
    }

    #[test]
    fn settings_serialize_with_frontend_camel_case_fields() {
        let settings = Settings {
            capture_hotkey: "Ctrl+Shift+A".to_string(),
            fullscreen_hotkey: "Ctrl+Shift+F".to_string(),
            active_window_hotkey: "Ctrl+Shift+W".to_string(),
            theme: Theme::Dark,
            launch_at_login: true,
            last_save_dir: Some("/Users/dp/Pictures/Flashot".to_string()),
        };

        let value = serde_json::to_value(settings).unwrap();

        assert_eq!(value["captureHotkey"], "Ctrl+Shift+A");
        assert_eq!(value["fullscreenHotkey"], "Ctrl+Shift+F");
        assert_eq!(value["activeWindowHotkey"], "Ctrl+Shift+W");
        assert!(value.get("hotkey").is_none());
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["launchAtLogin"], true);
        assert_eq!(value["lastSaveDir"], "/Users/dp/Pictures/Flashot");
    }
}
