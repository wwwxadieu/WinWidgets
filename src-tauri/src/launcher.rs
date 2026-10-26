//! Mở nhanh ứng dụng: lưu danh sách, trích icon từ exe/lnk (Shell), khởi chạy.

use crate::settings::{self, LaunchItem};
use base64::Engine;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const ICON_SIZE: i32 = 96;

pub fn icon_dir() -> PathBuf {
    settings::data_dir().join("icons")
}

pub fn icon_path(id: &str) -> PathBuf {
    icon_dir().join(format!("{id}.png"))
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

/// "google-chrome" -> "Google chrome", "VISUAL_STUDIO" -> "Visual studio"
fn prettify(stem: &str) -> String {
    let cleaned = stem.replace(['_', '-'], " ");
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return stem.to_string();
    }
    let all_upper = trimmed.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase());
    let mut chars = trimmed.chars();
    let first = chars.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
    let rest: String = chars.collect();
    if all_upper && trimmed.len() > 4 {
        format!("{first}{}", rest.to_lowercase())
    } else {
        format!("{first}{rest}")
    }
}

pub fn make_item(path: &Path) -> LaunchItem {
    let id = new_id();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let has_icon = extract_icon(path, &icon_path(&id)).is_ok();
    LaunchItem {
        id,
        name: prettify(&stem),
        path: path.to_string_lossy().into_owned(),
        args: String::new(),
        has_icon,
    }
}

pub fn icon_data_url(id: &str) -> Option<String> {
    let bytes = std::fs::read(icon_path(id)).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn remove_icon(id: &str) {
    let _ = std::fs::remove_file(icon_path(id));
}

pub fn launch(app: &AppHandle, item: &LaunchItem) -> Result<(), String> {
    if item.args.trim().is_empty() {
        return app
            .opener()
            .open_path(&item.path, None::<&str>)
            .map_err(|e| e.to_string());
    }
    let args: Vec<String> = item.args.split_whitespace().map(|s| s.to_string()).collect();
    let mut cmd = std::process::Command::new(&item.path);
    cmd.args(args);
    if let Some(dir) = Path::new(&item.path).parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Lấy icon qua IShellItemImageFactory (hỗ trợ exe, lnk, mọi loại file) và lưu PNG.
#[cfg(windows)]
pub fn extract_icon(path: &Path, out: &Path) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
        SIIGBF_ICONONLY,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)
                .map_err(|e| e.to_string())?;
        let hbmp: HBITMAP = factory
            .GetImage(
                SIZE { cx: ICON_SIZE, cy: ICON_SIZE },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
            .map_err(|e| e.to_string())?;
        let gdi = HGDIOBJ(hbmp.0);

        let mut bm = BITMAP::default();
        GetObjectW(
            gdi,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut core::ffi::c_void),
        );
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        if w <= 0 || h <= 0 {
            let _ = DeleteObject(gdi);
            return Err("Bitmap rỗng".to_string());
        }

        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            ..Default::default()
        };
        let mut pixels = vec![0u8; (w as usize) * (h as usize) * 4];
        let hdc = GetDC(None);
        let lines = GetDIBits(
            hdc,
            hbmp,
            0,
            h as u32,
            Some(pixels.as_mut_ptr() as *mut core::ffi::c_void),
            &mut info,
            DIB_RGB_COLORS,
        );
        let _ = ReleaseDC(None, hdc);
        let _ = DeleteObject(gdi);
        if lines == 0 {
            return Err("GetDIBits thất bại".to_string());
        }

        // BGRA (alpha nhân sẵn) -> RGBA thẳng.
        let opaque = pixels.chunks_exact(4).all(|p| p[3] == 0);
        for px in pixels.chunks_exact_mut(4) {
            let (b, g, r, a) = (px[0] as u32, px[1] as u32, px[2] as u32, px[3] as u32);
            let a = if opaque { 255 } else { a };
            let (r, g, b) = if a > 0 && a < 255 {
                ((r * 255 / a).min(255), (g * 255 / a).min(255), (b * 255 / a).min(255))
            } else {
                (r, g, b)
            };
            px[0] = r as u8;
            px[1] = g as u8;
            px[2] = b as u8;
            px[3] = a as u8;
        }

        let img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)
            .ok_or_else(|| "Không tạo được ảnh".to_string())?;
        if let Some(parent) = out.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        img.save_with_format(out, image::ImageFormat::Png)
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
pub fn extract_icon(_path: &Path, _out: &Path) -> Result<(), String> {
    Err("Chỉ hỗ trợ Windows".to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn extracts_notepad_icon_as_png() {
        let out = std::env::temp_dir().join("winwidgets-test-icon.png");
        let _ = std::fs::remove_file(&out);
        extract_icon(Path::new(r"C:\Windows\System32\notepad.exe"), &out).expect("trích icon");
        let meta = std::fs::metadata(&out).expect("đã ghi PNG");
        assert!(meta.len() > 500, "PNG quá nhỏ: {} byte", meta.len());
        let img = image::open(&out).expect("PNG hợp lệ");
        assert!(img.width() >= 32 && img.height() >= 32, "kích thước {}x{}", img.width(), img.height());
    }

    #[test]
    fn prettify_names() {
        assert_eq!(prettify("google-chrome"), "Google chrome");
        assert_eq!(prettify("NOTEPAD"), "Notepad");
        assert_eq!(prettify("Code"), "Code");
    }
}
