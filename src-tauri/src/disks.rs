//! Dung lượng các ổ đĩa (sysinfo).

use serde::Serialize;
use sysinfo::{DiskKind, Disks};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub free: u64,
    pub kind: String,
    pub removable: bool,
    pub fs: String,
}

pub fn list() -> Vec<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<DiskInfo> = disks
        .list()
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            free: d.available_space(),
            kind: match d.kind() {
                DiskKind::SSD => "SSD".to_string(),
                DiskKind::HDD => "HDD".to_string(),
                _ => String::new(),
            },
            removable: d.is_removable(),
            fs: d.file_system().to_string_lossy().into_owned(),
        })
        .collect();
    out.sort_by(|a, b| a.mount.cmp(&b.mount));
    out.dedup_by(|a, b| a.mount == b.mount);
    out
}
