//! Best-effort first-launch screen-recording permission check.
//! Trying to capture once is the simplest probe — a denied capture returns
//! an error immediately on macOS.

#[cfg(target_os = "macos")]
pub fn probe_screen_recording() -> bool {
    match xcap::Monitor::all() {
        Ok(ms) if !ms.is_empty() => ms[0].capture_image().is_ok(),
        _ => false,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn probe_screen_recording() -> bool {
    true
}
