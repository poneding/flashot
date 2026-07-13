//! Windows-only low-level keyboard hook that swallows the Windows (Super) key
//! while a capture session is active.
//!
//! The capture overlay only *paints* a frozen screenshot; the desktop
//! underneath stays live. On macOS/Linux the overlay is raised to a shielding
//! window level that suppresses system chrome, but Windows has no equivalent
//! for the Win key — the shell (`explorer.exe`) intercepts it before any
//! ordinary window sees it, so pressing Win still opens the Start menu over
//! our "frozen" screen. A `WH_KEYBOARD_LL` hook is the only reliable way to
//! intercept the Win key before the shell does; returning a non-zero result
//! from the hook proc consumes the key so it never reaches the shell.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use tauri::AppHandle;
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LWIN, VK_RWIN};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT,
    WH_KEYBOARD_LL,
};

/// Installed hook handle (`HHOOK` pointer stored as isize; 0 = not installed).
/// Only mutated on the main (message-loop) thread.
static HOOK: AtomicIsize = AtomicIsize::new(0);
/// Whether the hook should currently swallow keys. Read by the hook proc,
/// which can fire in the brief window between toggling and the install /
/// uninstall task running on the main thread.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Enable or disable Win-key blocking for a capture session. Flips the gate
/// flag immediately, then installs/removes the hook on the Tauri main thread
/// (the only thread with a message loop, which `WH_KEYBOARD_LL` requires).
pub fn set_enabled(app: &AppHandle, enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    let app = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        if enabled {
            install();
        } else {
            uninstall();
        }
    }) {
        tracing::warn!("failed to schedule Win key block update: {e}");
    }
}

/// Keys the hook consumes while blocking is active. Extracted for testing.
fn should_swallow_vk(vk: u32) -> bool {
    vk == VK_LWIN.0 as u32 || vk == VK_RWIN.0 as u32
}

/// Install the low-level keyboard hook. MUST run on the thread that owns the
/// Windows message loop (the Tauri main thread); `WH_KEYBOARD_LL` is serviced
/// by posting to that thread's message queue.
fn install() {
    if HOOK.load(Ordering::SeqCst) != 0 {
        return; // already installed
    }

    let hinstance = match unsafe { GetModuleHandleW(None) } {
        Ok(module) => HINSTANCE(module.0),
        Err(e) => {
            tracing::warn!("failed to get module handle for Win key block hook: {e}");
            return;
        }
    };

    match unsafe {
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), Some(hinstance), 0)
    } {
        Ok(hook) => HOOK.store(hook.0 as isize, Ordering::SeqCst),
        Err(e) => tracing::warn!("failed to install Win key block hook: {e}"),
    }
}

/// Remove the low-level keyboard hook. MUST run on the same (main) thread that
/// installed it.
fn uninstall() {
    let raw = HOOK.swap(0, Ordering::SeqCst);
    if raw == 0 {
        return;
    }
    if let Err(e) = unsafe { UnhookWindowsHookEx(HHOOK(raw as *mut std::ffi::c_void)) } {
        tracing::warn!("failed to remove Win key block hook: {e}");
    }
}

/// Low-level keyboard hook procedure. Runs on the main thread's message loop.
/// Swallows the Win key (returns a non-zero `LRESULT`) while blocking is
/// enabled; otherwise forwards to the next hook.
unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code == HC_ACTION as i32 && ENABLED.load(Ordering::SeqCst) {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if should_swallow_vk(info.vkCode) {
            return LRESULT(1);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_A;

    #[test]
    fn swallows_both_windows_keys() {
        assert!(should_swallow_vk(VK_LWIN.0 as u32));
        assert!(should_swallow_vk(VK_RWIN.0 as u32));
    }

    #[test]
    fn does_not_swallow_ordinary_keys() {
        assert!(!should_swallow_vk(VK_A.0 as u32));
    }
}
