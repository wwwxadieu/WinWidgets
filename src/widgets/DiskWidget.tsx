import { HardDrive, Usb } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useEvent, useRefreshInterval, useWindowSize } from "../hooks";
import { formatBytes } from "../lib/format";
import { invoke } from "../tauri";
import { BASE_SIZES, type DiskInfo } from "../types";

const MAX_ROWS = 6;
const ROW_HEIGHT = 44;

export function DiskWidget() {
  const [disks, setDisks] = useState<DiskInfo[] | null>(null);

  const load = useCallback(async () => {
    try {
      setDisks(await invoke<DiskInfo[]>("get_disks"));
    } catch {
      setDisks([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRefreshInterval("disks", () => void load());
  useEvent("refresh", () => void load());

  const shown = disks ? disks.slice(0, MAX_ROWS) : null;
  const [baseW, baseH] = BASE_SIZES.disks;
  // Kích thước gốc ứng với 3 ổ; mỗi ổ thêm/bớt một hàng.
  useWindowSize("disks", baseW, shown ? baseH + ROW_HEIGHT * (Math.max(1, shown.length) - 3) : null);

  return (
    <WidgetShell
      label="disks"
      className="disks"
      title={
        <>
          <HardDrive size={13} strokeWidth={2} />
          <span>Ổ đĩa</span>
        </>
      }
    >
      {!shown ? (
        <div className="w-empty">Đang đọc ổ đĩa…</div>
      ) : shown.length === 0 ? (
        <div className="w-empty">Không thấy ổ đĩa nào</div>
      ) : (
        <div className="disk-list">
          {shown.map((disk) => {
            const used = Math.max(0, disk.total - disk.free);
            const pct = disk.total ? (used / disk.total) * 100 : 0;
            const tone = pct >= 90 ? "red" : pct >= 75 ? "orange" : "";
            const letter = disk.mount.replace(/[\\/]+$/, "");
            const label = disk.name || (disk.removable ? "Ổ rời" : disk.kind || "Ổ đĩa");
            return (
              <div className="disk-row" key={disk.mount} title={[disk.fs, disk.kind].filter(Boolean).join(" · ")}>
                <div className="disk-ic">{disk.removable ? <Usb size={15} /> : <HardDrive size={15} />}</div>
                <div className="disk-body">
                  <div className="disk-head">
                    <span className="disk-name">
                      <b>{letter}</b> {label}
                    </span>
                    <span className="muted small">{formatBytes(disk.free)} trống</span>
                  </div>
                  <div className={`bar ${tone}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="muted tiny disk-foot">
                    {formatBytes(used)} / {formatBytes(disk.total)} · {Math.round(pct)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
