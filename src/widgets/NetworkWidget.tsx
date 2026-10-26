import { ArrowDown, ArrowUp, Network } from "lucide-react";
import { useState } from "react";
import { Sparkline } from "../components/Sparkline";
import { WidgetShell } from "../components/WidgetShell";
import { useEvent, useWindowSize } from "../hooks";
import { formatBytes, formatSpeed } from "../lib/format";
import { useSettings } from "../settings";
import { BASE_SIZES, type NetSample } from "../types";

const HISTORY = 60;

export function NetworkWidget() {
  const { settings } = useSettings();
  useWindowSize("network", BASE_SIZES.network[0], BASE_SIZES.network[1]);
  const [sample, setSample] = useState<NetSample | null>(null);
  const [history, setHistory] = useState<Array<[number, number]>>(() =>
    Array.from({ length: HISTORY }, () => [0, 0] as [number, number]),
  );

  useEvent<NetSample>("net-speed", (s) => {
    setSample(s);
    setHistory((h) => [...h.slice(1), [s.downBps, s.upBps]]);
  });

  const down = formatSpeed(sample?.downBps ?? 0, settings.netUnit);
  const up = formatSpeed(sample?.upBps ?? 0, settings.netUnit);

  return (
    <WidgetShell
      label="network"
      className="network"
      title={
        <>
          <Network size={13} strokeWidth={2} />
          <span>{sample?.interface || "Tốc độ mạng"}</span>
        </>
      }
    >
      <div className="net-rows">
        <div className="net-row">
          <span className="net-ic down">
            <ArrowDown size={16} strokeWidth={2.4} />
          </span>
          <span className="net-val">{down.value}</span>
          <span className="net-unit">{down.unit}</span>
        </div>
        <div className="net-row">
          <span className="net-ic up">
            <ArrowUp size={16} strokeWidth={2.4} />
          </span>
          <span className="net-val">{up.value}</span>
          <span className="net-unit">{up.unit}</span>
        </div>
      </div>
      <Sparkline data={history} points={HISTORY} height={38} />
      <div className="w-foot net-foot">
        <span>Tổng ↓ {formatBytes(sample?.totalDown ?? 0)}</span>
        <span>↑ {formatBytes(sample?.totalUp ?? 0)}</span>
      </div>
    </WidgetShell>
  );
}
