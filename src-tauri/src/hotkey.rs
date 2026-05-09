use anyhow::{anyhow, Result};
use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager,
};
use parking_lot::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

static CURRENT_ID: AtomicU32 = AtomicU32::new(0);

pub struct HotkeyService {
    mgr: GlobalHotKeyManager,
    current: Mutex<Option<HotKey>>,
}

impl HotkeyService {
    pub fn new() -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            mgr: GlobalHotKeyManager::new()?,
            current: Mutex::new(None),
        }))
    }

    pub fn set(&self, accelerator: &str) -> Result<u32> {
        let parsed = parse_accelerator(accelerator)?;
        let mut cur = self.current.lock();
        if let Some(old) = cur.take() {
            let _ = self.mgr.unregister(old);
        }
        self.mgr.register(parsed)?;
        let id = parsed.id();
        CURRENT_ID.store(id, Ordering::SeqCst);
        *cur = Some(parsed);
        Ok(id)
    }

    /// Returns the global event receiver. Subscribe once at startup;
    /// match incoming `event.id` against `current_id()`.
    pub fn receiver(&self) -> &'static crossbeam_channel::Receiver<GlobalHotKeyEvent> {
        GlobalHotKeyEvent::receiver()
    }
}

pub fn current_id() -> u32 {
    CURRENT_ID.load(Ordering::SeqCst)
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
                { mods |= Modifiers::SUPER; }
                #[cfg(not(target_os = "macos"))]
                { mods |= Modifiers::CONTROL; }
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
            'A' => Code::KeyA, 'B' => Code::KeyB, 'C' => Code::KeyC, 'D' => Code::KeyD,
            'E' => Code::KeyE, 'F' => Code::KeyF, 'G' => Code::KeyG, 'H' => Code::KeyH,
            'I' => Code::KeyI, 'J' => Code::KeyJ, 'K' => Code::KeyK, 'L' => Code::KeyL,
            'M' => Code::KeyM, 'N' => Code::KeyN, 'O' => Code::KeyO, 'P' => Code::KeyP,
            'Q' => Code::KeyQ, 'R' => Code::KeyR, 'S' => Code::KeyS, 'T' => Code::KeyT,
            'U' => Code::KeyU, 'V' => Code::KeyV, 'W' => Code::KeyW, 'X' => Code::KeyX,
            'Y' => Code::KeyY, 'Z' => Code::KeyZ,
            '0' => Code::Digit0, '1' => Code::Digit1, '2' => Code::Digit2,
            '3' => Code::Digit3, '4' => Code::Digit4, '5' => Code::Digit5,
            '6' => Code::Digit6, '7' => Code::Digit7, '8' => Code::Digit8,
            '9' => Code::Digit9,
            _ => return Err(anyhow!("unsupported key '{c}'")),
        });
    }
    Err(anyhow!("unknown key code '{s}'"))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rejects_missing_key() {
        assert!(parse_accelerator("Ctrl+Shift").is_err());
    }
}
