import { Moon, Power, RotateCcw, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WidgetShell } from "../components/WidgetShell";
import { useWindowSize } from "../hooks";
import { invoke } from "../tauri";
import { BASE_SIZES } from "../types";

type Action = "shutdown" | "restart" | "sleep";

const ACTIONS: ReadonlyArray<{ id: Action; label: string; Icon: LucideIcon; tone: string }> = [
  { id: "shutdown", label: "Tắt máy", Icon: Power, tone: "red" },
  { id: "restart", label: "Khởi động lại", Icon: RotateCcw, tone: "orange" },
  { id: "sleep", label: "Ngủ", Icon: Moon, tone: "accent" },
];

const CONFIRM_MS = 5000;

export function PowerWidget() {
  const [armed, setArmed] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useWindowSize("power", BASE_SIZES.power[0], BASE_SIZES.power[1]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const click = async (action: Action) => {
    window.clearTimeout(timer.current);
    if (armed !== action) {
      // Nhấn lần đầu chỉ "lên đạn", nhấn lần hai trong 5 giây mới thực hiện.
      setArmed(action);
      setError(null);
      timer.current = window.setTimeout(() => setArmed(null), CONFIRM_MS);
      return;
    }
    setArmed(null);
    try {
      await invoke("power_action", { action });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <WidgetShell label="power" className="power">
      <div className="power-row">
        {ACTIONS.map(({ id, label, Icon, tone }) => (
          <button
            key={id}
            className={`power-btn tone-${tone} ${armed === id ? "armed" : ""}`}
            onClick={() => void click(id)}
            title={armed === id ? "Nhấn lại để xác nhận" : label}
          >
            <span className="power-ic">
              <Icon size={20} strokeWidth={2} />
            </span>
            <span className="power-label">{armed === id ? "Nhấn lại để xác nhận" : label}</span>
          </button>
        ))}
      </div>
      {error && <div className="muted tiny">{error}</div>}
    </WidgetShell>
  );
}
