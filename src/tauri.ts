// Lớp mỏng bọc Tauri API; khi chạy trong trình duyệt thường (xem trước giao diện)
// sẽ dùng dữ liệu giả lập từ mock.ts.
import { invoke as tauriInvoke, isTauri as checkTauri } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { mockInvoke, mockListen } from "./mock";

export const isTauri: boolean = checkTauri();

export function widgetLabel(): string {
  if (isTauri) return getCurrentWindow().label;
  const q = new URLSearchParams(location.search).get("w");
  return q || location.hash.replace("#", "") || "gallery";
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return tauriInvoke<T>(cmd, args);
  return mockInvoke<T>(cmd, args);
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (isTauri) return tauriListen<T>(event, (e) => handler(e.payload));
  return mockListen<T>(event, handler);
}

export async function startDrag(): Promise<void> {
  if (isTauri) await getCurrentWindow().startDragging();
}
