use crate::settings_store::Language;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeText {
    pub capture_region: &'static str,
    pub capture_screen: &'static str,
    pub capture_window: &'static str,
    pub settings_menu: &'static str,
    pub check_updates_menu: &'static str,
    pub about_menu: &'static str,
    pub quit_menu: &'static str,
    pub settings_title: &'static str,
    pub about_title: &'static str,
    pub updates_title: &'static str,
}

pub fn native_text(language: Language) -> NativeText {
    match language {
        Language::En => NativeText {
            capture_region: "Capture Area",
            capture_screen: "Capture Screen",
            capture_window: "Capture Active Window",
            settings_menu: "Settings…",
            check_updates_menu: "Check for updates",
            about_menu: "About",
            quit_menu: "Quit Flashot",
            settings_title: "Flashot Settings",
            about_title: "About Flashot",
            updates_title: "Check for Updates",
        },
        Language::ZhCn => NativeText {
            capture_region: "截取区域",
            capture_screen: "截取屏幕",
            capture_window: "截取当前活动窗口",
            settings_menu: "设置…",
            check_updates_menu: "检查更新",
            about_menu: "关于",
            quit_menu: "退出 Flashot",
            settings_title: "Flashot 设置",
            about_title: "关于 Flashot",
            updates_title: "检查更新",
        },
        Language::ZhTw => NativeText {
            capture_region: "擷取區域",
            capture_screen: "擷取螢幕",
            capture_window: "擷取目前活動視窗",
            settings_menu: "設定…",
            check_updates_menu: "檢查更新",
            about_menu: "關於",
            quit_menu: "結束 Flashot",
            settings_title: "Flashot 設定",
            about_title: "關於 Flashot",
            updates_title: "檢查更新",
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::settings_store::Language;

    #[test]
    fn native_tray_text_uses_taiwan_wording() {
        let text = super::native_text(Language::ZhTw);

        assert_eq!(text.capture_region, "擷取區域");
        assert_eq!(text.capture_screen, "擷取螢幕");
        assert_eq!(text.capture_window, "擷取目前活動視窗");
        assert_eq!(text.settings_menu, "設定…");
        assert_eq!(text.check_updates_menu, "檢查更新");
        assert_eq!(text.about_menu, "關於");
        assert_eq!(text.quit_menu, "結束 Flashot");
    }

    #[test]
    fn native_window_titles_default_to_english() {
        let text = super::native_text(Language::En);

        assert_eq!(text.settings_title, "Flashot Settings");
        assert_eq!(text.about_title, "About Flashot");
        assert_eq!(text.updates_title, "Check for Updates");
    }

    #[test]
    fn native_window_titles_use_taiwan_wording() {
        let text = super::native_text(Language::ZhTw);

        assert_eq!(text.settings_title, "Flashot 設定");
        assert_eq!(text.about_title, "關於 Flashot");
        assert_eq!(text.updates_title, "檢查更新");
    }
}
