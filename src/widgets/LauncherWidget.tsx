import { AppWindow, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useEvent, useWindowSize } from "../hooks";
import { useSettings } from "../settings";
import { invoke } from "../tauri";
import { BASE_SIZES, type LaunchItem } from "../types";

/** Lưới 3 cột, tự cao thêm tới 3 hàng; nhiều hơn 9 ứng dụng thì cuộn. */
const COLS = 3;
const MAX_ROWS = 3;
const ROW_HEIGHT = 72;
const iconCache = new Map<string, string | null>();

/** Tải icon (PNG base64) cho các mục chưa có trong cache. */
export function useLauncherIcons(items: LaunchItem[]) {
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    const missing = items.filter((i) => i.hasIcon && !iconCache.has(i.id));
    if (!missing.length) return;
    Promise.all(
      missing.map(async (i) => {
        try {
          iconCache.set(i.id, (await invoke<string | null>("get_launcher_icon", { id: i.id })) ?? null);
        } catch {
          iconCache.set(i.id, null);
        }
      }),
    ).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [items]);
  return iconCache;
}

export function LauncherWidget() {
  const { settings } = useSettings();
  const items = settings.launcher;
  const icons = useLauncherIcons(items);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = Math.max(1, Math.min(MAX_ROWS, Math.ceil(items.length / COLS)));
  const [baseW, baseH] = BASE_SIZES.launcher;
  useWindowSize("launcher", baseW, baseH - ROW_HEIGHT + ROW_HEIGHT * rows);

  // Sự kiện kéo thả được xử lý ở phía Rust; frontend chỉ nhận tín hiệu để tô sáng.
  useEvent<boolean>("launcher-drag", (over) => setDragging(over));

  const open = (id: string) => void invoke("launch_item", { id });
  const add = () => {
    setBusy(true);
    void invoke("pick_launcher_apps").finally(() => setBusy(false));
  };

  return (
    <WidgetShell
      label="launcher"
      className={`launcher ${dragging ? "dragging" : ""}`}
      title={
        <>
          <AppWindow size={13} strokeWidth={2} />
          <span>Mở nhanh</span>
          {items.length > 0 && <span className="muted">· {items.length}</span>}
        </>
      }
      right={
        <button className="icon-btn" title="Thêm ứng dụng" onClick={add} disabled={busy}>
          <Plus size={14} strokeWidth={2.2} />
        </button>
      }
    >
      {items.length === 0 ? (
        <div className="w-empty small">Kéo thả tệp .exe, lối tắt hoặc thư mục vào đây, hoặc bấm + để thêm</div>
      ) : (
        <div className="launch-scroll" style={{ maxHeight: MAX_ROWS * 66 + (MAX_ROWS - 1) * 6 }}>
          <div className="launch-grid">
            {items.map((item) => {
              const src = icons.get(item.id);
              return (
                <button key={item.id} className="launch-tile" onClick={() => open(item.id)} title={item.path}>
                  <span className="launch-ic">
                    {src ? <img src={src} alt="" draggable={false} /> : <AppWindow size={22} strokeWidth={1.6} />}
                  </span>
                  <span className="launch-name">{item.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {dragging && <div className="drop-hint">Thả để thêm</div>}
    </WidgetShell>
  );
}
