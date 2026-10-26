import { canChiYear, lunarToSolar, solarToLunar } from "../src/lib/lunar.ts";

type Case = [[number, number, number], [number, number, number, boolean]];
const cases: Case[] = [
  [[17, 2, 2026], [1, 1, 2026, false]],
  [[29, 1, 2025], [1, 1, 2025, false]],
  [[10, 2, 2024], [1, 1, 2024, false]],
  [[22, 1, 2023], [1, 1, 2023, false]],
  [[25, 7, 2025], [1, 6, 2025, true]],
  [[22, 3, 2023], [1, 2, 2023, true]],
  [[1, 1, 2025], [2, 12, 2024, false]],
  [[2, 9, 2025], [11, 7, 2025, false]],
  [[6, 10, 2025], [15, 8, 2025, false]],
  [[6, 9, 2025], [15, 7, 2025, false]],
];

let failed = 0;
for (const [[d, m, y], [ld, lm, ly, leap]] of cases) {
  const r = solarToLunar(d, m, y);
  const ok = r.day === ld && r.month === lm && r.year === ly && r.leap === leap;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${d}/${m}/${y} -> ${r.day}/${r.month}/${r.year}${r.leap ? " nhuận" : ""} (mong đợi ${ld}/${lm}/${ly}${leap ? " nhuận" : ""})`,
  );
  const back = lunarToSolar(ld, lm, ly, leap);
  const okBack = back[0] === d && back[1] === m && back[2] === y;
  if (!okBack) failed++;
  console.log(`${okBack ? "PASS" : "FAIL"} ngược lại -> ${back.join("/")}`);
}
const years: Array<[number, string]> = [
  [2024, "Giáp Thìn"],
  [2025, "Ất Tỵ"],
  [2026, "Bính Ngọ"],
];
for (const [y, name] of years) {
  const ok = canChiYear(y) === name;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} can chi ${y} = ${canChiYear(y)}`);
}
if (failed) {
  console.error(`${failed} kiểm tra thất bại`);
  throw new Error("Kiểm tra âm lịch thất bại");
}
console.log("Tất cả kiểm tra âm lịch đạt");
