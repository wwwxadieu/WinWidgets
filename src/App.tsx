import { useEffect, useMemo } from "react";
import { useSettings } from "./settings";
import { invoke, widgetLabel } from "./tauri";
import { BASE_SIZES, type AppInfo } from "./types";
import { CalendarWidget } from "./widgets/CalendarWidget";
import { ClaudeWidget } from "./widgets/ClaudeWidget";
import { ClockWidget } from "./widgets/ClockWidget";
import { DiskWidget } from "./widgets/DiskWidget";
import { LauncherWidget } from "./widgets/LauncherWidget";
import { NetworkWidget } from "./widgets/NetworkWidget";
import { PowerWidget } from "./widgets/PowerWidget";
import { SettingsWindow } from "./widgets/SettingsWindow";
import { WeatherWidget } from "./widgets/WeatherWidget";

/** Kích thước cửa sổ từng widget (logic px), dùng cho trang xem trước. */
const SIZES = BASE_SIZES;

function renderWidget(label: string) {
  switch (label) {
    case "clock":
      return <ClockWidget />;
    case "network":
      return <NetworkWidget />;
    case "weather":
      return <WeatherWidget />;
    case "calendar":
      return <CalendarWidget />;
    case "claude":
      return <ClaudeWidget />;
    case "disks":
      return <DiskWidget />;
    case "power":
      return <PowerWidget />;
    case "launcher":
      return <LauncherWidget />;
    default:
      return null;
  }
}

function Gallery() {
  return (
    <div className="gallery">
      {Object.entries(SIZES).map(([label, [w, h]]) => (
        <div key={label} className="gallery-item" style={{ width: w, height: h }}>
          {renderWidget(label)}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const label = useMemo(() => widgetLabel(), []);
  const { settings } = useSettings();

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = settings.theme === "auto" ? (mq.matches ? "dark" : "light") : settings.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.setProperty("--glass-alpha", String(settings.opacity));
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme, settings.opacity]);

  useEffect(() => {
    // Khi Windows vẽ acrylic phía sau, CSS chỉ phủ nhẹ (xem html[data-vibrancy]).
    invoke<AppInfo>("get_app_info")
      .then((info) => {
        document.documentElement.dataset.vibrancy = info?.vibrancy ? "true" : "false";
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.body.dataset.widget = label;
    const onContextMenu = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [label]);

  if (label === "settings") return <SettingsWindow />;
  if (label === "gallery") return <Gallery />;
  return renderWidget(label) ?? <ClockWidget />;
}
