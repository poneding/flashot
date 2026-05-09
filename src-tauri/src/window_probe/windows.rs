use crate::types::{Rect, WindowRect};
use anyhow::Result;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible,
};

struct State {
    out: Vec<WindowRect>,
}

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let mut state = State { out: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize));
    }
    Ok(state.out)
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lp: LPARAM) -> BOOL {
    let state = &mut *(lp.0 as *mut State);
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return TRUE;
    }
    let mut r = RECT::default();
    if GetWindowRect(hwnd, &mut r).is_err() {
        return TRUE;
    }
    let width = (r.right - r.left).max(0) as u32;
    let height = (r.bottom - r.top).max(0) as u32;
    if width < 2 || height < 2 {
        return TRUE;
    }

    let title = read_title(hwnd);
    let (pid, app) = read_owner(hwnd);
    if app.is_empty() {
        return TRUE;
    }

    state.out.push(WindowRect {
        rect: Rect { x: r.left, y: r.top, width, height },
        title,
        app_name: app,
        pid,
    });
    TRUE
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
    let flags = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ;
    let Ok(handle) = OpenProcess(flags, false, pid) else {
        return (pid, String::new());
    };
    let mut buf = vec![0u16; 260];
    let len = GetModuleBaseNameW(handle, None, &mut buf);
    let _ = windows::Win32::Foundation::CloseHandle(handle);
    if len == 0 {
        return (pid, String::new());
    }
    let name = OsString::from_wide(&buf[..len as usize])
        .to_string_lossy()
        .into_owned();
    (pid, name)
}
