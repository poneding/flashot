use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
pub fn schedule_app_deactivation_macos(app: &AppHandle) {
    if let Err(e) = app.run_on_main_thread(deactivate_app_macos_on_main_thread) {
        tracing::warn!("failed to schedule app deactivation on main thread: {e}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn schedule_app_deactivation_macos(_app: &AppHandle) {}

/// Deactivate the Flashot application on macOS so the previously-active app
/// regains focus after capture overlays are hidden. AppKit requires this to
/// run on the main thread; callers must dispatch via `run_on_main_thread`
/// (see `schedule_app_deactivation_macos` and `deactivate_then_hide_overlays_macos`).
#[cfg(target_os = "macos")]
fn deactivate_app_macos_on_main_thread() {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };

    unsafe {
        if let Some(app_class) = Class::get("NSApplication") {
            let app: *mut Object =
                match app_class.send_message(Sel::register("sharedApplication"), ()) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!("sharedApplication failed: {e}");
                        return;
                    }
                };
            if !app.is_null() {
                if let Err(e) = (*app).send_message::<_, ()>(Sel::register("deactivate"), ()) {
                    tracing::warn!("NSApp deactivate failed: {e}");
                }
            }
        }
    }
}

/// End-of-capture cleanup for macOS: deactivate the app FIRST, then hide the
/// overlay windows — atomically, in a single main-thread task. If overlays
/// were hidden while the app was still active, AppKit would promote the next
/// visible Flashot window (Settings/About/Updater) to key and bring it to
/// front; a later deactivate does not undo that reorder.
///
/// Returns `true` when the combined task was scheduled. `false` means the
/// caller must hide the overlays itself (non-macOS, or scheduling failed).
pub fn deactivate_then_hide_overlays_macos(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            deactivate_then_hide_overlays_macos_on_main_thread(&handle);
        }) {
            tracing::warn!("failed to schedule capture-end deactivation: {e}");
            return false;
        }
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
}

#[cfg(target_os = "macos")]
fn deactivate_then_hide_overlays_macos_on_main_thread(app: &AppHandle) {
    deactivate_app_macos_on_main_thread();
    hide_overlay_windows(app);
}

/// Hide every capture overlay window. Single source of truth for all
/// session-end paths.
pub(crate) fn hide_overlay_windows(app: &AppHandle) {
    for (_label, w) in app.webview_windows() {
        let label = w.label();
        if label.starts_with("overlay-chrome-") {
            // Chrome windows must be closed, not hidden — otherwise the next
            // scroll session reuses a stale hidden window. Their lifecycle
            // is bound to a single scroll session.
            let _ = w.close();
        } else if label.starts_with("overlay-") {
            #[cfg(target_os = "linux")]
            let _ = w.set_fullscreen(false);
            #[cfg(not(target_os = "linux"))]
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn macos_deactivation_is_scheduled_on_main_thread() {
        let source = include_str!("app_activation.rs").replace("\r\n", "\n");
        let helper_start = source
            .find("pub fn schedule_app_deactivation_macos")
            .expect("missing macOS main-thread scheduling helper");
        let helper_end = source[helper_start..]
            .find("fn deactivate_app_macos_on_main_thread")
            .map(|idx| helper_start + idx)
            .expect("missing main-thread AppKit helper");
        let helper_body = &source[helper_start..helper_end];

        assert!(
            helper_body.contains(".run_on_main_thread("),
            "macOS app deactivation must be dispatched to the main thread",
        );
    }

    #[test]
    fn deactivate_then_hide_runs_deactivation_first() {
        let source = include_str!("app_activation.rs").replace("\r\n", "\n");
        let implementation = source
            .split("#[cfg(test)]")
            .next()
            .expect("implementation source should be present");
        let start = implementation
            .find("fn deactivate_then_hide_overlays_macos_on_main_thread")
            .expect("combined helper missing");
        let body = &implementation[start..];
        let deactivate_pos = body
            .find("deactivate_app_macos_on_main_thread")
            .expect("must deactivate");
        let hide_pos = body
            .find("hide_overlay_windows")
            .expect("must hide overlays");
        assert!(
            deactivate_pos < hide_pos,
            "deactivation must run before overlay hiding",
        );
    }

    #[test]
    fn capture_cleanup_does_not_compensate_by_ordering_windows_back() {
        let source = include_str!("app_activation.rs").replace("\r\n", "\n");
        let implementation = source
            .split("#[cfg(test)]")
            .next()
            .expect("implementation source should be present");

        assert!(
            !implementation.contains("orderBack:"),
            "capture cleanup must not move utility windows behind their original z-order",
        );
    }
}
