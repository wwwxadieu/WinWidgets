import { SlidersHorizontal } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { invoke, isTauri, startDrag } from "../tauri";

interface Props {
  label: string;
  title?: ReactNode;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
  onDoubleClick?: () => void;
}

/** Khung kính chung: kéo thả để di chuyển, chuột phải mở menu, nút cài đặt khi rê chuột. */
export function WidgetShell({ label, title, right, className, children, onDoubleClick }: Props) {
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [data-no-drag]")) return;
    void startDrag();
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isTauri) void invoke("show_widget_menu", { label });
  };
  return (
    <div
      className={`widget ${className ?? ""}`}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, select, textarea")) return;
        onDoubleClick?.();
      }}
    >
      {(title || right) && (
        <div className="w-head">
          <div className="w-title">{title}</div>
          <div className="w-right">{right}</div>
        </div>
      )}
      {children}
      <button className="w-gear" title="Cài đặt WinWidgets" onClick={() => void invoke("open_settings")}>
        <SlidersHorizontal size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
