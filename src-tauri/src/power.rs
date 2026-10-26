//! Tắt máy, khởi động lại, ngủ.

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn run(action: &str) -> Result<(), String> {
    match action {
        "shutdown" => spawn_shutdown(&["/s", "/t", "0"]),
        "restart" => spawn_shutdown(&["/r", "/t", "0"]),
        "sleep" => sleep(),
        _ => Err("Hành động không hợp lệ".to_string()),
    }
}

fn spawn_shutdown(args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new("shutdown");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn sleep() -> Result<(), String> {
    // SetSuspendState chặn luồng gọi cho tới khi máy thức dậy, nên chạy trên luồng riêng.
    std::thread::spawn(|| unsafe {
        let _ = windows::Win32::System::Power::SetSuspendState(false, false, false);
    });
    Ok(())
}

#[cfg(not(windows))]
fn sleep() -> Result<(), String> {
    Err("Chỉ hỗ trợ Windows".to_string())
}
