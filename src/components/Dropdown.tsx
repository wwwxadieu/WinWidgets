import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T extends string> {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  placeholder?: string;
  width?: number;
}

/** Dropdown tùy biến thay cho select gốc, cùng phong cách kính với phần còn lại. */
export function Dropdown<T extends string>({ value, options, onChange, placeholder = "Chọn…", width = 200 }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={`dropdown ${open ? "open" : ""}`} ref={ref} style={{ width }}>
      <button className="dropdown-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="dropdown-label">{current?.label ?? placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`dropdown-item ${o.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="dropdown-item-text">
                <span>{o.label}</span>
                {o.hint && <span className="muted small">{o.hint}</span>}
              </span>
              {o.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
