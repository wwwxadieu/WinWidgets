//! WinWidgets: bộ widget màn hình cho Windows 11.
//! Mỗi widget là một cửa sổ trong suốt riêng (nền acrylic), điều khiển qua khay hệ thống.

mod claude_usage;
mod disks;
mod dropzone;
mod launcher;
mod network;
mod power;
mod settings;

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, ContextMenu, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, DragDropEvent, Emitter, Manager, PhysicalPosition, PhysicalSize, State, Theme,
    WebviewWindow, WindowEvent, Wry,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

use settings::{LaunchItem, Settings};

/// (nhãn cửa sổ, tên hiển thị)
pub const WIDGETS: [(&str, &str); 8] = [
    ("clock", "Đồng hồ"),
    ("network", "Tốc độ mạng"),
    ("weather", "Thời tiết"),
    ("calendar", "Lịch"),
    ("claude", "Claude"),
    ("disks", "Ổ đĩa"),
    ("power", "Nguồn"),
    ("launcher", "Mở nhanh"),
];

/// Các mức phóng to trong menu chuột phải (phần trăm).
const SCALE_OPTIONS: [(u32, &str); 4] = [(85, "Nhỏ"), (100, "Vừa"), (120, "Lớn"), (140, "Rất lớn")];

/// Chu kỳ làm mới theo widget: (mili giây, nhãn). Widget không có mục này thì không có menu làm mới.
fn refresh_options(label: &str) -> &'static [(u64, &'static str)] {
    match label {
        "network" => &[(500, "0,5 giây"), (1000, "1 giây"), (2000, "2 giây"), (5000, "5 giây")],
        "weather" => &[(300_000, "5 phút"), (900_000, "15 phút"), (1_800_000, "30 phút"), (3_600_000, "60 phút")],
        "claude" => &[(30_000, "30 giây"), (60_000, "1 phút"), (300_000, "5 phút"), (900_000, "15 phút")],
        "disks" => &[(10_000, "10 giây"), (30_000, "30 giây"), (60_000, "1 phút"), (300_000, "5 phút")],
        _ => &[],
    }
}

fn default_refresh(label: &str) -> u64 {
    match label {
        "network" => 1000,
        "weather" => 900_000,
        "claude" => 60_000,
        "disks" => 30_000,
        _ => 0,
    }
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub positions_dirty: AtomicBool,
    pub tray_items: Mutex<HashMap<String, CheckMenuItem<Wry>>>,
    pub claude: Arc<claude_usage::Scanner>,
    pub vibrancy: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsage {
    pub summary: claude_usage::Summary,
    pub official: claude_usage::Official,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub config_dir: String,
    pub claude_dir: String,
    pub vibrancy: bool,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Ghi một dòng chẩn đoán vào winwidgets.log (tự cắt khi quá 1 MB).
pub fn log_line(message: &str) {
    let path = settings::data_dir().join("winwidgets.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 1_000_000 {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), message);
    }
}

fn widget_windows(app: &AppHandle) -> Vec<(&'static str, WebviewWindow)> {
    WIDGETS
        .iter()
        .filter_map(|(label, _)| app.get_webview_window(label).map(|w| (*label, w)))
        .collect()
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    lock(&state.settings).clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let merged = {
        let state = app.state::<AppState>();
        let mut current = lock(&state.settings);
        let positions = std::mem::take(&mut current.positions);
        let mut next = settings;
        next.positions = positions;
        *current = next.clone();
        next
    };
    settings::save(&merged).map_err(err)?;
    apply_pin_mode(&app, &merged.pin_mode);
    apply_visibility(&app, &merged.hidden);
    apply_autostart(&app, merged.autostart);
    apply_vibrancy(&app, &merged);
    sync_tray_checks(&app, &merged);
    let _ = app.emit("settings-changed", &merged);
    Ok(())
}

#[tauri::command]
fn set_widget_visible(app: AppHandle, label: String, visible: bool) {
    set_visible(&app, &label, visible);
}

/// Menu chuột phải của một widget: kích thước, chu kỳ làm mới, cài đặt.
#[tauri::command]
fn show_widget_menu(app: AppHandle, label: String) -> Result<(), String> {
    let (scale_pct, interval) = {
        let state = app.state::<AppState>();
        let s = lock(&state.settings);
        (
            (s.scale.get(&label).copied().unwrap_or(1.0) * 100.0).round() as u32,
            s.refresh.get(&label).copied().unwrap_or_else(|| default_refresh(&label)),
        )
    };

    let size_items: Vec<CheckMenuItem<Wry>> = SCALE_OPTIONS
        .iter()
        .map(|(pct, text)| {
            CheckMenuItem::with_id(&app, format!("scale:{label}:{pct}"), *text, true, *pct == scale_pct, None::<&str>)
        })
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let size_refs: Vec<&dyn IsMenuItem<Wry>> = size_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let size_menu = Submenu::with_items(&app, "Kích thước", true, &size_refs).map_err(err)?;

    let options = refresh_options(&label);
    let interval_items: Vec<CheckMenuItem<Wry>> = options
        .iter()
        .map(|(ms, text)| {
            CheckMenuItem::with_id(&app, format!("interval:{label}:{ms}"), *text, true, *ms == interval, None::<&str>)
        })
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let interval_refs: Vec<&dyn IsMenuItem<Wry>> =
        interval_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let interval_menu = Submenu::with_items(&app, "Làm mới mỗi", true, &interval_refs).map_err(err)?;
    let refresh_now = MenuItem::with_id(&app, format!("refresh:{label}"), "Làm mới ngay", true, None::<&str>)
        .map_err(err)?;

    let sep1 = PredefinedMenuItem::separator(&app).map_err(err)?;
    let hide = MenuItem::with_id(&app, format!("hide:{label}"), "Ẩn widget này", true, None::<&str>).map_err(err)?;
    let settings_item = MenuItem::with_id(&app, "settings", "Cài đặt…", true, None::<&str>).map_err(err)?;
    let sep2 = PredefinedMenuItem::separator(&app).map_err(err)?;
    let quit = MenuItem::with_id(&app, "quit", "Thoát WinWidgets", true, None::<&str>).map_err(err)?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> = vec![&size_menu];
    if !options.is_empty() {
        items.push(&interval_menu);
        items.push(&refresh_now);
    }
    items.push(&sep1);
    items.push(&hide);
    items.push(&settings_item);
    items.push(&sep2);
    items.push(&quit);
    let menu = Menu::with_items(&app, &items).map_err(err)?;
    let webview = app
        .get_webview_window(&label)
        .ok_or_else(|| "Không tìm thấy cửa sổ".to_string())?;
    menu.popup(webview.as_ref().window()).map_err(err)
}

#[tauri::command]
async fn get_claude_usage(app: AppHandle) -> Result<ClaudeUsage, String> {
    let scanner = {
        let state = app.state::<AppState>();
        state.claude.clone()
    };
    let worker = scanner.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || worker.refresh())
        .await
        .map_err(err)?;
    let official = scanner.official_cached().await;
    Ok(ClaudeUsage { summary, official })
}

#[tauri::command]
fn list_net_interfaces() -> Vec<String> {
    network::list_interfaces()
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
fn reset_layout(app: AppHandle) -> Result<(), String> {
    reset_layout_inner(&app)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_app_info(app: AppHandle) -> AppInfo {
    let vibrancy = app.state::<AppState>().vibrancy.load(Ordering::SeqCst);
    AppInfo {
        version: app.package_info().version.to_string(),
        config_dir: settings::config_dir().to_string_lossy().into_owned(),
        claude_dir: claude_usage::claude_dir().to_string_lossy().into_owned(),
        vibrancy,
    }
}

#[tauri::command]
fn get_disks() -> Vec<disks::DiskInfo> {
    disks::list()
}

#[tauri::command]
fn power_action(action: String) -> Result<(), String> {
    power::run(&action)
}

#[tauri::command]
fn get_launcher_icon(id: String) -> Option<String> {
    launcher::icon_data_url(&id)
}

#[tauri::command]
fn launch_item(app: AppHandle, id: String) -> Result<(), String> {
    let item = {
        let state = app.state::<AppState>();
        let s = lock(&state.settings);
        s.launcher.iter().find(|i| i.id == id).cloned()
    }
    .ok_or_else(|| "Không tìm thấy mục mở nhanh".to_string())?;
    launcher::launch(&app, &item)
}

pub(crate) fn add_launcher(app: &AppHandle, paths: Vec<String>) -> Result<Vec<LaunchItem>, String> {
    let mut added = Vec::new();
    for p in paths {
        let path = std::path::PathBuf::from(&p);
        if !path.exists() {
            log_line(&format!("launcher: bỏ qua đường dẫn không tồn tại {p}"));
            continue;
        }
        let item = launcher::make_item(&path);
        log_line(&format!("launcher: thêm '{}' ({}) icon={}", item.name, item.path, item.has_icon));
        added.push(item);
    }
    if added.is_empty() {
        return Ok(added);
    }
    let snapshot = {
        let state = app.state::<AppState>();
        let mut s = lock(&state.settings);
        s.launcher.extend(added.iter().cloned());
        settings::save(&s).map_err(err)?;
        s.clone()
    };
    let _ = app.emit("settings-changed", &snapshot);
    Ok(added)
}

#[tauri::command]
async fn add_launcher_paths(app: AppHandle, paths: Vec<String>) -> Result<Vec<LaunchItem>, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || add_launcher(&handle, paths))
        .await
        .map_err(err)?
}

#[tauri::command]
async fn pick_launcher_apps(app: AppHandle) -> Result<Vec<LaunchItem>, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = handle
            .dialog()
            .file()
            .add_filter("Ứng dụng", &["exe", "lnk", "bat", "cmd", "url"])
            .add_filter("Mọi tệp", &["*"])
            .set_title("Chọn ứng dụng để mở nhanh");
        if let Some(w) = handle.get_webview_window("settings") {
            dialog = dialog.set_parent(&w);
        }
        let picked = dialog.blocking_pick_files().unwrap_or_default();
        let paths: Vec<String> = picked
            .into_iter()
            .filter_map(|f| f.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        add_launcher(&handle, paths)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn remove_launcher_item(app: AppHandle, id: String) -> Result<(), String> {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut s = lock(&state.settings);
        s.launcher.retain(|i| i.id != id);
        settings::save(&s).map_err(err)?;
        s.clone()
    };
    launcher::remove_icon(&id);
    let _ = app.emit("settings-changed", &snapshot);
    Ok(())
}

// ----------------------------------------------------------------- helpers

fn apply_pin_mode(app: &AppHandle, mode: &str) {
    for (_, w) in widget_windows(app) {
        match mode {
            "top" => {
                let _ = w.set_always_on_bottom(false);
                let _ = w.set_always_on_top(true);
            }
            "normal" => {
                let _ = w.set_always_on_bottom(false);
                let _ = w.set_always_on_top(false);
            }
            _ => {
                let _ = w.set_always_on_top(false);
                let _ = w.set_always_on_bottom(true);
            }
        }
    }
}

fn apply_visibility(app: &AppHandle, hidden: &[String]) {
    for (label, w) in widget_windows(app) {
        if hidden.iter().any(|h| h == label) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

fn apply_autostart(app: &AppHandle, enabled: bool) {
    let launcher = app.autolaunch();
    let _ = if enabled { launcher.enable() } else { launcher.disable() };
}

/// Chủ đề đang có hiệu lực: theo cài đặt, hoặc theo hệ thống khi là "auto".
fn effective_dark(app: &AppHandle, s: &Settings) -> bool {
    match s.theme.as_str() {
        "dark" => true,
        "light" => false,
        _ => app
            .get_webview_window("clock")
            .and_then(|w| w.theme().ok())
            .map(|t| t == Theme::Dark)
            .unwrap_or(true),
    }
}

/// Bo góc 8px chuẩn Windows 11 qua DWM, để vùng acrylic cũng bo theo.
#[cfg(windows)]
fn round_corners(w: &WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DWM_WINDOW_CORNER_PREFERENCE,
    };
    let Ok(handle) = w.window_handle() else { return };
    if let RawWindowHandle::Win32(h) = handle.as_raw() {
        let hwnd = HWND(h.hwnd.get() as *mut core::ffi::c_void);
        let pref: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const DWM_WINDOW_CORNER_PREFERENCE as *const core::ffi::c_void,
                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            );
        }
    }
}

#[cfg(not(windows))]
fn round_corners(_w: &WebviewWindow) {}

/// Nền kính mờ (acrylic) cho mọi widget; màu phủ theo chủ đề, độ đục theo cài đặt.
fn apply_vibrancy(app: &AppHandle, s: &Settings) -> bool {
    let dark = effective_dark(app, s);
    let alpha = (s.opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    let tint = if dark { (22, 23, 28, alpha) } else { (247, 247, 250, alpha) };
    let mut ok = true;
    for (label, w) in widget_windows(app) {
        round_corners(&w);
        if let Err(e) = window_vibrancy::apply_acrylic(&w, Some(tint)) {
            log_line(&format!("acrylic thất bại cho {label}: {e}"));
            ok = false;
        }
    }
    app.state::<AppState>().vibrancy.store(ok, Ordering::SeqCst);
    ok
}

fn sync_tray_checks(app: &AppHandle, s: &Settings) {
    let state = app.state::<AppState>();
    let items = lock(&state.tray_items);
    for (label, _) in WIDGETS {
        if let Some(item) = items.get(label) {
            let _ = item.set_checked(!s.hidden.iter().any(|h| h == label));
        }
    }
    if let Some(item) = items.get("autostart") {
        let _ = item.set_checked(s.autostart);
    }
}

fn set_visible(app: &AppHandle, label: &str, visible: bool) {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut s = lock(&state.settings);
        s.hidden.retain(|h| h != label);
        if !visible {
            s.hidden.push(label.to_string());
        }
        let _ = settings::save(&s);
        s.clone()
    };
    if let Some(w) = app.get_webview_window(label) {
        if visible {
            let _ = w.show();
            let _ = w.unminimize();
        } else {
            let _ = w.hide();
        }
    }
    if visible && label == "launcher" {
        // WebView2 có thể đăng ký lại drop target khi cửa sổ hiện; đăng ký đè sau một nhịp.
        dropzone::install_later(app, 800);
    }
    sync_tray_checks(app, &snapshot);
    let _ = app.emit("settings-changed", &snapshot);
}

fn show_all(app: &AppHandle) {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut s = lock(&state.settings);
        s.hidden.clear();
        let _ = settings::save(&s);
        s.clone()
    };
    for (_, w) in widget_windows(app) {
        let _ = w.show();
        let _ = w.unminimize();
    }
    dropzone::install_later(app, 800);
    sync_tray_checks(app, &snapshot);
    let _ = app.emit("settings-changed", &snapshot);
}

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Win+D thu nhỏ mọi cửa sổ; ở chế độ "desktop" widget tự hiện lại.
pub fn restore_minimized(app: &AppHandle) {
    let (hidden, mode) = {
        let state = app.state::<AppState>();
        let s = lock(&state.settings);
        (s.hidden.clone(), s.pin_mode.clone())
    };
    if mode != "desktop" {
        return;
    }
    for (label, w) in widget_windows(app) {
        if hidden.iter().any(|h| h == label) {
            continue;
        }
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
    }
}

fn reset_layout_inner(app: &AppHandle) -> Result<(), String> {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut s = lock(&state.settings);
        s.positions.clear();
        settings::save(&s).map_err(err)?;
        s.clone()
    };
    layout_windows(app, &snapshot);
    Ok(())
}

fn intersects(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> bool {
    a.0 < b.0 + b.2 && b.0 < a.0 + a.2 && a.1 < b.1 + b.3 && b.1 < a.1 + a.3
}

/// Đặt các cửa sổ đã có vị trí lưu đúng chỗ, rồi xếp những cửa sổ còn lại thành
/// cột sát mép phải màn hình chính, né vùng đã bị chiếm, và ghi lại vị trí đã xếp.
fn layout_windows(app: &AppHandle, s: &Settings) {
    let (ox, oy, ww, wh, scale) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let area = m.work_area();
            (
                area.position.x,
                area.position.y,
                area.size.width as i32,
                area.size.height as i32,
                m.scale_factor(),
            )
        })
        .unwrap_or((0, 0, 1920, 1040, 1.0));
    let margin = (16.0 * scale).round() as i32;
    let gap = (10.0 * scale).round() as i32;
    let order = [
        "clock", "weather", "calendar", "network", "claude", "power", "launcher", "disks",
    ];

    let mut occupied: Vec<(i32, i32, i32, i32)> = Vec::new();
    let mut pending: Vec<(&str, WebviewWindow, i32, i32)> = Vec::new();
    for label in order {
        let Some(w) = app.get_webview_window(label) else {
            continue;
        };
        let size = w.outer_size().unwrap_or(PhysicalSize::new(300, 150));
        let (sw, sh) = (size.width as i32, size.height as i32);
        if let Some((x, py)) = s.positions.get(label) {
            let _ = w.set_position(PhysicalPosition::new(*x, *py));
            occupied.push((*x, *py, sw, sh));
        } else {
            pending.push((label, w, sw, sh));
        }
    }
    if pending.is_empty() {
        return;
    }

    let mut right = ox + ww - margin;
    let mut y = oy + margin;
    let mut col_w = 0;
    let mut placed: Vec<(&str, i32, i32)> = Vec::new();
    for (label, w, sw, sh) in pending {
        let mut guard = 0;
        loop {
            guard += 1;
            if guard > 64 {
                break;
            }
            if y + sh > oy + wh - margin && y > oy + margin {
                right -= col_w + gap;
                y = oy + margin;
                col_w = 0;
                if right - sw < ox {
                    break;
                }
                continue;
            }
            let rect = (right - sw, y, sw, sh);
            if let Some(hit) = occupied.iter().find(|r| intersects(rect, **r)) {
                // Cột này đã bị chiếm: nhảy xuống dưới cửa sổ chạm và nhớ bề rộng cột.
                y = hit.1 + hit.3 + gap;
                col_w = col_w.max(hit.2);
                continue;
            }
            break;
        }
        let x = right - sw;
        let _ = w.set_position(PhysicalPosition::new(x, y));
        occupied.push((x, y, sw, sh));
        placed.push((label, x, y));
        y += sh + gap;
        col_w = col_w.max(sw);
    }

    let state = app.state::<AppState>();
    let mut current = lock(&state.settings);
    for (label, x, py) in placed {
        current.positions.insert(label.to_string(), (x, py));
    }
    let _ = settings::save(&current);
}

fn hook_window_events(app: &AppHandle) {
    for (label, w) in widget_windows(app) {
        let app2 = app.clone();
        w.on_window_event(move |event| match event {
            WindowEvent::Moved(pos) => {
                // Cửa sổ thu nhỏ báo vị trí -32000; bỏ qua.
                if pos.x <= -30000 || pos.y <= -30000 {
                    return;
                }
                let state = app2.state::<AppState>();
                let mut s = lock(&state.settings);
                s.positions.insert(label.to_string(), (pos.x, pos.y));
                state.positions_dirty.store(true, Ordering::SeqCst);
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let app3 = app2.clone();
                std::thread::spawn(move || set_visible(&app3, label, false));
            }
            WindowEvent::ThemeChanged(_) => {
                // Đổi màu phủ acrylic khi hệ thống đổi sáng/tối (chỉ khi theo hệ thống).
                let snapshot = {
                    let state = app2.state::<AppState>();
                    let copy = lock(&state.settings).clone();
                    copy
                };
                if snapshot.theme == "auto" && label == "clock" {
                    let app3 = app2.clone();
                    std::thread::spawn(move || {
                        apply_vibrancy(&app3, &snapshot);
                    });
                }
            }
            WindowEvent::DragDrop(drag) if label == "launcher" => match drag {
                DragDropEvent::Enter { paths, .. } => {
                    log_line(&format!("launcher: kéo vào {} mục", paths.len()));
                    let _ = app2.emit_to("launcher", "launcher-drag", true);
                }
                DragDropEvent::Leave => {
                    let _ = app2.emit_to("launcher", "launcher-drag", false);
                }
                DragDropEvent::Drop { paths, .. } => {
                    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    log_line(&format!("launcher: thả {} mục: {}", list.len(), list.join(" | ")));
                    let _ = app2.emit_to("launcher", "launcher-drag", false);
                    let app3 = app2.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = add_launcher(&app3, list) {
                            log_line(&format!("launcher: thêm thất bại: {e}"));
                        }
                    });
                }
                _ => {}
            },
            _ => {}
        });
    }
    if let Some(w) = app.get_webview_window("settings") {
        let w2 = w.clone();
        w.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = w2.hide();
            }
        });
    }
}

fn build_tray(app: &AppHandle, s: &Settings) -> tauri::Result<()> {
    let mut checks: Vec<CheckMenuItem<Wry>> = Vec::new();
    for (label, title) in WIDGETS {
        checks.push(CheckMenuItem::with_id(
            app,
            format!("toggle:{label}"),
            title,
            true,
            !s.hidden.iter().any(|h| h == label),
            None::<&str>,
        )?);
    }
    let show_all_item = MenuItem::with_id(app, "show_all", "Hiện tất cả widget", true, None::<&str>)?;
    let reset_item = MenuItem::with_id(app, "reset_layout", "Sắp xếp lại vị trí", true, None::<&str>)?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "Khởi động cùng Windows",
        true,
        s.autostart,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(app, "settings", "Cài đặt…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> =
        checks.iter().map(|c| c as &dyn IsMenuItem<Wry>).collect();
    items.push(&sep1);
    items.push(&show_all_item);
    items.push(&reset_item);
    items.push(&sep2);
    items.push(&autostart_item);
    items.push(&settings_item);
    items.push(&sep3);
    items.push(&quit_item);
    let menu = Menu::with_items(app, &items)?;

    {
        let state = app.state::<AppState>();
        let mut map = lock(&state.tray_items);
        for ((label, _), item) in WIDGETS.iter().zip(checks.iter()) {
            map.insert((*label).to_string(), item.clone());
        }
        map.insert("autostart".to_string(), autostart_item.clone());
    }

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("WinWidgets")
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_all(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Cập nhật một trường cài đặt theo nhãn widget rồi lưu và phát sự kiện.
fn update_settings(app: &AppHandle, f: impl FnOnce(&mut Settings)) {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut s = lock(&state.settings);
        f(&mut s);
        let _ = settings::save(&s);
        s.clone()
    };
    let _ = app.emit("settings-changed", &snapshot);
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "quit" => app.exit(0),
        "settings" => show_settings(app),
        "show_all" => show_all(app),
        "reset_layout" => {
            let _ = reset_layout_inner(app);
        }
        "autostart" => {
            let snapshot = {
                let state = app.state::<AppState>();
                let mut s = lock(&state.settings);
                s.autostart = !s.autostart;
                let _ = settings::save(&s);
                s.clone()
            };
            apply_autostart(app, snapshot.autostart);
            sync_tray_checks(app, &snapshot);
            let _ = app.emit("settings-changed", &snapshot);
        }
        other => {
            if let Some(label) = other.strip_prefix("toggle:") {
                let currently_hidden = {
                    let state = app.state::<AppState>();
                    let s = lock(&state.settings);
                    s.hidden.iter().any(|h| h == label)
                };
                set_visible(app, label, currently_hidden);
            } else if let Some(label) = other.strip_prefix("hide:") {
                set_visible(app, label, false);
            } else if let Some(label) = other.strip_prefix("refresh:") {
                let _ = app.emit_to(label, "refresh", ());
            } else if let Some(rest) = other.strip_prefix("scale:") {
                if let Some((label, pct)) = rest.split_once(':') {
                    if let Ok(pct) = pct.parse::<f64>() {
                        let label = label.to_string();
                        update_settings(app, |s| {
                            s.scale.insert(label, pct / 100.0);
                        });
                    }
                }
            } else if let Some(rest) = other.strip_prefix("interval:") {
                if let Some((label, ms)) = rest.split_once(':') {
                    if let Ok(ms) = ms.parse::<u64>() {
                        let label = label.to_string();
                        update_settings(app, |s| {
                            s.refresh.insert(label, ms);
                        });
                    }
                }
            }
        }
    }
}

pub fn run() {
    // Các cửa sổ tạo từ cấu hình có thể gọi lệnh trước khi setup() chạy,
    // nên trạng thái phải được manage() ngay trên Builder.
    let initial = settings::load();
    let scanner = Arc::new(claude_usage::Scanner::new(
        claude_usage::claude_dir(),
        settings::data_dir(),
    ));
    let setup_settings = initial.clone();
    let setup_scanner = scanner.clone();
    tauri::Builder::default()
        .manage(AppState {
            settings: Mutex::new(initial),
            positions_dirty: AtomicBool::new(false),
            tray_items: Mutex::new(HashMap::new()),
            claude: scanner,
            vibrancy: AtomicBool::new(false),
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_all(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            set_widget_visible,
            show_widget_menu,
            get_claude_usage,
            list_net_interfaces,
            open_settings,
            reset_layout,
            quit_app,
            get_app_info,
            get_disks,
            power_action,
            get_launcher_icon,
            launch_item,
            add_launcher_paths,
            pick_launcher_apps,
            remove_launcher_item
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let s = setup_settings;
            log_line(&format!("khởi động WinWidgets {}", app.package_info().version));
            // Quét lịch sử Claude Code ở nền để lần hỏi đầu tiên trả lời nhanh.
            std::thread::spawn(move || {
                let _ = setup_scanner.refresh();
            });
            hook_window_events(&handle);
            layout_windows(&handle, &s);
            build_tray(&handle, &s)?;
            apply_pin_mode(&handle, &s.pin_mode);
            let vibrancy = apply_vibrancy(&handle, &s);
            log_line(&format!("acrylic: {}", if vibrancy { "bật" } else { "không khả dụng" }));
            apply_visibility(&handle, &s.hidden);
            if s.autostart {
                apply_autostart(&handle, true);
            }
            network::start(handle.clone());
            // Đăng ký drop target cho Mở nhanh sau khi WebView2 đã dựng xong cửa sổ con
            // (lặp lại vài lần phòng khi WebView2 đăng ký đè muộn).
            for delay in [1500, 5000, 15000] {
                dropzone::install_later(&handle, delay);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("không khởi tạo được WinWidgets")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // Không có cửa sổ nào hiển thị vẫn giữ ứng dụng chạy trong khay.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
