use crate::types::{Rect, WindowRect};
use anyhow::Result;
use std::ffi::{c_void, OsString};
use std::mem;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_VM_READ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
    GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, WINDOW_EX_STYLE, WINDOW_STYLE,
    WS_CAPTION, WS_CHILD, WS_DISABLED, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
};

struct State {
    out: Vec<WindowRect>,
    desktop_out: Vec<WindowRect>,
}

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let mut state = State {
        out: Vec::new(),
        desktop_out: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize));
    }
    state.out.extend(state.desktop_out);
    Ok(state.out)
}

pub fn active_window() -> Result<WindowRect> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            anyhow::bail!("GetForegroundWindow returned null");
        }
        window_rect_from_hwnd(hwnd)
            .ok_or_else(|| anyhow::anyhow!("foreground window is not selectable"))
    }
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lp: LPARAM) -> BOOL {
    let state = &mut *(lp.0 as *mut State);
    let Some(window) = window_rect_from_hwnd(hwnd) else {
        return TRUE;
    };

    let class_name = read_class_name(hwnd);
    let is_desktop_surface = is_desktop_surface_class(&class_name);

    if is_desktop_surface {
        state.desktop_out.push(window);
    } else {
        state.out.push(window);
    }
    TRUE
}

unsafe fn window_rect_from_hwnd(hwnd: HWND) -> Option<WindowRect> {
    if !is_candidate_top_level_window(hwnd) {
        return None;
    }

    let Some(r) = read_visible_rect(hwnd) else {
        return None;
    };
    let width = (r.right - r.left).max(0) as u32;
    let height = (r.bottom - r.top).max(0) as u32;
    if width < 2 || height < 2 {
        return None;
    }

    let title = read_title(hwnd);
    let class_name = read_class_name(hwnd);
    let is_desktop_surface = is_desktop_surface_class(&class_name);
    let (pid, app) = read_owner(hwnd);
    let style = WINDOW_STYLE(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32);
    let ex_style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);

    if !is_selectable_app_window(
        &class_name,
        &title,
        !app.is_empty(),
        style,
        ex_style,
        has_owner(hwnd),
    ) {
        return None;
    }

    let app = if app.is_empty() { class_name } else { app };

    Some(WindowRect {
        rect: Rect {
            x: r.left,
            y: r.top,
            width,
            height,
        },
        title,
        app_name: app,
        pid,
    })
}

unsafe fn is_candidate_top_level_window(hwnd: HWND) -> bool {
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return false;
    }
    if GetAncestor(hwnd, GA_ROOT) != hwnd {
        return false;
    }
    !is_window_cloaked(hwnd)
}

unsafe fn is_window_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    if DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as *mut c_void,
        mem::size_of::<u32>() as u32,
    )
    .is_err()
    {
        return false;
    }

    cloaked != 0
}

unsafe fn read_visible_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    if DwmGetWindowAttribute(
        hwnd,
        DWMWA_EXTENDED_FRAME_BOUNDS,
        &mut rect as *mut RECT as *mut c_void,
        mem::size_of::<RECT>() as u32,
    )
    .is_ok()
        && !is_empty_rect(&rect)
    {
        return Some(rect);
    }

    if GetWindowRect(hwnd, &mut rect).is_ok() && !is_empty_rect(&rect) {
        Some(rect)
    } else {
        None
    }
}

fn is_empty_rect(rect: &RECT) -> bool {
    rect.right <= rect.left || rect.bottom <= rect.top
}

unsafe fn read_class_name(hwnd: HWND) -> String {
    let mut buf = vec![0u16; 256];
    let copied = GetClassNameW(hwnd, &mut buf);
    if copied == 0 {
        return String::new();
    }
    OsString::from_wide(&buf[..copied as usize])
        .to_string_lossy()
        .into_owned()
}

unsafe fn has_owner(hwnd: HWND) -> bool {
    GetWindow(hwnd, GW_OWNER)
        .map(|owner| !owner.0.is_null())
        .unwrap_or(false)
}

fn is_selectable_app_window(
    class_name: &str,
    title: &str,
    has_app_name: bool,
    style: WINDOW_STYLE,
    ex_style: WINDOW_EX_STYLE,
    has_owner: bool,
) -> bool {
    if is_selectable_system_surface_class(class_name) {
        return true;
    }
    if is_non_selectable_system_class(class_name) {
        return false;
    }
    if style.contains(WS_CHILD) || style.contains(WS_DISABLED) {
        return false;
    }
    if ex_style.contains(WS_EX_TOOLWINDOW) {
        return false;
    }
    if ex_style.contains(WS_EX_NOACTIVATE) && !ex_style.contains(WS_EX_APPWINDOW) {
        return false;
    }
    if has_owner && !ex_style.contains(WS_EX_APPWINDOW) {
        return false;
    }

    let has_title = !title.trim().is_empty();
    let has_window_chrome = style.contains(WS_CAPTION)
        || style.contains(WS_THICKFRAME)
        || style.contains(WS_SYSMENU)
        || style.contains(WS_POPUP);

    has_title || has_app_name || has_window_chrome || ex_style.contains(WS_EX_APPWINDOW)
}

fn is_selectable_system_surface_class(class_name: &str) -> bool {
    is_desktop_surface_class(class_name)
        || matches!(class_name, "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

fn is_desktop_surface_class(class_name: &str) -> bool {
    matches!(class_name, "Progman" | "WorkerW")
}

fn is_non_selectable_system_class(class_name: &str) -> bool {
    matches!(
        class_name,
        "NotifyIconOverflowWindow"
            | "Button"
            | "SysShadow"
            | "tooltips_class32"
            | "#32768"
            | "MSCTFIME UI"
            | "IME"
    )
}

unsafe fn read_title(hwnd: HWND) -> String {
    let len = GetWindowTextLengthW(hwnd);
    if len == 0 {
        return String::new();
    }
    let mut buf = vec![0u16; (len + 1) as usize];
    let copied = GetWindowTextW(hwnd, &mut buf);
    if copied == 0 {
        return String::new();
    }
    OsString::from_wide(&buf[..copied as usize])
        .to_string_lossy()
        .into_owned()
}

unsafe fn read_owner(hwnd: HWND) -> (u32, String) {
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return (0, String::new());
    }
    if let Some(name) = read_process_image_name(pid) {
        return (pid, name);
    }

    let flags = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ;
    let Ok(handle) = OpenProcess(flags, false, pid) else {
        return (pid, String::new());
    };
    let mut buf = vec![0u16; 260];
    let len = GetModuleBaseNameW(handle, None, &mut buf);
    let _ = CloseHandle(handle);
    if len == 0 {
        return (pid, String::new());
    }
    let name = OsString::from_wide(&buf[..len as usize])
        .to_string_lossy()
        .into_owned();
    (pid, name)
}

unsafe fn read_process_image_name(pid: u32) -> Option<String> {
    let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
        return None;
    };

    let mut buf = vec![0u16; 32768];
    let mut len = buf.len() as u32;
    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(buf.as_mut_ptr()),
        &mut len,
    );
    let _ = CloseHandle(handle);

    if result.is_err() || len == 0 {
        return None;
    }

    let path = OsString::from_wide(&buf[..len as usize])
        .to_string_lossy()
        .into_owned();

    Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_desktop_and_taskbar_surfaces_selectable() {
        for class_name in [
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "Progman",
            "WorkerW",
        ] {
            assert!(is_selectable_system_surface_class(class_name));
            assert!(is_selectable_app_window(
                class_name,
                "",
                true,
                WS_POPUP,
                WS_EX_TOOLWINDOW,
                false,
            ));
        }
    }

    #[test]
    fn rejects_transient_system_surfaces() {
        assert!(!is_selectable_app_window(
            "tooltips_class32",
            "Tooltip",
            true,
            WS_POPUP,
            WINDOW_EX_STYLE::default(),
            false,
        ));
    }

    #[test]
    fn keeps_normal_application_windows() {
        assert!(is_selectable_app_window(
            "Chrome_WidgetWin_1",
            "Project - Editor",
            true,
            WS_CAPTION | WS_THICKFRAME | WS_SYSMENU,
            WINDOW_EX_STYLE::default(),
            false,
        ));
    }

    #[test]
    fn rejects_owned_tool_popups_without_appwindow_style() {
        assert!(!is_selectable_app_window(
            "Chrome_WidgetWin_1",
            "Tooltip",
            true,
            WS_POPUP,
            WINDOW_EX_STYLE::default(),
            true,
        ));
    }
}
