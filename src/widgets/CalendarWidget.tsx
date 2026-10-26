import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useInterval, useWindowSize } from "../hooks";
import { WEEKDAYS } from "../lib/format";
import { eventsFor, type DayEvent } from "../lib/holidays";
import { dayInfo, isLunarNewYearEve, solarToLunar, type LunarDate } from "../lib/lunar";
import { BASE_SIZES } from "../types";

interface Cell {
  key: string;
  d: number;
  m: number;
  y: number;
  inMonth: boolean;
  weekday: number;
  lunar: LunarDate;
  events: DayEvent[];
  isToday: boolean;
}

function buildMonth(y: number, m: number, today: Date): Cell[] {
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // tuần bắt đầu từ Thứ Hai
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(y, m - 1, 1 - offset + i);
    const d = date.getDate();
    const mm = date.getMonth() + 1;
    const yy = date.getFullYear();
    const lunar = solarToLunar(d, mm, yy);
    cells.push({
      key: `${yy}-${mm}-${d}`,
      d,
      m: mm,
      y: yy,
      inMonth: mm === m,
      weekday: date.getDay(),
      lunar,
      events: eventsFor(d, mm, lunar, isLunarNewYearEve(d, mm, yy)),
      isToday: d === today.getDate() && mm === today.getMonth() + 1 && yy === today.getFullYear(),
    });
  }
  return cells;
}

const WEEK_HEAD = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function CalendarWidget() {
  const [today, setToday] = useState(() => new Date());
  useWindowSize("calendar", BASE_SIZES.calendar[0], BASE_SIZES.calendar[1]);
  useInterval(() => {
    const n = new Date();
    if (n.getDate() !== today.getDate()) setToday(n);
  }, 30_000);

  const [view, setView] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() + 1 }));
  const [sel, setSel] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() }));

  const cells = useMemo(() => buildMonth(view.y, view.m, today), [view.y, view.m, today]);
  const info = useMemo(() => dayInfo(sel.d, sel.m, sel.y), [sel.d, sel.m, sel.y]);
  const selDate = new Date(sel.y, sel.m - 1, sel.d);
  const selEvents = eventsFor(sel.d, sel.m, info.lunar, isLunarNewYearEve(sel.d, sel.m, sel.y));

  const shift = (delta: number) => {
    const dt = new Date(view.y, view.m - 1 + delta, 1);
    setView({ y: dt.getFullYear(), m: dt.getMonth() + 1 });
  };
  const goToday = () => {
    setView({ y: today.getFullYear(), m: today.getMonth() + 1 });
    setSel({ y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() });
  };

  return (
    <WidgetShell label="calendar" className="calendar">
      <div className="cal-head">
        <div className="cal-title">
          Tháng {view.m}, {view.y}
        </div>
        <div className="cal-nav">
          <button className="icon-btn" title="Tháng trước" onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="text-btn" onClick={goToday}>
            Hôm nay
          </button>
          <button className="icon-btn" title="Tháng sau" onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="cal-weekdays">
        {WEEK_HEAD.map((w, i) => (
          <div key={w} className={i === 6 ? "sun" : ""}>
            {w}
          </div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((c) => {
          const isSel = c.d === sel.d && c.m === sel.m && c.y === sel.y;
          const off = c.events.some((e) => e.off);
          const cls = [
            "cal-cell",
            c.inMonth ? "" : "out",
            c.isToday ? "today" : "",
            isSel ? "sel" : "",
            c.weekday === 0 ? "sun" : "",
            off ? "holiday" : "",
            c.events.length ? "has-event" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const lunarText =
            c.lunar.day === 1 ? `${c.lunar.day}/${c.lunar.month}${c.lunar.leap ? "n" : ""}` : String(c.lunar.day);
          return (
            <button
              key={c.key}
              className={cls}
              onClick={() => setSel({ y: c.y, m: c.m, d: c.d })}
              title={c.events.map((e) => e.name).join(", ")}
            >
              <span className="cal-d">{c.d}</span>
              <span className={`cal-l ${c.lunar.day === 1 ? "first" : ""}`}>{lunarText}</span>
            </button>
          );
        })}
      </div>
      <div className="cal-info">
        <div className="cal-info-title">
          {WEEKDAYS[selDate.getDay()]}, {sel.d}/{sel.m}/{sel.y}
        </div>
        <div>
          Ngày {info.lunar.day} tháng {info.lunar.month}
          {info.lunar.leap ? " (nhuận)" : ""} năm {info.yearName}
        </div>
        <div className="muted">
          Ngày {info.dayName} · Tháng {info.monthName} · Tiết {info.tietKhi}
        </div>
        <div className="muted">Giờ hoàng đạo: {info.gioHoangDao.map((g) => g.split(" ")[0]).join(", ")}</div>
        {selEvents.length > 0 && (
          <div className="cal-events">
            {selEvents.map((e) => (
              <span key={e.name} className={`chip ${e.off ? "chip-red" : ""}`}>
                {e.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
