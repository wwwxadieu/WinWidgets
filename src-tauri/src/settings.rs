//! Cài đặt người dùng, lưu tại thư mục cấu hình của ứng dụng (settings.json).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherLocation {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct LaunchItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub args: String,
    pub has_icon: bool,
}

impl Default for LaunchItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            path: String::new(),
            args: String::new(),
            has_icon: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// "auto" | "dark" | "light"
    pub theme: String,
    /// "desktop" (luôn dưới cùng) | "top" (luôn nổi) | "normal"
    pub pin_mode: String,
    /// Độ đục của nền kính 0.4..=1.0
    pub opacity: f64,
    pub clock24h: bool,
    pub show_seconds: bool,
    /// "c" | "f"
    pub temp_unit: String,
    /// "bytes" | "bits"
    pub net_unit: String,
    /// Tên giao diện mạng, rỗng = tự động
    pub net_interface: String,
    /// None = tự xác định theo IP
    pub weather: Option<WeatherLocation>,
    /// Nhãn các widget đang ẩn
    pub hidden: Vec<String>,
    /// Vị trí cửa sổ (pixel vật lý) theo nhãn
    pub positions: HashMap<String, (i32, i32)>,
    pub autostart: bool,
    /// "digital" | "analog" | "minimal" | "gradient"
    pub clock_skin: String,
    /// Ứng dụng trong widget Mở nhanh
    pub launcher: Vec<LaunchItem>,
    /// Hệ số phóng to từng widget (1.0 = mặc định)
    pub scale: HashMap<String, f64>,
    /// Chu kỳ làm mới từng widget, mili giây
    pub refresh: HashMap<String, u64>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            pin_mode: "desktop".into(),
            opacity: 0.82,
            clock24h: true,
            show_seconds: true,
            temp_unit: "c".into(),
            net_unit: "bytes".into(),
            net_interface: String::new(),
            weather: None,
            hidden: Vec::new(),
            positions: HashMap::new(),
            autostart: false,
            clock_skin: "digital".into(),
            launcher: Vec::new(),
            scale: HashMap::new(),
            refresh: HashMap::new(),
        }
    }
}

const IDENTIFIER: &str = "com.wwwxadieu.winwidgets";

/// %APPDATA%com.wwwxadieu.winwidgets, tính trực tiếp để dùng được trước khi Tauri khởi tạo xong.
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    base.join(IDENTIFIER)
}

pub fn data_dir() -> PathBuf {
    config_dir()
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match fs::read_to_string(settings_path()) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &path)
}
