export const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
export const WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function num(n: number, digits = 0): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatSpeed(bps: number, unit: "bytes" | "bits"): { value: string; unit: string } {
  const bits = unit === "bits";
  const units = bits ? ["b/s", "Kb/s", "Mb/s", "Gb/s"] : ["B/s", "KB/s", "MB/s", "GB/s"];
  const base = bits ? 1000 : 1024;
  let x = bits ? bps * 8 : bps;
  let i = 0;
  while (x >= base && i < units.length - 1) {
    x /= base;
    i++;
  }
  const digits = i === 0 ? 0 : x < 10 ? 2 : x < 100 ? 1 : 0;
  return { value: num(x, digits), unit: units[i] };
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = n;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${num(x, i === 0 ? 0 : x < 10 ? 2 : 1)} ${units[i]}`;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${num(n / 1e9, 2)}B`;
  if (n >= 1e6) return `${num(n / 1e6, n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${num(n / 1e3, n >= 1e4 ? 0 : 1)}K`;
  return num(n);
}

export function formatUsd(x: number): string {
  if (x >= 100) return `$${x.toFixed(0)}`;
  if (x >= 10) return `$${x.toFixed(1)}`;
  return `$${x.toFixed(2)}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} ngày ${h} giờ` : `${d} ngày`;
  if (h > 0) return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
  if (m > 0) return `${m} phút`;
  return "dưới 1 phút";
}

/** Giờ:phút từ mili giây hoặc Date. */
export function timeHM(input: number | Date): string {
  const d = typeof input === "number" ? new Date(input) : input;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
