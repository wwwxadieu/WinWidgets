import { RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useEvent, useInterval, useRefreshInterval, useWindowSize } from "../hooks";
import { WEEKDAYS_SHORT, formatDuration, formatTokens, formatUsd, parseYmd, timeHM } from "../lib/format";
import { invoke } from "../tauri";
import { BASE_SIZES, bucketTokens, type ClaudeUsage, type UsageWindow } from "../types";

function modelLabel(id: string): string {
  const m = id.match(/claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!m) return id.replace(/^claude-/, "");
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function resetNote(w: UsageWindow, weekly: boolean): string {
  if (!w.resetsAt) return "";
  const dt = new Date(w.resetsAt);
  if (Number.isNaN(dt.getTime())) return "";
  const diff = (dt.getTime() - Date.now()) / 1000;
  if (diff <= 0) return "đang đặt lại";
  if (weekly) return `đặt lại ${WEEKDAYS_SHORT[dt.getDay()]} ${timeHM(dt)} · còn ${formatDuration(diff)}`;
  return `đặt lại lúc ${timeHM(dt)} · còn ${formatDuration(diff)}`;
}

function Bar({
  label,
  pct,
  note,
  right,
  quota = true,
}: {
  label: string;
  pct: number;
  note?: string;
  right?: string;
  /** Thanh hạn mức đổi màu khi gần cạn; thanh thời gian thì không. */
  quota?: boolean;
}) {
  const p = Math.max(0, Math.min(100, pct));
  const tone = !quota ? "" : p >= 90 ? "red" : p >= 70 ? "orange" : "";
  return (
    <div className="cl-bar">
      <div className="cl-bar-head">
        <span>{label}</span>
        <b>{right ?? `${Math.round(p)}%`}</b>
      </div>
      <div className={`bar ${tone}`}>
        <i style={{ width: `${p}%` }} />
      </div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

const AUTH_HINT: Record<string, [string, string]> = {
  no_credentials: ["Chưa có token CLI", "Phần trăm giới hạn gói (5 giờ, tuần) chỉ hiện khi đăng nhập bằng Claude Code CLI."],
  no_token: ["Chưa có token CLI", "Phần trăm giới hạn gói (5 giờ, tuần) chỉ hiện khi đăng nhập bằng Claude Code CLI."],
  expired: ["Token CLI hết hạn", "Token OAuth trong .credentials.json đã hết hạn, mở Claude Code CLI để làm mới."],
  error: ["Lỗi lấy giới hạn gói", "Không gọi được endpoint usage của Claude, sẽ thử lại sau một phút."],
};

export function ClaudeWidget() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsage(await invoke<ClaudeUsage>("get_claude_usage"));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useWindowSize("claude", BASE_SIZES.claude[0], BASE_SIZES.claude[1]);
  useEffect(() => {
    void load();
  }, [load]);
  useRefreshInterval("claude", () => void load());
  useInterval(() => setTick((t) => t + 1), 30_000);
  useEvent("refresh", () => void load());

  const s = usage?.summary;
  const o = usage?.official;
  const nowSec = Date.now() / 1000;
  const plan = o?.plan ? o.plan.charAt(0).toUpperCase() + o.plan.slice(1) : null;
  const showOfficial = o?.status === "ok" && (o.fiveHour || o.sevenDay);
  const todayTokens = s ? bucketTokens(s.today) : 0;
  const maxWeek = s ? Math.max(1, ...s.week.map((d) => d.tokens)) : 1;

  return (
    <WidgetShell
      label="claude"
      className="claude"
      title={
        <>
          <Sparkles size={13} strokeWidth={2} />
          <span>Claude Code</span>
          {plan && <span className="badge">{plan}</span>}
        </>
      }
      right={
        <button className="icon-btn" title="Làm mới" onClick={() => void load()}>
          <RefreshCw size={13} strokeWidth={2} className={loading ? "spin" : ""} />
        </button>
      }
    >
      {!s ? (
        <div className="w-empty">{error ? `Lỗi: ${error}` : "Đang quét lịch sử Claude Code…"}</div>
      ) : (
        <>
          {showOfficial && o ? (
            <div className="cl-bars">
              {o.fiveHour && <Bar label="Phiên 5 giờ" pct={o.fiveHour.utilization} note={resetNote(o.fiveHour, false)} />}
              {o.sevenDay && <Bar label="Tuần này" pct={o.sevenDay.utilization} note={resetNote(o.sevenDay, true)} />}
            </div>
          ) : s.block ? (
            <Bar
              label={`Khối 5 giờ · ${timeHM(s.block.start * 1000)}–${timeHM(s.block.end * 1000)}`}
              pct={((nowSec - s.block.start) / (s.block.end - s.block.start)) * 100}
              right={`${formatTokens(bucketTokens(s.block.stats))} token`}
              note={`còn ${formatDuration(s.block.end - nowSec)} · ${s.block.stats.messages} tin nhắn · ≈ ${formatUsd(s.block.stats.cost)}`}
              quota={false}
            />
          ) : (
            <div className="cl-idle muted small">Không có phiên 5 giờ nào đang hoạt động</div>
          )}

          <div className="cl-today">
            <div>
              <div className="cl-big">{formatTokens(todayTokens)}</div>
              <div className="muted small">token hôm nay</div>
            </div>
            <div>
              <div className="cl-big">{s.today.messages}</div>
              <div className="muted small">tin nhắn</div>
            </div>
            <div>
              <div className="cl-big">{formatUsd(s.today.cost)}</div>
              <div className="muted small">≈ giá API</div>
            </div>
          </div>

          {s.modelsToday.length > 0 && todayTokens > 0 && (
            <div className="cl-models">
              {s.modelsToday.slice(0, 3).map((m) => (
                <span className="chip" key={m.model} title={`${formatTokens(m.tokens)} token · ${m.messages} tin nhắn`}>
                  {modelLabel(m.model)} {Math.round((m.tokens / todayTokens) * 100)}%
                </span>
              ))}
            </div>
          )}

          <div className="cl-week">
            {s.week.map((d, i) => {
              const h = Math.max(3, (d.tokens / maxWeek) * 100);
              const date = parseYmd(d.date);
              return (
                <div className="cl-week-col" key={d.date} title={`${d.date}: ${formatTokens(d.tokens)} token · ≈ ${formatUsd(d.cost)}`}>
                  <div className="cl-week-bar">
                    <i className={i === s.week.length - 1 ? "cur" : ""} style={{ height: `${h}%` }} />
                  </div>
                  <span className="tiny muted">{WEEKDAYS_SHORT[date.getDay()]}</span>
                </div>
              );
            })}
          </div>

          <div className="w-foot">
            <span title={`${s.scannedFiles} file nhật ký trong ${s.dataDir}`}>
              Cập nhật {timeHM(s.scannedAt * 1000)} · {s.sessionsToday} phiên
            </span>
            {o && o.status !== "ok" ? (
              <span title={AUTH_HINT[o.status]?.[1]}>{AUTH_HINT[o.status]?.[0] ?? ""}</span>
            ) : (
              <span>{s.scannedFiles} file nhật ký</span>
            )}
          </div>
        </>
      )}
    </WidgetShell>
  );
}
