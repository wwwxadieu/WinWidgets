import { Cloud, Droplets, MapPin, RefreshCw, Umbrella, Wind } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useEvent, useRefreshInterval, useWindowSize } from "../hooks";
import { WEEKDAYS_SHORT, parseYmd, timeHM } from "../lib/format";
import { aqiLevel, describeWeather, fetchWeather, locateByIp, weatherIcon, type WeatherData } from "../lib/weather";
import { useSettings } from "../settings";
import { BASE_SIZES, type WeatherLocation } from "../types";

const CACHE_KEY = "winwidgets.weather";
const AUTO_KEY = "winwidgets.autoloc";
const HANOI: WeatherLocation = { name: "Hà Nội", lat: 21.0285, lon: 105.8542 };

function readCache(): WeatherData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as WeatherData) : null;
  } catch {
    return null;
  }
}

async function resolveLocation(setting: WeatherLocation | null): Promise<WeatherLocation> {
  if (setting) return setting;
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as WeatherLocation & { at: number };
      if (Date.now() - cached.at < 6 * 3600_000) return cached;
    }
  } catch {
    /* bỏ qua cache hỏng */
  }
  const ip = await locateByIp();
  const loc = ip ? { name: ip.name, lat: ip.lat, lon: ip.lon } : HANOI;
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify({ ...loc, at: Date.now() }));
  } catch {
    /* không lưu được cũng không sao */
  }
  return loc;
}

export function WeatherWidget() {
  const { settings, loaded } = useSettings();
  const [data, setData] = useState<WeatherData | null>(readCache);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const locKey = settings.weather ? `${settings.weather.lat},${settings.weather.lon},${settings.weather.name}` : "auto";
  const setting = settings.weather;

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const loc = await resolveLocation(setting);
      const next = await fetchWeather(loc);
      setData(next);
      setStatus("idle");
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        /* bỏ qua */
      }
    } catch {
      setStatus("error");
    }
    // locKey đại diện cho setting để tránh tạo lại hàm mỗi lần render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey]);

  useWindowSize("weather", BASE_SIZES.weather[0], BASE_SIZES.weather[1]);
  useEffect(() => {
    if (loaded) void load();
  }, [loaded, load]);
  useRefreshInterval("weather", () => void load());
  useEvent("refresh", () => void load());

  const unitC = settings.tempUnit === "c";
  const t = (c: number) => Math.round(unitC ? c : (c * 9) / 5 + 32);
  const Icon = data ? weatherIcon(data.code, data.isDay) : Cloud;
  const aqi = data?.aqi != null ? aqiLevel(data.aqi) : null;

  return (
    <WidgetShell
      label="weather"
      className="weather"
      title={
        <>
          <MapPin size={13} strokeWidth={2} />
          <span>{data?.name ?? "Thời tiết"}</span>
        </>
      }
      right={
        <button className="icon-btn" title="Làm mới" onClick={() => void load()}>
          <RefreshCw size={13} strokeWidth={2} className={status === "loading" ? "spin" : ""} />
        </button>
      }
    >
      {data ? (
        <>
          <div className="wx-main">
            <Icon className="wx-icon" size={46} strokeWidth={1.4} />
            <div className="wx-temp">
              {t(data.temp)}
              <span className="wx-deg">°{unitC ? "C" : "F"}</span>
            </div>
            <div className="wx-desc">
              <div>{describeWeather(data.code)}</div>
              <div className="muted">Cảm giác như {t(data.feels)}°</div>
            </div>
          </div>
          <div className="wx-stats">
            <span>
              <Droplets size={12} /> {Math.round(data.humidity)}%
            </span>
            <span>
              <Wind size={12} /> {Math.round(data.wind)} km/h
            </span>
            <span>
              <Umbrella size={12} /> {data.precip.toFixed(1)} mm
            </span>
            {aqi && data.aqi != null && (
              <span className="aqi" style={{ color: aqi.color }}>
                AQI {Math.round(data.aqi)} · {aqi.label}
              </span>
            )}
          </div>
          <div className="wx-days">
            {data.daily.slice(1, 5).map((day) => {
              const DayIcon = weatherIcon(day.code, true);
              const date = parseYmd(day.date);
              return (
                <div className="wx-day" key={day.date} title={`${describeWeather(day.code)} · mưa ${day.pop}%`}>
                  <div className="muted small">{WEEKDAYS_SHORT[date.getDay()]}</div>
                  <DayIcon size={18} strokeWidth={1.6} />
                  <div className="wx-range">
                    <b>{t(day.max)}°</b> <span className="muted">{t(day.min)}°</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="w-foot">
            {status === "error" ? "Không tải được dữ liệu mới" : `Cập nhật ${timeHM(data.updated)}`}
          </div>
        </>
      ) : (
        <div className="w-empty">{status === "error" ? "Không tải được dữ liệu thời tiết" : "Đang tải thời tiết…"}</div>
      )}
    </WidgetShell>
  );
}
