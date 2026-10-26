import { AppWindow, LayoutGrid, LocateFixed, Plus, Power, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Dropdown } from "../components/Dropdown";
import { geocode, type GeoResult } from "../lib/weather";
import { useSettings } from "../settings";
import { invoke, isTauri } from "../tauri";
import { CLOCK_SKINS, WIDGETS, type AppInfo, type ClockSkin, type LaunchItem, type PinMode, type Theme } from "../types";
import { useLauncherIcons } from "./LauncherWidget";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? "active" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div className="row-ctl">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sec">
      <h2>{title}</h2>
      <div className="card">{children}</div>
    </section>
  );
}

function LauncherList({ items, onRename }: { items: LaunchItem[]; onRename: (id: string, name: string) => void }) {
  const icons = useLauncherIcons(items);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!items.length) return <div className="muted small note">Chưa có ứng dụng nào. Bấm "Thêm ứng dụng" hoặc kéo thả tệp vào widget Mở nhanh.</div>;
  return (
    <div className="launch-list">
      {items.map((item) => {
        const src = icons.get(item.id);
        const draft = drafts[item.id] ?? item.name;
        const commit = () => {
          const name = draft.trim();
          setDrafts((d) => {
            const next = { ...d };
            delete next[item.id];
            return next;
          });
          if (name && name !== item.name) onRename(item.id, name);
        };
        return (
          <div className="launch-item" key={item.id}>
            <span className="launch-ic">{src ? <img src={src} alt="" /> : <AppWindow size={18} strokeWidth={1.6} />}</span>
            <div className="launch-item-text">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <div className="launch-path" title={item.path}>
                {item.path}
              </div>
            </div>
            <button className="icon-btn" title="Xóa khỏi Mở nhanh" onClick={() => void invoke("remove_launcher_item", { id: item.id })}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function SettingsWindow() {
  const { settings, save, loaded } = useSettings();
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    invoke<string[]>("list_net_interfaces").then((v) => setInterfaces(v ?? [])).catch(() => {});
    invoke<AppInfo>("get_app_info").then(setInfo).catch(() => {});
  }, []);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await geocode(q);
      setResults(r);
      if (!r.length) setSearchError("Không tìm thấy địa điểm");
    } catch {
      setSearchError("Không tìm kiếm được, kiểm tra kết nối mạng");
    } finally {
      setSearching(false);
    }
  };

  const hiddenSet = new Set(settings.hidden);
  const toggleWidget = (label: string, visible: boolean) => {
    const hidden = settings.hidden.filter((l) => l !== label);
    if (!visible) hidden.push(label);
    void save({ hidden });
  };

  const pickApps = async () => {
    setPicking(true);
    try {
      await invoke("pick_launcher_apps");
    } finally {
      setPicking(false);
    }
  };

  const renameApp = (id: string, name: string) => {
    void save({ launcher: settings.launcher.map((i) => (i.id === id ? { ...i, name } : i)) });
  };

  if (!loaded) return <div className="settings-page">Đang tải…</div>;

  const ifaceOptions = [{ value: "", label: "Tự động", hint: "Cộng mọi card thật, bỏ qua card ảo" }, ...interfaces.map((n) => ({ value: n, label: n }))];

  return (
    <div className="settings-page">
      <header className="settings-head">
        <h1>WinWidgets</h1>
        <p className="muted">Cài đặt áp dụng ngay cho mọi widget.</p>
      </header>

      <Section title="Giao diện">
        <Row label="Chủ đề">
          <Segmented<Theme>
            value={settings.theme}
            options={[
              ["auto", "Theo hệ thống"],
              ["dark", "Tối"],
              ["light", "Sáng"],
            ]}
            onChange={(theme) => void save({ theme })}
          />
        </Row>
        <Row label="Độ đục nền" hint={`${Math.round(settings.opacity * 100)}%`}>
          <input
            type="range"
            min={40}
            max={100}
            value={Math.round(settings.opacity * 100)}
            onChange={(e) => void save({ opacity: Number(e.target.value) / 100 })}
          />
        </Row>
        <Row label="Vị trí hiển thị" hint="Trên desktop: luôn nằm dưới các cửa sổ khác">
          <Segmented<PinMode>
            value={settings.pinMode}
            options={[
              ["desktop", "Trên desktop"],
              ["top", "Luôn nổi"],
              ["normal", "Bình thường"],
            ]}
            onChange={(pinMode) => void save({ pinMode })}
          />
        </Row>
      </Section>

      <Section title="Widget">
        {WIDGETS.map((w) => (
          <Row key={w.label} label={w.title} hint={w.description}>
            <Toggle checked={!hiddenSet.has(w.label)} onChange={(v) => toggleWidget(w.label, v)} />
          </Row>
        ))}
      </Section>

      <Section title="Đồng hồ">
        <Row label="Kiểu hiển thị" hint="Nhấp đúp vào widget đồng hồ để đổi nhanh">
          <Dropdown<ClockSkin> value={settings.clockSkin} options={CLOCK_SKINS} onChange={(clockSkin) => void save({ clockSkin })} width={180} />
        </Row>
        <Row label="Định dạng 24 giờ">
          <Toggle checked={settings.clock24h} onChange={(clock24h) => void save({ clock24h })} />
        </Row>
        <Row label="Hiện giây">
          <Toggle checked={settings.showSeconds} onChange={(showSeconds) => void save({ showSeconds })} />
        </Row>
      </Section>

      <Section title="Thời tiết">
        <Row label="Địa điểm" hint={settings.weather ? settings.weather.name : "Tự động theo địa chỉ IP"}>
          {settings.weather && (
            <button className="text-btn" onClick={() => void save({ weather: null })}>
              <LocateFixed size={14} /> Tự động
            </button>
          )}
        </Row>
        <div className="search-row">
          <input
            type="text"
            placeholder="Tìm thành phố, ví dụ: Đà Nẵng"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <button className="primary-btn" onClick={() => void search()} disabled={searching}>
            <Search size={14} /> {searching ? "Đang tìm…" : "Tìm"}
          </button>
        </div>
        {searchError && <div className="muted small">{searchError}</div>}
        {results.length > 0 && (
          <div className="results">
            {results.map((r) => (
              <button
                key={`${r.lat},${r.lon}`}
                className="result"
                onClick={() => {
                  void save({ weather: { name: r.name, lat: r.lat, lon: r.lon } });
                  setResults([]);
                  setQuery("");
                }}
              >
                <span>{r.name}</span>
                <span className="muted small">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
              </button>
            ))}
          </div>
        )}
        <Row label="Đơn vị nhiệt độ">
          <Segmented<"c" | "f">
            value={settings.tempUnit}
            options={[
              ["c", "°C"],
              ["f", "°F"],
            ]}
            onChange={(tempUnit) => void save({ tempUnit })}
          />
        </Row>
      </Section>

      <Section title="Tốc độ mạng">
        <Row label="Giao diện mạng">
          <Dropdown value={settings.netInterface} options={ifaceOptions} onChange={(netInterface) => void save({ netInterface })} width={210} />
        </Row>
        <Row label="Đơn vị">
          <Segmented<"bytes" | "bits">
            value={settings.netUnit}
            options={[
              ["bytes", "Byte/s"],
              ["bits", "bit/s"],
            ]}
            onChange={(netUnit) => void save({ netUnit })}
          />
        </Row>
      </Section>

      <Section title="Mở nhanh">
        <Row label="Ứng dụng" hint="Kéo thả tệp .exe hoặc lối tắt vào widget cũng thêm được">
          <button className="text-btn" onClick={() => void pickApps()} disabled={picking}>
            <Plus size={14} /> {picking ? "Đang chọn…" : "Thêm ứng dụng"}
          </button>
        </Row>
        <LauncherList items={settings.launcher} onRename={renameApp} />
      </Section>

      <Section title="Hệ thống">
        <Row label="Khởi động cùng Windows">
          <Toggle checked={settings.autostart} onChange={(autostart) => void save({ autostart })} />
        </Row>
        <Row label="Sắp xếp lại vị trí" hint="Xếp các widget thành cột sát mép phải màn hình">
          <button className="text-btn" onClick={() => void invoke("reset_layout")}>
            <LayoutGrid size={14} /> Sắp xếp
          </button>
        </Row>
        <Row label="Thoát WinWidgets" hint="Ẩn mọi widget và biểu tượng khay">
          <button className="text-btn danger" onClick={() => void invoke("quit_app")} disabled={!isTauri}>
            <Power size={14} /> Thoát
          </button>
        </Row>
      </Section>

      <Section title="Thông tin">
        <Row label="Phiên bản">{info?.version ?? "…"}</Row>
        <Row label="Thư mục cấu hình" hint={info?.configDir ?? "…"} />
        <Row label="Dữ liệu Claude Code" hint={info?.claudeDir ?? "…"} />
        <p className="muted small note">
          Widget Claude đọc các file nhật ký cục bộ của Claude Code để đếm token (ước tính giá theo bảng giá API).
          Phần trăm giới hạn gói (5 giờ / tuần) chỉ hiện khi máy có token OAuth của Claude Code CLI.
          Thời tiết dùng dữ liệu Open-Meteo, không cần khoá API. Widget Nguồn cần nhấn hai lần để xác nhận.
        </p>
      </Section>
    </div>
  );
}
