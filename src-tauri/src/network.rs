//! Đo tốc độ mạng mỗi giây bằng sysinfo và phát sự kiện `net-speed`.

use serde::Serialize;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use sysinfo::Networks;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetSample {
    pub down_bps: f64,
    pub up_bps: f64,
    pub total_down: u64,
    pub total_up: u64,
    pub interface: String,
    pub ts: i64,
}

const VIRTUAL_HINTS: [&str; 9] = [
    "loopback",
    "vethernet",
    "vmware",
    "virtualbox",
    "hyper-v",
    "wsl",
    "tap-",
    "npcap",
    "teredo",
];

fn is_virtual(name: &str) -> bool {
    let lower = name.to_lowercase();
    VIRTUAL_HINTS.iter().any(|h| lower.contains(h))
}

fn selected(name: &str, filter: &str) -> bool {
    if filter.is_empty() {
        !is_virtual(name)
    } else {
        name == filter
    }
}

pub fn list_interfaces() -> Vec<String> {
    let networks = Networks::new_with_refreshed_list();
    let mut names: Vec<String> = networks.iter().map(|(name, _)| name.clone()).collect();
    names.sort();
    names
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut networks = Networks::new_with_refreshed_list();
        let mut last = Instant::now();
        let mut housekeeping = Instant::now();
        loop {
            let interval = app
                .state::<AppState>()
                .settings
                .lock()
                .map(|s| s.refresh.get("network").copied().unwrap_or(1000))
                .unwrap_or(1000)
                .clamp(250, 10_000);
            std::thread::sleep(Duration::from_millis(interval));
            networks.refresh(true);
            let elapsed = last.elapsed().as_secs_f64().max(0.001);
            last = Instant::now();

            let state = app.state::<AppState>();
            let filter = state
                .settings
                .lock()
                .map(|s| s.net_interface.clone())
                .unwrap_or_default();

            let (mut rx, mut tx, mut total_rx, mut total_tx) = (0u64, 0u64, 0u64, 0u64);
            let mut primary: Option<(String, u64)> = None;
            for (name, data) in networks.iter() {
                if !selected(name, &filter) {
                    continue;
                }
                rx += data.received();
                tx += data.transmitted();
                total_rx += data.total_received();
                total_tx += data.total_transmitted();
                let score = data.total_received() + data.total_transmitted();
                if primary.as_ref().map(|(_, s)| score > *s).unwrap_or(true) {
                    primary = Some((name.clone(), score));
                }
            }
            let interface = if filter.is_empty() {
                primary.map(|(n, _)| n).unwrap_or_default()
            } else {
                filter.clone()
            };

            let sample = NetSample {
                down_bps: rx as f64 / elapsed,
                up_bps: tx as f64 / elapsed,
                total_down: total_rx,
                total_up: total_tx,
                interface,
                ts: chrono::Utc::now().timestamp(),
            };
            let _ = app.emit("net-speed", &sample);

            // Việc nhà mỗi 2 giây: lưu vị trí cửa sổ và khôi phục widget bị thu nhỏ.
            if housekeeping.elapsed() >= Duration::from_secs(2) {
                housekeeping = Instant::now();
                if state.positions_dirty.swap(false, Ordering::SeqCst) {
                    if let Ok(s) = state.settings.lock() {
                        let _ = crate::settings::save(&s);
                    }
                }
                crate::restore_minimized(&app);
            }
        }
    });
}
