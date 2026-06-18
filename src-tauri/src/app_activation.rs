use tauri::{AppHandle, Manager, WebviewWindow};

/// An opaque handle to the app that was frontmost when a capture session
/// started. On macOS it retains an `NSRunningApplication`; off macOS it is a
/// zero-sized placeholder.
///
/// Restoring focus to this app at session end is what returns Flashot's
/// utility windows (Settings/About/Updater) to their original background
/// z-order. Plain `[NSApp deactivate]` only relinquishes frontmost status —
/// it does NOT push windows that the activation bumped forward back down, so
/// the previously-frontmost app must be explicitly reactivated (which pulls
/// its whole window stack forward, covering Flashot's utility windows again).
#[cfg(target_os = "macos")]
pub struct PreviousFrontmostApp {
    raw: *mut objc::runtime::Object,
}

#[cfg(target_os = "macos")]
impl Default for PreviousFrontmostApp {
    fn default() -> Self {
        Self {
            raw: core::ptr::null_mut(),
        }
    }
}

#[cfg(target_os = "macos")]
// SAFETY: `NSRunningApplication` is designed for cross-thread use (notably
// `activateWithOptions:`), and we only perform thread-safe retain/release and
// the activate call. The raw pointer is never dereferenced off the main thread
// except through retain/release, which are themselves thread-safe refcount ops.
unsafe impl Send for PreviousFrontmostApp {}

#[cfg(target_os = "macos")]
unsafe impl Sync for PreviousFrontmostApp {}

#[cfg(target_os = "macos")]
impl Drop for PreviousFrontmostApp {
    fn drop(&mut self) {
        if self.raw.is_null() {
            return;
        }
        // NSRunningApplication retain/release are thread-safe refcount ops,
        // so releasing here (possibly off the main thread) is safe.
        unsafe {
            use objc::{runtime::Sel, Message};
            let _ = (*self.raw).send_message::<_, ()>(Sel::register("release"), ());
        }
        self.raw = core::ptr::null_mut();
    }
}

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
pub struct PreviousFrontmostApp;

/// Capture the app that is currently frontmost. Must be called once at the
/// start of a capture session, BEFORE Flashot activates itself for the overlay.
/// Dispatches the AppKit read to the main thread.
pub fn capture_previous_frontmost_app(app: &AppHandle) -> PreviousFrontmostApp {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::sync_channel::<PreviousFrontmostApp>(1);
        if app
            .run_on_main_thread(move || {
                let captured = capture_frontmost_app_on_main_thread();
                let _ = tx.send(captured);
            })
            .is_err()
        {
            tracing::warn!("failed to schedule frontmost app capture on main thread");
            return PreviousFrontmostApp::default();
        }
        rx.recv().unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        PreviousFrontmostApp
    }
}

/// Activate Flashot so the capture overlay's cursor is honored. macOS only
/// displays the cursor owned by the frontmost app, so the overlay (shown
/// without activation historically) never got its crosshair to stick. Calling
/// this right after the overlay covers the screen makes Flashot frontmost
/// without any visible window reshuffle (the overlay is already on top).
pub fn activate_flashot_for_capture(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = app.run_on_main_thread(activate_flashot_on_main_thread) {
            tracing::warn!("failed to schedule flashot activation: {e}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

/// Reactivate the app that was frontmost before capture began, so its window
/// stack returns to the front and Flashot's utility windows drop back to their
/// original background position. Used by scroll capture (which needs the
/// underlying app frontmost to receive wheel events) and by save-dialog paths.
/// Returns `true` when the reactivation was scheduled on a non-null handle.
pub fn reactivate_previous_app(app: &AppHandle, previous: &PreviousFrontmostApp) -> bool {
    #[cfg(target_os = "macos")]
    {
        let raw_addr = previous.raw as usize;
        let has_previous = !previous.raw.is_null();
        let (tx, rx) = std::sync::mpsc::channel();
        if let Err(e) = app.run_on_main_thread(move || {
            if has_previous {
                reactivate_previous_app_on_main_thread(raw_addr as *mut objc::runtime::Object);
            } else {
                deactivate_app_macos_on_main_thread();
            }
            let _ = tx.send(());
        }) {
            tracing::warn!("failed to schedule previous app reactivation: {e}");
            return false;
        }
        // BLOCK until the main-thread task completes. Without this, a caller
        // that owns `previous` (e.g. `restore_focus_to_previous_app`) would drop
        // — and release — the retained NSRunningApplication before
        // activateWithOptions dereferences it, crashing the app via a dangling
        // pointer.
        let _ = rx.recv_timeout(std::time::Duration::from_millis(500));
        has_previous
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, previous);
        false
    }
}

/// End-of-capture cleanup for macOS: reactivate the previously-frontmost app
/// FIRST, then hide the overlay windows — atomically, in a single main-thread
/// task. Reactivating the previous app makes Flashot non-frontmost before the
/// overlay (its key window) is hidden, so AppKit never promotes a Flashot
/// utility window to key and bring it forward unexpectedly (utility windows
/// are pinned to the floating level by design — see `commands.rs` — so even
/// if promoted they are already where the user expects).
///
/// Returns `true` when the combined task was scheduled. `false` means the
/// caller must hide the overlays itself (non-macOS, or scheduling failed).
pub fn reactivate_then_hide_overlays_macos(
    app: &AppHandle,
    previous: &PreviousFrontmostApp,
) -> bool {
    #[cfg(target_os = "macos")]
    {
        let raw_addr = previous.raw as usize;
        let handle = app.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        if let Err(e) = app.run_on_main_thread(move || {
            let ptr = raw_addr as *mut objc::runtime::Object;
            if !ptr.is_null() {
                reactivate_previous_app_on_main_thread(ptr);
            } else {
                deactivate_app_macos_on_main_thread();
            }
            hide_overlay_windows(&handle);
            let _ = tx.send(());
        }) {
            tracing::warn!("failed to schedule capture-end restore: {e}");
            return false;
        }
        // Block until the main-thread task completes or timeout. This prevents
        // AppKit from promoting utility windows in the gap between queueing
        // the restore task and its execution.
        let _ = rx.recv_timeout(std::time::Duration::from_millis(500));
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, previous);
        false
    }
}

#[cfg(target_os = "macos")]
fn capture_frontmost_app_on_main_thread() -> PreviousFrontmostApp {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };

    unsafe {
        let Some(workspace_class) = Class::get("NSWorkspace") else {
            return PreviousFrontmostApp::default();
        };
        let workspace: *mut Object =
            match workspace_class.send_message(Sel::register("sharedWorkspace"), ()) {
                Ok(w) => w,
                Err(e) => {
                    tracing::warn!("NSWorkspace sharedWorkspace failed: {e}");
                    return PreviousFrontmostApp::default();
                }
            };
        if workspace.is_null() {
            return PreviousFrontmostApp::default();
        }
        let app: *mut Object = match (*workspace).send_message(Sel::register("frontmostApplication"), ())
        {
            Ok(app) => app,
            Err(e) => {
                tracing::warn!("NSWorkspace frontmostApplication failed: {e}");
                return PreviousFrontmostApp::default();
            }
        };
        if app.is_null() {
            return PreviousFrontmostApp::default();
        }
        // Retain so the handle outlives the current autorelease pool and any
        // subsequent app activation/termination.
        let _ = (*app).send_message::<_, ()>(Sel::register("retain"), ());
        PreviousFrontmostApp { raw: app }
    }
}

#[cfg(target_os = "macos")]
fn activate_flashot_on_main_thread() {
    use objc::{
        runtime::{Class, Object, Sel, YES},
        Message,
    };

    unsafe {
        let Some(app_class) = Class::get("NSApplication") else {
            return;
        };
        let app: *mut Object = match app_class.send_message(Sel::register("sharedApplication"), ()) {
            Ok(app) => app,
            Err(e) => {
                tracing::warn!("sharedApplication failed: {e}");
                return;
            }
        };
        if app.is_null() {
            return;
        }
        // `activateIgnoringOtherApps:` is deprecated in macOS 14+ but remains
        // functional across all supported targets (the 14+ `[NSApp activate]`
        // replacement is unavailable when building for older deployment
        // targets). YES forces Flashot to frontmost so the overlay cursor is
        // honored. The overlay already covers the screen, so no utility
        // window is seen jumping forward at this moment; the original
        // frontmost app is restored on session end.
        if let Err(e) = (*app).send_message::<_, ()>(Sel::register("activateIgnoringOtherApps:"), (YES,))
        {
            tracing::warn!("NSApp activateIgnoringOtherApps failed: {e}");
        }
    }
}

#[cfg(target_os = "macos")]
fn reactivate_previous_app_on_main_thread(raw: *mut objc::runtime::Object) {
    use objc::{
        runtime::{Sel, BOOL},
        Message,
    };

    if raw.is_null() {
        return;
    }

    // NSApplicationActivateAllWindows = 1 << 0
    // NSApplicationActivateIgnoringOtherApps = 1 << 1
    // AllWindows pulls the restored app's entire window stack forward so it
    // reliably covers Flashot's utility windows; IgnoringOtherApps forces the
    // handoff even if another app grabbed focus mid-session.
    const OPTIONS: usize = (1 << 0) | (1 << 1);

    unsafe {
        let app = &*raw;
        if let Err(e) = app.send_message::<_, BOOL>(Sel::register("activateWithOptions:"), (OPTIONS,))
        {
            tracing::warn!("NSRunningApplication activateWithOptions failed: {e}");
        }
    }
}

/// Deactivate the Flashot application on macOS. Used only as a fallback when
/// no previous frontmost app was captured. AppKit requires this to run on the
/// main thread; callers dispatch via `run_on_main_thread`.
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
            if !app.is_null()
                && let Err(e) = (*app).send_message::<_, ()>(Sel::register("deactivate"), ()) {
                    tracing::warn!("NSApp deactivate failed: {e}");
                }
        }
    }
}

/// `kCGFloatingWindowLevel` (3) — always-on-top, above normal app windows but
/// below menus / overlays. Utility windows are pinned at this level (and small
/// offsets above it for ordering — see `commands.rs`).
#[cfg(target_os = "macos")]
pub(crate) const FLOATING_WINDOW_LEVEL: isize = 3;

/// `setLevel:` changes a window's stacking layer without toggling visibility.
/// It is a stable NSWindow operation (no NSException risk, unlike `orderOut:`/
/// `orderFront:` on windows mid-interaction). Must run on the main thread.
#[cfg(target_os = "macos")]
pub(crate) fn set_window_level(window: &WebviewWindow, level: isize) -> Result<(), ()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };
    let ns_window = window.ns_window().map_err(|_| ())? as *mut Object;
    unsafe {
        let _ = (*ns_window).send_message::<_, ()>(Sel::register("setLevel:"), (level,));
    }
    Ok(())
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
    fn capture_restore_reactivates_previous_app_before_hiding_overlays() {
        let source = include_str!("app_activation.rs").replace("\r\n", "\n");
        let implementation = source
            .split("#[cfg(test)]")
            .next()
            .expect("implementation source should be present");
        let helper_start = implementation
            .find("pub fn reactivate_then_hide_overlays_macos")
            .expect("restore entrypoint missing");
        let helper_end = implementation[helper_start..]
            .find("fn capture_frontmost_app_on_main_thread")
            .map(|idx| helper_start + idx)
            .expect("capture helper should follow");
        let entry = &implementation[helper_start..helper_end];

        let reactivate_idx = entry
            .find("reactivate_previous_app_on_main_thread(ptr)")
            .expect("must reactivate previous app");
        let hide_idx = entry
            .find("hide_overlay_windows(&handle)")
            .expect("must hide overlays");
        assert!(
            reactivate_idx < hide_idx,
            "reactivating the previous app must happen before overlays are hidden, \
             otherwise AppKit promotes a utility window to key when the overlay (Flashot's \
             key window) disappears while Flashot is still frontmost",
        );
    }

    #[test]
    fn capture_restore_uses_running_application_activation_options() {
        let source = include_str!("app_activation.rs").replace("\r\n", "\n");
        let implementation = source
            .split("#[cfg(test)]")
            .next()
            .expect("implementation source should be present");

        assert!(
            implementation.contains("activateWithOptions:")
                && implementation.contains("frontmostApplication")
                && implementation.contains("sharedWorkspace"),
            "focus restore must capture and reactivate the real previous frontmost app",
        );
        assert!(
            !implementation.contains("orderBack:"),
            "capture cleanup must not move utility windows behind their original z-order",
        );
    }
}
