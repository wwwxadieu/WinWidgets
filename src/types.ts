export type Theme = "auto" | "dark" | "light";
export type PinMode = "desktop" | "top" | "normal";
export type ClockSkin = "digital" | "analog" | "minimal" | "gradient";

export interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
}

export interface LaunchItem {
  id: string;
  name: string;
  path: string;
  args: string;
  hasIcon: boolean;
}

export interface Settings {
  theme: Theme;
  pinMode: PinMode;
  opacity: number;
  clock24h: boolean;
  showSeconds: boolean;
  tempUnit: "c" | "f";
  netUnit: "bytes" | "bits";
  netInterface: string;
  weather: WeatherLocation | null;
  hidden: string[];
  positions: Record<string, [number, number]>;
  autostart: boolean;
  clockSkin: ClockSkin;
  launcher: LaunchItem[];
  /** Hệ số phóng to từng widget (1 = mặc định) */
  scale: Record<string, number>;
  /** Chu kỳ làm mới từng widget, mili giây */
  refresh: Record<string, number>;
}

/** Kích thước cửa sổ gốc (logic px) của từng widget, trước khi nhân hệ số phóng to. */
export const BASE_SIZES: Record<string, [number, number]> = {
  clock: [276, 126],
  network: [276, 176],
  weather: [296, 256],
  calendar: [316, 416],
  claude: [296, 306],
  disks: [276, 180],
  power: [276, 106],
  launcher: [276, 120],
};

export const DEFAULT_REFRESH: Record<string, number> = {
  network: 1000,
  weather: 900_000,
  claude: 60_000,
  disks: 30_000,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  pinMode: "desktop",
  opacity: 0.82,
  clock24h: true,
  showSeconds: true,
  tempUnit: "c",
  netUnit: "bytes",
  netInterface: "",
  weather: null,
  hidden: [],
  positions: {},
  autostart: false,
  clockSkin: "digital",
  launcher: [],
  scale: {},
  refresh: {},
};

export const CLOCK_SKINS: ReadonlyArray<{ value: ClockSkin; label: string; hint: string }> = [
  { value: "digital", label: "Số", hint: "Giờ lớn, ngày dương và âm" },
  { value: "analog", label: "Kim", hint: "Mặt đồng hồ kim kèm ngày" },
  { value: "minimal", label: "Tối giản", hint: "Chỉ giờ và ngày, căn giữa" },
  { value: "gradient", label: "Chuyển sắc", hint: "Giờ tô màu chuyển sắc" },
];

export const WIDGETS: ReadonlyArray<{ label: string; title: string; description: string }> = [
  { label: "clock", title: "Đồng hồ", description: "Giờ hiện tại, ngày dương và ngày âm, 4 kiểu hiển thị" },
  { label: "network", title: "Tốc độ mạng", description: "Tải xuống, tải lên theo thời gian thực" },
  { label: "weather", title: "Thời tiết", description: "Thời tiết hiện tại, chất lượng không khí, 4 ngày tới" },
  { label: "calendar", title: "Lịch", description: "Lịch tháng kèm âm lịch, can chi, ngày lễ Việt Nam" },
  { label: "claude", title: "Claude", description: "Mức sử dụng Claude Code của bạn" },
  { label: "disks", title: "Ổ đĩa", description: "Dung lượng đã dùng và còn trống của từng ổ" },
  { label: "power", title: "Nguồn", description: "Tắt máy, khởi động lại, ngủ (nhấn hai lần để xác nhận)" },
  { label: "launcher", title: "Mở nhanh", description: "Mở ứng dụng đã thêm bằng một cú nhấp" },
];

export interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  free: number;
  kind: string;
  removable: boolean;
  fs: string;
}

export interface NetSample {
  downBps: number;
  upBps: number;
  totalDown: number;
  totalUp: number;
  interface: string;
  ts: number;
}

export interface Bucket {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  messages: number;
  cost: number;
}

export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface Official {
  status: "ok" | "no_credentials" | "no_token" | "expired" | "error";
  plan: string | null;
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  sevenDayOpus: UsageWindow | null;
  sevenDaySonnet: UsageWindow | null;
}

export interface UsageSummary {
  scannedFiles: number;
  scannedAt: number;
  today: Bucket;
  block: { start: number; end: number; active: boolean; stats: Bucket } | null;
  week: Array<{ date: string; tokens: number; cost: number; messages: number }>;
  modelsToday: Array<{ model: string; tokens: number; cost: number; messages: number }>;
  sessionsToday: number;
  dataDir: string;
}

export interface ClaudeUsage {
  summary: UsageSummary;
  official: Official;
}

export interface AppInfo {
  version: string;
  configDir: string;
  claudeDir: string;
  /** Nền acrylic của Windows đang bật (frost glass thật) */
  vibrancy: boolean;
}

export function bucketTokens(b: Bucket): number {
  return b.input + b.output + b.cacheCreate + b.cacheRead;
}
