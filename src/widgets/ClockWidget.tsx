import { useEffect, useMemo, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useWindowSize } from "../hooks";
import { WEEKDAYS, WEEKDAYS_SHORT, pad2 } from "../lib/format";
import { canChiYear, solarToLunar } from "../lib/lunar";
import { useSettings } from "../settings";
import { BASE_SIZES, CLOCK_SKINS } from "../types";

function AnalogClock({ time, size }: { time: Date; size: number }) {
  const c = size / 2;
  const r = c - 3;
  const sec = time.getSeconds();
  const min = time.getMinutes() + sec / 60;
  const hour = (time.getHours() % 12) + min / 60;
  const tip = (deg: number, len: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x2: c + Math.cos(a) * len, y2: c + Math.sin(a) * len };
  };
  const h = tip(hour * 30, r * 0.5);
  const m = tip(min * 6, r * 0.72);
  const s = tip(sec * 6, r * 0.82);
  return (
    <svg className="analog" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} className="analog-face" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = ((i * 30 - 90) * Math.PI) / 180;
        const major = i % 3 === 0;
        const inner = r - (major ? 9 : 5);
        return (
          <line
            key={i}
            x1={c + Math.cos(a) * inner}
            y1={c + Math.sin(a) * inner}
            x2={c + Math.cos(a) * (r - 2)}
            y2={c + Math.sin(a) * (r - 2)}
            className={`analog-tick ${major ? "major" : ""}`}
          />
        );
      })}
      <line x1={c} y1={c} x2={h.x2} y2={h.y2} className="analog-hour" />
      <line x1={c} y1={c} x2={m.x2} y2={m.y2} className="analog-minute" />
      <line x1={c} y1={c} x2={s.x2} y2={s.y2} className="analog-second" />
      <circle cx={c} cy={c} r={3} className="analog-cap" />
    </svg>
  );
}

export function ClockWidget() {
  const { settings, save } = useSettings();
  const [now, setNow] = useState(() => new Date());
  useWindowSize("clock", BASE_SIZES.clock[0], BASE_SIZES.clock[1]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const lunar = useMemo(() => solarToLunar(d, m, y), [d, m, y]);

  let hours = now.getHours();
  const suffix = hours >= 12 ? "CH" : "SA";
  if (!settings.clock24h) hours = hours % 12 || 12;

  const skin = settings.clockSkin;
  const cycleSkin = () => {
    const idx = CLOCK_SKINS.findIndex((s) => s.value === skin);
    const next = CLOCK_SKINS[(idx + 1) % CLOCK_SKINS.length].value;
    void save({ clockSkin: next });
  };

  const time = (cls = "") => (
    <div className={`clock-time ${cls}`}>
      <span>{pad2(hours)}</span>
      <span className="clock-colon">:</span>
      <span>{pad2(now.getMinutes())}</span>
      {settings.showSeconds && <span className="clock-sec">{pad2(now.getSeconds())}</span>}
      {!settings.clock24h && <span className="clock-ampm">{suffix}</span>}
    </div>
  );
  const dateLine = (
    <div className="clock-date">
      {WEEKDAYS[now.getDay()]}, {d} tháng {m}, {y}
    </div>
  );
  const lunarLine = (
    <div className="clock-lunar">
      Âm lịch {lunar.day}/{lunar.month}
      {lunar.leap ? " nhuận" : ""} · Năm {canChiYear(lunar.year)}
    </div>
  );

  let body;
  switch (skin) {
    case "analog":
      body = (
        <div className="clock-row">
          <AnalogClock time={now} size={92} />
          <div className="clock-text">
            {time("sm")}
            <div className="clock-date">
              {WEEKDAYS_SHORT[now.getDay()]}, {pad2(d)}/{pad2(m)}/{y}
            </div>
            <div className="clock-lunar">
              ÂL {lunar.day}/{lunar.month}
              {lunar.leap ? "n" : ""} · {canChiYear(lunar.year)}
            </div>
          </div>
        </div>
      );
      break;
    case "minimal":
      body = (
        <>
          {time("xl")}
          <div className="clock-date">
            {WEEKDAYS[now.getDay()]}, {pad2(d)}/{pad2(m)}/{y} · ÂL {lunar.day}/{lunar.month}
          </div>
        </>
      );
      break;
    default:
      body = (
        <>
          {time()}
          {dateLine}
          {lunarLine}
        </>
      );
  }

  return (
    <WidgetShell label="clock" className={`clock skin-${skin}`} onDoubleClick={cycleSkin}>
      {body}
    </WidgetShell>
  );
}
