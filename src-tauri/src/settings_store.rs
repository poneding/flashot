use anyhow::{Context, Result};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
pub const DEFAULT_CAPTURE_HOTKEY: &str = "Cmd+Shift+A";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_CAPTURE_HOTKEY: &str = "Ctrl+Shift+A";

#[cfg(target_os = "macos")]
pub const DEFAULT_FULLSCREEN_HOTKEY: &str = "Option+F";
#[cfg(target_os = "windows")]
pub const DEFAULT_FULLSCREEN_HOTKEY: &str = "Win+F";
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub const DEFAULT_FULLSCREEN_HOTKEY: &str = "Super+F";

#[cfg(target_os = "macos")]
pub const DEFAULT_ACTIVE_WINDOW_HOTKEY: &str = "Option+W";
#[cfg(target_os = "windows")]
pub const DEFAULT_ACTIVE_WINDOW_HOTKEY: &str = "Win+W";
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub const DEFAULT_ACTIVE_WINDOW_HOTKEY: &str = "Super+W";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    En,
    ZhCn,
    ZhTw,
}

impl Serialize for Language {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(match self {
            Language::En => "en",
            Language::ZhCn => "zh-CN",
            Language::ZhTw => "zh-TW",
        })
    }
}

impl<'de> Deserialize<'de> for Language {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "zh-CN" => Language::ZhCn,
            "zh-TW" => Language::ZhTw,
            "en" | "system" => Language::En,
            _ => Language::En,
        })
    }
}

const DEFAULT_ACCENT_COLOR: &str = "#F59E0B";

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

fn default_accent_color() -> String {
    DEFAULT_ACCENT_COLOR.to_string()
}

fn default_language() -> Language {
    Language::En
}

fn default_update_check_interval_hours() -> u32 {
    24
}

pub fn default_save_dir() -> String {
    let pictures = dirs::picture_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Pictures")))
        .unwrap_or_else(|| PathBuf::from("Pictures"));

    pictures.join("Flashot").to_string_lossy().to_string()
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
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_language")]
    pub language: Language,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default)]
    pub auto_check_updates: bool,
    #[serde(default)]
    pub allow_beta_updates: bool,
    #[serde(default = "default_update_check_interval_hours")]
    pub update_check_interval_hours: u32,
    #[serde(default)]
    pub last_update_check_at: Option<i64>,
    #[serde(default = "default_save_dir")]
    pub default_save_dir: String,
    #[serde(default)]
    pub last_save_dir: Option<String>,
    #[serde(default)]
    pub corner_radius: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wayland_screencast_restore_token: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            capture_hotkey: default_capture_hotkey(),
            fullscreen_hotkey: default_fullscreen_hotkey(),
            active_window_hotkey: default_active_window_hotkey(),
            theme: default_theme(),
            accent_color: default_accent_color(),
            language: default_language(),
            launch_at_login: false,
            auto_check_updates: false,
            allow_beta_updates: false,
            update_check_interval_hours: default_update_check_interval_hours(),
            last_update_check_at: None,
            default_save_dir: default_save_dir(),
            last_save_dir: None,
            corner_radius: 0,
            wayland_screencast_restore_token: None,
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
    use std::path::Path;

    fn is_default_flashot_dir(path: &str) -> bool {
        Path::new(path).ends_with(Path::new("Pictures").join("Flashot"))
    }

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
        assert_eq!(settings.accent_color, DEFAULT_ACCENT_COLOR);
        assert_eq!(settings.language, Language::En);
        assert!(!settings.launch_at_login);
        assert!(!settings.auto_check_updates);
        assert!(!settings.allow_beta_updates);
        assert_eq!(settings.update_check_interval_hours, 24);
        assert_eq!(settings.last_update_check_at, None);
        assert!(is_default_flashot_dir(&settings.default_save_dir));
        assert_eq!(settings.last_save_dir, None);
        assert_eq!(settings.wayland_screencast_restore_token, None);
    }

    #[test]
    fn default_quick_shot_hotkeys_use_platform_modifier() {
        let settings = Settings::default();

        #[cfg(target_os = "macos")]
        {
            assert_eq!(settings.fullscreen_hotkey, "Option+F");
            assert_eq!(settings.active_window_hotkey, "Option+W");
        }

        #[cfg(target_os = "windows")]
        {
            assert_eq!(settings.fullscreen_hotkey, "Win+F");
            assert_eq!(settings.active_window_hotkey, "Win+W");
        }

        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        {
            assert_eq!(settings.fullscreen_hotkey, "Super+F");
            assert_eq!(settings.active_window_hotkey, "Super+W");
        }
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
        assert_eq!(settings.accent_color, DEFAULT_ACCENT_COLOR);
        assert_eq!(settings.language, Language::En);
        assert!(!settings.launch_at_login);
        assert!(!settings.auto_check_updates);
        assert!(!settings.allow_beta_updates);
        assert_eq!(settings.update_check_interval_hours, 24);
        assert_eq!(settings.last_update_check_at, None);
        assert!(is_default_flashot_dir(&settings.default_save_dir));
        assert_eq!(settings.last_save_dir, None);
        assert_eq!(settings.wayland_screencast_restore_token, None);
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
            accent_color: "#ff00aa".to_string(),
            language: Language::ZhCn,
            launch_at_login: true,
            auto_check_updates: true,
            allow_beta_updates: true,
            update_check_interval_hours: 6,
            last_update_check_at: Some(1_801_234_567),
            default_save_dir: "/Users/dp/Pictures/Flashot".to_string(),
            last_save_dir: Some("/Users/dp/Pictures/Flashot".to_string()),
            corner_radius: 0,
            wayland_screencast_restore_token: Some("restore-token".to_string()),
        };

        let value = serde_json::to_value(settings).unwrap();

        assert_eq!(value["captureHotkey"], "Ctrl+Shift+A");
        assert_eq!(value["fullscreenHotkey"], "Ctrl+Shift+F");
        assert_eq!(value["activeWindowHotkey"], "Ctrl+Shift+W");
        assert!(value.get("hotkey").is_none());
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["accentColor"], "#ff00aa");
        assert_eq!(value["language"], "zh-CN");
        assert_eq!(value["launchAtLogin"], true);
        assert_eq!(value["autoCheckUpdates"], true);
        assert_eq!(value["allowBetaUpdates"], true);
        assert_eq!(value["updateCheckIntervalHours"], 6);
        assert_eq!(value["lastUpdateCheckAt"], 1_801_234_567);
        assert_eq!(value["defaultSaveDir"], "/Users/dp/Pictures/Flashot");
        assert_eq!(value["lastSaveDir"], "/Users/dp/Pictures/Flashot");
        assert_eq!(value["waylandScreencastRestoreToken"], "restore-token");
    }

    #[test]
    fn empty_wayland_screencast_restore_token_is_not_serialized() {
        let value = serde_json::to_value(Settings::default()).unwrap();

        assert!(value.get("waylandScreencastRestoreToken").is_none());
    }

    #[test]
    fn language_serializes_traditional_chinese_taiwan() {
        let settings = Settings {
            language: Language::ZhTw,
            ..Settings::default()
        };

        let value = serde_json::to_value(settings).unwrap();

        assert_eq!(value["language"], "zh-TW");
    }

    #[test]
    fn legacy_system_language_deserializes_as_english() {
        let settings: Settings = serde_json::from_str(r#"{"language":"system"}"#).unwrap();

        assert_eq!(settings.language, Language::En);
    }

    #[test]
    fn default_settings_have_zero_corner_radius() {
        let settings = Settings::default();
        assert_eq!(settings.corner_radius, 0);
    }

    #[test]
    fn default_settings_have_appearance_defaults() {
        let settings = Settings::default();
        assert_eq!(settings.accent_color, DEFAULT_ACCENT_COLOR);
        assert_eq!(settings.language, Language::En);
    }

    #[test]
    fn settings_round_trip_corner_radius() {
        let json = r#"{"cornerRadius":16}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.corner_radius, 16);
        let value = serde_json::to_value(settings).unwrap();
        assert_eq!(value["cornerRadius"], 16);
    }

    #[test]
    fn legacy_settings_without_corner_radius_default_to_zero() {
        let settings: Settings = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(settings.corner_radius, 0);
    }

    #[test]
    fn legacy_settings_without_appearance_fields_get_defaults() {
        let settings: Settings = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(settings.accent_color, DEFAULT_ACCENT_COLOR);
        assert_eq!(settings.language, Language::En);
    }
}
