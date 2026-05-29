use tauri::AppHandle;

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
/// run on the main thread; callers must go through `schedule_app_deactivation_macos`.
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
