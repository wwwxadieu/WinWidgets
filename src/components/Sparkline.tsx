interface Props {
  /** Mỗi phần tử: [tải xuống, tải lên] theo byte/giây, mới nhất ở cuối. */
  data: Array<[number, number]>;
  points?: number;
  height?: number;
}

export function Sparkline({ data, points = 60, height = 40 }: Props) {
  const width = 100;
  const floor = 50 * 1024;
  let max = floor;
  for (const [d, u] of data) max = Math.max(max, d, u);

  const path = (idx: 0 | 1) => {
    if (data.length < 2) return "";
    const offset = points - data.length;
    const coords = data.map((p, i) => {
      const x = ((i + offset) / (points - 1)) * width;
      const y = height - (p[idx] / max) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const first = ((offset) / (points - 1)) * width;
    return `M${first.toFixed(2)},${height} L${coords.join(" L")} L${width},${height} Z`;
  };

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <path className="spark-down" d={path(0)} />
      <path className="spark-up" d={path(1)} />
    </svg>
  );
}
