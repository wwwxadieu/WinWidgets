import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { useSettings } from "./settings";
import { isTauri, listen } from "./tauri";
import { DEFAULT_REFRESH } from "./types";

/** Lắng nghe một sự kiện Tauri, tự huỷ khi component unmount. */
export function useEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<T>(event, (p) => ref.current(p)).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [event]);
}

export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!ms || ms <= 0) return;
    const id = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Chu kỳ làm mới của widget theo cài đặt (menu chuột phải), có mặc định riêng. */
export function useRefreshInterval(label: string, fn: () => void) {
  const { settings } = useSettings();
  const ms = settings.refresh[label] ?? DEFAULT_REFRESH[label] ?? 0;
  useInterval(fn, ms);
}

/** Hệ số phóng to của widget (menu chuột phải > Kích thước). */
export function useWidgetScale(label: string): number {
  const { settings } = useSettings();
  const s = settings.scale[label];
  return typeof s === "number" && s > 0.3 && s < 4 ? s : 1;
}

/**
 * Đặt kích thước cửa sổ widget = kích thước gốc x hệ số phóng to, đồng thời phóng
 * toàn bộ trang bằng CSS zoom để nội dung lấp đầy cửa sổ (chỉ khi chạy trong Tauri).
 */
export function useWindowSize(label: string, width: number, height: number | null) {
  const scale = useWidgetScale(label);
  useEffect(() => {
    document.documentElement.style.zoom = String(scale);
  }, [scale]);
  useEffect(() => {
    if (!isTauri || height == null) return;
    getCurrentWindow()
      .setSize(new LogicalSize(Math.round(width * scale), Math.round(height * scale)))
      .catch(() => {});
  }, [width, height, scale]);
}
