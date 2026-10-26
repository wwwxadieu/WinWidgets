// Dữ liệu giả lập để xem trước giao diện trong trình duyệt (không có Tauri).
import { DEFAULT_SETTINGS, type ClaudeUsage, type Settings } from "./types";

const KEY = "winwidgets.settings";
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

let netTimer: number | undefined;
let down = 2.4e6;
let up = 3.1e5;
let totalDown = 18.6e9;
let totalUp = 2.1e9;

function ensureNet() {
  if (netTimer) return;
  netTimer = window.setInterval(() => {
    down = Math.max(0, down + (Math.random() - 0.5) * 1.6e6);
    up = Math.max(0, up + (Math.random() - 0.5) * 2.2e5);
    totalDown += down;
    totalUp += up;
    emit("net-speed", { downBps: down, upBps: up, totalDown, totalUp, interface: "Wi-Fi", ts: Date.now() / 1000 });
  }, 1000);
}

export async function mockListen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!listeners.has(event)) listeners.set(event, new Set());
  const h = handler as Handler;
  listeners.get(event)!.add(h);
  if (event === "net-speed") ensureNet();
  return () => {
    listeners.get(event)?.delete(h);
  };
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function sampleUsage(): ClaudeUsage {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % 3600) - 2 * 3600;
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return {
    summary: {
      scannedFiles: 66,
      scannedAt: now,
      today: { input: 42_000, output: 310_000, cacheCreate: 1_900_000, cacheRead: 9_400_000, messages: 318, cost: 46.2 },
      block: {
        start,
        end: start + 5 * 3600,
        active: true,
        stats: { input: 12_000, output: 98_000, cacheCreate: 620_000, cacheRead: 3_100_000, messages: 96, cost: 13.8 },
      },
      week: [
        { date: day(6), tokens: 6.2e6, cost: 21, messages: 180 },
        { date: day(5), tokens: 9.8e6, cost: 33, messages: 260 },
        { date: day(4), tokens: 3.1e6, cost: 11, messages: 90 },
        { date: day(3), tokens: 0, cost: 0, messages: 0 },
        { date: day(2), tokens: 12.4e6, cost: 41, messages: 330 },
        { date: day(1), tokens: 8.7e6, cost: 29, messages: 240 },
        { date: day(0), tokens: 11.65e6, cost: 46.2, messages: 318 },
      ],
      modelsToday: [
        { model: "claude-fable-5-1", tokens: 8.4e6, cost: 38, messages: 210 },
        { model: "claude-opus-5-5", tokens: 2.3e6, cost: 6.5, messages: 70 },
        { model: "claude-sonnet-5-5", tokens: 0.95e6, cost: 1.7, messages: 38 },
      ],
      sessionsToday: 5,
      dataDir: "C:\\Users\\ban\\.claude",
    },
    official: {
      status: "ok",
      plan: "pro",
      fiveHour: { utilization: 37, resetsAt: new Date(Date.now() + 2.3 * 3600_000).toISOString() },
      sevenDay: { utilization: 61, resetsAt: new Date(Date.now() + 3.4 * 86_400_000).toISOString() },
      sevenDayOpus: null,
      sevenDaySonnet: null,
    },
  };
}

function storeSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  emit("settings-changed", s);
}

const SAMPLE_APPS = [
  { name: "Trình duyệt", path: "C:\\Program Files\\Browser\\browser.exe" },
  { name: "Soạn thảo", path: "C:\\Program Files\\Editor\\editor.exe" },
  { name: "Terminal", path: "C:\\Windows\\System32\\wt.exe" },
];

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case "get_settings":
      return loadSettings() as T;
    case "save_settings": {
      storeSettings(args?.settings as Settings);
      return undefined as T;
    }
    case "get_disks":
      return [
        { name: "Hệ thống", mount: "C:\\", total: 511e9, free: 96e9, kind: "SSD", removable: false, fs: "NTFS" },
        { name: "Dữ liệu", mount: "D:\\", total: 2000e9, free: 1340e9, kind: "HDD", removable: false, fs: "NTFS" },
        { name: "Dự án", mount: "H:\\", total: 1000e9, free: 72e9, kind: "SSD", removable: false, fs: "NTFS" },
      ] as T;
    case "power_action":
      console.log("power_action", args?.action);
      return undefined as T;
    case "launch_item":
      console.log("launch_item", args?.id);
      return undefined as T;
    case "get_launcher_icon":
      return null as T;
    case "pick_launcher_apps":
    case "add_launcher_paths": {
      const s = loadSettings();
      const base = s.launcher.length;
      const added = (cmd === "pick_launcher_apps" ? SAMPLE_APPS.slice(0, 2) : (args?.paths as string[]).map((p) => ({ name: p.split(/[\\/]/).pop() ?? p, path: p }))).map((a, i) => ({
        id: `mock-${base + i}-${Date.now()}`,
        name: a.name,
        path: a.path,
        args: "",
        hasIcon: false,
      }));
      storeSettings({ ...s, launcher: [...s.launcher, ...added] });
      return added as T;
    }
    case "remove_launcher_item": {
      const s = loadSettings();
      storeSettings({ ...s, launcher: s.launcher.filter((i) => i.id !== args?.id) });
      return undefined as T;
    }
    case "list_net_interfaces":
      return ["Wi-Fi", "Ethernet"] as T;
    case "get_app_info":
      return { version: "0.2.0 (xem trước trên trình duyệt)", configDir: "-", claudeDir: "-", vibrancy: false } as T;
    case "get_claude_usage":
      await new Promise((r) => setTimeout(r, 300));
      return sampleUsage() as T;
    default:
      return undefined as T;
  }
}
