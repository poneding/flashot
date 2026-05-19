use anyhow::{anyhow, Result};
use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager,
};
use parking_lot::Mutex;
use std::cell::RefCell;
use std::sync::atomic::{AtomicU32, Ordering};

static CURRENT_CAPTURE_ID: AtomicU32 = AtomicU32::new(0);
static CURRENT_FULLSCREEN_ID: AtomicU32 = AtomicU32::new(0);
static CURRENT_ACTIVE_WINDOW_ID: AtomicU32 = AtomicU32::new(0);

thread_local! {
    static HOTKEY_SERVICE: RefCell<Option<HotkeyService>> = const { RefCell::new(None) };
}

pub struct HotkeyService {
    mgr: GlobalHotKeyManager,
    current: Mutex<Vec<HotKey>>,
    capture_cancel: Mutex<Option<HotKey>>,
}

impl HotkeyService {
    fn new() -> Result<Self> {
        Ok(Self {
            mgr: GlobalHotKeyManager::new()?,
            current: Mutex::new(Vec::new()),
            capture_cancel: Mutex::new(None),
        })
    }

    pub fn set(&self, accelerator: &str) -> Result<u32> {
        let parsed = parse_accelerator(accelerator)?;
        let mut cur = self.current.lock();
        for old in cur.drain(..) {
            let _ = self.mgr.unregister(old);
        }
        self.mgr.register(parsed)?;
        let id = parsed.id();
        store_current_ids(RegisteredHotkeyIds {
            capture: id,
            fullscreen: 0,
            active_window: 0,
        });
        cur.push(parsed);
        Ok(id)
    }

    pub fn set_all(
        &self,
        capture: &str,
        fullscreen: &str,
        active_window: &str,
    ) -> Result<RegisteredHotkeyIds> {
        let parsed = [
            parse_accelerator(capture)?,
            parse_accelerator(fullscreen)?,
            parse_accelerator(active_window)?,
        ];
        let mut cur = self.current.lock();
        for old in cur.drain(..) {
            let _ = self.mgr.unregister(old);
        }
        for hotkey in parsed {
            self.mgr.register(hotkey)?;
            cur.push(hotkey);
        }

        let ids = RegisteredHotkeyIds {
            capture: parsed[0].id(),
            fullscreen: parsed[1].id(),
            active_window: parsed[2].id(),
        };
        store_current_ids(ids);
        Ok(ids)
    }

    pub fn set_capture_cancel_enabled(&self, enabled: bool) -> Result<()> {
        let mut cur = self.capture_cancel.lock();
        if enabled {
            if cur.is_some() {
                return Ok(());
            }

            let hotkey = capture_cancel_hotkey();
            self.mgr.register(hotkey)?;
            *cur = Some(hotkey);
            return Ok(());
        }

        if let Some(old) = cur.take() {
            let _ = self.mgr.unregister(old);
        }
        Ok(())
    }

    /// Returns the global event receiver. Subscribe once at startup;
    /// match incoming `event.id` against `current_ids()`.
    pub fn receiver(&self) -> &'static crossbeam_channel::Receiver<GlobalHotKeyEvent> {
        GlobalHotKeyEvent::receiver()
    }
}

pub fn initialize() -> Result<()> {
    HOTKEY_SERVICE.with(|slot| {
        let mut service = slot.borrow_mut();
        if service.is_none() {
            *service = Some(HotkeyService::new()?);
        }
        Ok(())
    })
}

pub fn set(accelerator: &str) -> Result<u32> {
    HOTKEY_SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service
            .as_ref()
            .ok_or_else(|| anyhow!("hotkey service has not been initialized"))?;
        service.set(accelerator)
    })
}

pub fn set_all(
    capture: &str,
    fullscreen: &str,
    active_window: &str,
) -> Result<RegisteredHotkeyIds> {
    HOTKEY_SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service
            .as_ref()
            .ok_or_else(|| anyhow!("hotkey service has not been initialized"))?;
        service.set_all(capture, fullscreen, active_window)
    })
}

pub fn set_capture_cancel_enabled(enabled: bool) -> Result<()> {
    HOTKEY_SERVICE.with(|slot| {
        let service = slot.borrow();
        let service = service
            .as_ref()
            .ok_or_else(|| anyhow!("hotkey service has not been initialized"))?;
        service.set_capture_cancel_enabled(enabled)
    })
}

pub fn receiver() -> &'static crossbeam_channel::Receiver<GlobalHotKeyEvent> {
    GlobalHotKeyEvent::receiver()
}

pub fn current_id() -> u32 {
    current_ids().capture
}

pub fn current_ids() -> RegisteredHotkeyIds {
    RegisteredHotkeyIds {
        capture: CURRENT_CAPTURE_ID.load(Ordering::SeqCst),
        fullscreen: CURRENT_FULLSCREEN_ID.load(Ordering::SeqCst),
        active_window: CURRENT_ACTIVE_WINDOW_ID.load(Ordering::SeqCst),
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RegisteredHotkeyIds {
    pub capture: u32,
    pub fullscreen: u32,
    pub active_window: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    TriggerCapture,
    CopyActiveDisplay,
    CopyActiveWindow,
    CancelCapture,
}

pub fn capture_cancel_id() -> u32 {
    capture_cancel_hotkey().id()
}

pub fn action_for_event(
    event_id: u32,
    ids: RegisteredHotkeyIds,
    in_capture_session: bool,
) -> Option<HotkeyAction> {
    if in_capture_session && event_id == capture_cancel_id() {
        return Some(HotkeyAction::CancelCapture);
    }

    if event_id == ids.capture {
        return Some(HotkeyAction::TriggerCapture);
    }
    if in_capture_session {
        return None;
    }
    if event_id == ids.fullscreen {
        return Some(HotkeyAction::CopyActiveDisplay);
    }
    if event_id == ids.active_window {
        return Some(HotkeyAction::CopyActiveWindow);
    }

    None
}

fn store_current_ids(ids: RegisteredHotkeyIds) {
    CURRENT_CAPTURE_ID.store(ids.capture, Ordering::SeqCst);
    CURRENT_FULLSCREEN_ID.store(ids.fullscreen, Ordering::SeqCst);
    CURRENT_ACTIVE_WINDOW_ID.store(ids.active_window, Ordering::SeqCst);
}

fn capture_cancel_hotkey() -> HotKey {
    HotKey::new(None, Code::Escape)
}

/// Parse strings like "Cmd+Shift+X", "CommandOrControl+Shift+X", "Ctrl+Alt+1".
/// Recognized modifier tokens (case-insensitive): cmd, command, super, meta, ctrl,
/// control, alt, option, shift, commandorcontrol.
pub fn parse_accelerator(s: &str) -> Result<HotKey> {
    let mut mods = Modifiers::empty();
    let mut code: Option<Code> = None;
    for raw in s.split('+').map(str::trim) {
        match raw.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "super" | "meta" => mods |= Modifiers::SUPER,
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            "commandorcontrol" => {
                #[cfg(target_os = "macos")]
                {
                    mods |= Modifiers::SUPER;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    mods |= Modifiers::CONTROL;
                }
            }
            other => {
                code = Some(parse_code(other)?);
            }
        }
    }
    let code = code.ok_or_else(|| anyhow!("missing key code in: {s}"))?;
    Ok(HotKey::new(Some(mods), code))
}

fn parse_code(s: &str) -> Result<Code> {
    let s = s.to_ascii_uppercase();
    if s.len() == 1 {
        let c = s.chars().next().unwrap();
        return Ok(match c {
            'A' => Code::KeyA,
            'B' => Code::KeyB,
            'C' => Code::KeyC,
            'D' => Code::KeyD,
            'E' => Code::KeyE,
            'F' => Code::KeyF,
            'G' => Code::KeyG,
            'H' => Code::KeyH,
            'I' => Code::KeyI,
            'J' => Code::KeyJ,
            'K' => Code::KeyK,
            'L' => Code::KeyL,
            'M' => Code::KeyM,
            'N' => Code::KeyN,
            'O' => Code::KeyO,
            'P' => Code::KeyP,
            'Q' => Code::KeyQ,
            'R' => Code::KeyR,
            'S' => Code::KeyS,
            'T' => Code::KeyT,
            'U' => Code::KeyU,
            'V' => Code::KeyV,
            'W' => Code::KeyW,
            'X' => Code::KeyX,
            'Y' => Code::KeyY,
            'Z' => Code::KeyZ,
            '0' => Code::Digit0,
            '1' => Code::Digit1,
            '2' => Code::Digit2,
            '3' => Code::Digit3,
            '4' => Code::Digit4,
            '5' => Code::Digit5,
            '6' => Code::Digit6,
            '7' => Code::Digit7,
            '8' => Code::Digit8,
            '9' => Code::Digit9,
            _ => return Err(anyhow!("unsupported key '{c}'")),
        });
    }
    if s.starts_with('F') && s[1..].parse::<u8>().is_ok() {
        return s
            .parse::<Code>()
            .map_err(|_| anyhow!("unknown key code '{s}'"));
    }
    Err(anyhow!("unknown key code '{s}'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id_for(accelerator: &str) -> u32 {
        parse_accelerator(accelerator).unwrap().id()
    }

    #[test]
    fn parses_cmd_shift_x() {
        let h = parse_accelerator("Cmd+Shift+X").unwrap();
        let mods = h.mods;
        assert!(mods.contains(Modifiers::SUPER));
        assert!(mods.contains(Modifiers::SHIFT));
        assert_eq!(h.key, Code::KeyX);
    }

    #[test]
    fn parses_ctrl_alt_digit() {
        let h = parse_accelerator("Ctrl+Alt+1").unwrap();
        assert!(h.mods.contains(Modifiers::CONTROL));
        assert!(h.mods.contains(Modifiers::ALT));
        assert_eq!(h.key, Code::Digit1);
    }

    #[test]
    fn parses_function_key_without_modifiers() {
        let h = parse_accelerator("F1").unwrap();

        assert!(h.mods.is_empty());
        assert_eq!(h.key, Code::F1);
    }

    #[test]
    fn rejects_missing_key() {
        assert!(parse_accelerator("Ctrl+Shift").is_err());
    }

    #[test]
    fn escape_hotkey_cancels_only_active_capture_session() {
        let ids = RegisteredHotkeyIds {
            capture: HotKey::new(Some(Modifiers::SUPER), Code::KeyA).id(),
            fullscreen: id_for("Cmd+Shift+F"),
            active_window: id_for("Cmd+Shift+W"),
        };
        let cancel_id = capture_cancel_id();

        assert_eq!(
            action_for_event(cancel_id, ids, true),
            Some(HotkeyAction::CancelCapture)
        );
        assert_eq!(action_for_event(cancel_id, ids, false), None);
    }

    #[test]
    fn current_hotkey_still_triggers_capture() {
        let ids = RegisteredHotkeyIds {
            capture: HotKey::new(Some(Modifiers::SUPER), Code::KeyA).id(),
            fullscreen: id_for("Cmd+Shift+F"),
            active_window: id_for("Cmd+Shift+W"),
        };

        assert_eq!(
            action_for_event(ids.capture, ids, false),
            Some(HotkeyAction::TriggerCapture)
        );
        assert_eq!(
            action_for_event(ids.capture, ids, true),
            Some(HotkeyAction::TriggerCapture)
        );
    }

    #[test]
    fn quick_shot_hotkeys_route_to_distinct_actions_outside_capture_sessions() {
        let ids = RegisteredHotkeyIds {
            capture: id_for("Cmd+Shift+A"),
            fullscreen: id_for("Cmd+Shift+F"),
            active_window: id_for("Cmd+Shift+W"),
        };

        assert_eq!(
            action_for_event(ids.fullscreen, ids, false),
            Some(HotkeyAction::CopyActiveDisplay)
        );
        assert_eq!(
            action_for_event(ids.active_window, ids, false),
            Some(HotkeyAction::CopyActiveWindow)
        );
    }

    #[test]
    fn quick_shot_hotkeys_are_ignored_during_capture_sessions() {
        let ids = RegisteredHotkeyIds {
            capture: id_for("Cmd+Shift+A"),
            fullscreen: id_for("Cmd+Shift+F"),
            active_window: id_for("Cmd+Shift+W"),
        };

        assert_eq!(action_for_event(ids.fullscreen, ids, true), None);
        assert_eq!(action_for_event(ids.active_window, ids, true), None);
    }
}
