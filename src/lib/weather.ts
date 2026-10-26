import type { LucideIcon } from "lucide-react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
} from "lucide-react";

export interface DailyForecast {
  date: string;
  code: number;
  max: number;
  min: number;
  pop: number;
}

export interface WeatherData {
  name: string;
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  precip: number;
  code: number;
  isDay: boolean;
  aqi: number | null;
  pm25: number | null;
  daily: DailyForecast[];
  updated: number;
}

export interface GeoResult {
  name: string;
  lat: number;
  lon: number;
  admin1?: string;
  country?: string;
}

const DESCRIPTIONS: Record<number, string> = {
  0: "Trời quang",
  1: "Ít mây",
  2: "Mây rải rác",
  3: "Nhiều mây",
  45: "Sương mù",
  48: "Sương muối",
  51: "Mưa phùn nhẹ",
  53: "Mưa phùn",
  55: "Mưa phùn dày",
  56: "Mưa phùn đóng băng",
  57: "Mưa phùn đóng băng",
  61: "Mưa nhỏ",
  63: "Mưa vừa",
  65: "Mưa to",
  66: "Mưa đóng băng",
  67: "Mưa đóng băng",
  71: "Tuyết nhẹ",
  73: "Tuyết vừa",
  75: "Tuyết dày",
  77: "Mưa tuyết",
  80: "Mưa rào nhẹ",
  81: "Mưa rào",
  82: "Mưa rào lớn",
  85: "Mưa tuyết rào",
  86: "Mưa tuyết rào",
  95: "Dông",
  96: "Dông kèm mưa đá",
  99: "Dông kèm mưa đá lớn",
};

export function describeWeather(code: number): string {
  return DESCRIPTIONS[code] ?? "Không rõ";
}

export function weatherIcon(code: number, isDay: boolean): LucideIcon {
  if (code === 0) return isDay ? Sun : Moon;
  if (code === 1 || code === 2) return isDay ? CloudSun : CloudMoon;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 82) return CloudRainWind;
  if (code === 85 || code === 86) return CloudSnow;
  if (code === 95) return CloudLightning;
  if (code === 96 || code === 99) return CloudHail;
  return Cloud;
}

export function aqiLevel(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: "Tốt", color: "var(--green)" };
  if (aqi <= 100) return { label: "Trung bình", color: "var(--yellow)" };
  if (aqi <= 150) return { label: "Kém", color: "var(--orange)" };
  if (aqi <= 200) return { label: "Xấu", color: "var(--red)" };
  if (aqi <= 300) return { label: "Rất xấu", color: "var(--purple)" };
  return { label: "Nguy hại", color: "#8B1E3F" };
}

interface ForecastResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    is_day: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: Array<number | null>;
  };
}

interface AirResponse {
  current?: { us_aqi?: number | null; pm2_5?: number | null };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchWeather(loc: { lat: number; lon: number; name: string }): Promise<WeatherData> {
  const q = `latitude=${loc.lat}&longitude=${loc.lon}`;
  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?${q}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=5&wind_speed_unit=kmh`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm2_5`;
  const [forecast, air] = await Promise.all([
    getJson<ForecastResponse>(forecastUrl),
    getJson<AirResponse>(airUrl).catch(() => null),
  ]);
  const c = forecast.current;
  const daily: DailyForecast[] = forecast.daily.time.map((date, i) => ({
    date,
    code: forecast.daily.weather_code[i],
    max: forecast.daily.temperature_2m_max[i],
    min: forecast.daily.temperature_2m_min[i],
    pop: forecast.daily.precipitation_probability_max[i] ?? 0,
  }));
  return {
    name: loc.name,
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    precip: c.precipitation,
    code: c.weather_code,
    isDay: c.is_day === 1,
    aqi: air?.current?.us_aqi ?? null,
    pm25: air?.current?.pm2_5 ?? null,
    daily,
    updated: Date.now(),
  };
}

interface GeoResponse {
  results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string }>;
}

export async function geocode(query: string): Promise<GeoResult[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=vi&format=json`;
  const data = await getJson<GeoResponse>(url);
  return (data.results ?? []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    admin1: r.admin1,
    country: r.country,
  }));
}

interface IpWhoResponse {
  success?: boolean;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

const VN_CITY_NAMES: Record<string, string> = {
  hanoi: "Hà Nội",
  "ha noi": "Hà Nội",
  "ho chi minh city": "TP. Hồ Chí Minh",
  "ho chi minh": "TP. Hồ Chí Minh",
  saigon: "TP. Hồ Chí Minh",
  "da nang": "Đà Nẵng",
  danang: "Đà Nẵng",
  "hai phong": "Hải Phòng",
  haiphong: "Hải Phòng",
  "can tho": "Cần Thơ",
  hue: "Huế",
  "nha trang": "Nha Trang",
  "vung tau": "Vũng Tàu",
  "bien hoa": "Biên Hòa",
  "da lat": "Đà Lạt",
  dalat: "Đà Lạt",
  "quy nhon": "Quy Nhơn",
  "buon ma thuot": "Buôn Ma Thuột",
  "thai nguyen": "Thái Nguyên",
  "nam dinh": "Nam Định",
  "bac ninh": "Bắc Ninh",
  "thanh hoa": "Thanh Hóa",
  vinh: "Vinh",
};

export async function locateByIp(): Promise<GeoResult | null> {
  try {
    const data = await getJson<IpWhoResponse>("https://ipwho.is/");
    if (!data.success || typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    const raw = data.city || data.region || "Vị trí hiện tại";
    const name = VN_CITY_NAMES[raw.trim().toLowerCase()] ?? raw;
    return { name, lat: data.latitude, lon: data.longitude };
  } catch {
    return null;
  }
}
