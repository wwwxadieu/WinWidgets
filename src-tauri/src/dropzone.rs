//! Đăng ký IDropTarget riêng cho cửa sổ Mở nhanh.
//!
//! WebView2 tự đăng ký drop target của nó lên các cửa sổ con *sau khi* wry đã cài handler,
//! nên thả tệp không bao giờ tới được Tauri. Ta đăng ký lại một IDropTarget của app lên cửa sổ
//! Mở nhanh và toàn bộ cửa sổ con của nó sau khi cửa sổ đã hiển thị (và mỗi lần hiện lại).

#![cfg(windows)]

use std::cell::Cell;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::time::Duration;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{implement, Ref, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, POINTL};
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, RevokeDragDrop, CF_HDROP, DROPEFFECT,
    DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragFinish, DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

const LABEL: &str = "launcher";

#[implement(IDropTarget)]
struct LauncherDropTarget {
    app: AppHandle,
    valid: Cell<bool>,
}

/// Đọc danh sách đường dẫn CF_HDROP từ IDataObject; trả về HDROP để giải phóng sau.
unsafe fn read_paths(data: Ref<'_, IDataObject>) -> (Vec<PathBuf>, Option<HDROP>) {
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let Some(obj) = data.as_ref() else {
        return (Vec::new(), None);
    };
    match obj.GetData(&format) {
        Ok(medium) => {
            let hdrop = HDROP(medium.u.hGlobal.0 as _);
            let count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
            let mut paths = Vec::with_capacity(count as usize);
            for i in 0..count {
                let len = DragQueryFileW(hdrop, i, None) as usize;
                let mut buf = vec![0u16; len + 1];
                DragQueryFileW(hdrop, i, Some(&mut buf));
                paths.push(PathBuf::from(OsString::from_wide(&buf[..len])));
            }
            (paths, Some(hdrop))
        }
        Err(_) => (Vec::new(), None),
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for LauncherDropTarget_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let (paths, hdrop) = unsafe { read_paths(data) };
        if let Some(h) = hdrop {
            unsafe { DragFinish(h) };
        }
        let ok = !paths.is_empty();
        self.valid.set(ok);
        unsafe {
            *effect = if ok { DROPEFFECT_COPY } else { DROPEFFECT_NONE };
        }
        if ok {
            crate::log_line(&format!("dropzone: kéo vào {} mục", paths.len()));
            let _ = self.app.emit_to(LABEL, "launcher-drag", true);
        }
        Ok(())
    }

    fn DragOver(
        &self,
        _keys: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe {
            *effect = if self.valid.get() { DROPEFFECT_COPY } else { DROPEFFECT_NONE };
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        if self.valid.replace(false) {
            let _ = self.app.emit_to(LABEL, "launcher-drag", false);
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let (paths, hdrop) = unsafe { read_paths(data) };
        if let Some(h) = hdrop {
            unsafe { DragFinish(h) };
        }
        self.valid.set(false);
        let _ = self.app.emit_to(LABEL, "launcher-drag", false);
        unsafe {
            *effect = if paths.is_empty() { DROPEFFECT_NONE } else { DROPEFFECT_COPY };
        }
        if !paths.is_empty() {
            let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            crate::log_line(&format!("dropzone: thả {} mục: {}", list.len(), list.join(" | ")));
            let app = self.app.clone();
            std::thread::spawn(move || {
                if let Err(e) = crate::add_launcher(&app, list) {
                    crate::log_line(&format!("dropzone: thêm thất bại: {e}"));
                }
            });
        }
        Ok(())
    }
}

struct RegisterCtx {
    target: IDropTarget,
    count: usize,
}

unsafe fn register(hwnd: HWND, ctx: &mut RegisterCtx) {
    let _ = RevokeDragDrop(hwnd);
    if RegisterDragDrop(hwnd, &ctx.target).is_ok() {
        ctx.count += 1;
    }
}

unsafe extern "system" fn enum_children(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut RegisterCtx);
    register(hwnd, ctx);
    BOOL(1)
}

fn window_hwnd(w: &WebviewWindow) -> Option<HWND> {
    let handle = w.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(h) => Some(HWND(h.hwnd.get() as *mut core::ffi::c_void)),
        _ => None,
    }
}

/// Đăng ký (lại) drop target lên cửa sổ Mở nhanh và mọi cửa sổ con. Phải gọi trên luồng chính.
pub fn install(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else {
        return;
    };
    let Some(hwnd) = window_hwnd(&w) else {
        return;
    };
    let target: IDropTarget = LauncherDropTarget {
        app: app.clone(),
        valid: Cell::new(false),
    }
    .into();
    let mut ctx = RegisterCtx { target, count: 0 };
    unsafe {
        register(hwnd, &mut ctx);
        let _ = EnumChildWindows(
            Some(hwnd),
            Some(enum_children),
            LPARAM(&mut ctx as *mut RegisterCtx as isize),
        );
    }
    crate::log_line(&format!("dropzone: đã đăng ký drop target lên {} cửa sổ", ctx.count));
}

/// Lên lịch đăng ký sau một khoảng trễ (để WebView2 tạo xong cửa sổ con), chạy trên luồng chính.
pub fn install_later(app: &AppHandle, delay_ms: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        let inner = app.clone();
        let _ = app.run_on_main_thread(move || install(&inner));
    });
}
