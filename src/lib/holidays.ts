import type { LunarDate } from "./lunar";

export interface DayEvent {
  name: string;
  /** Ngày nghỉ lễ chính thức */
  off: boolean;
  /** Tính theo âm lịch */
  lunar: boolean;
}

const SOLAR: Record<string, [string, boolean]> = {
  "1/1": ["Tết Dương lịch", true],
  "3/2": ["Thành lập Đảng Cộng sản Việt Nam", false],
  "14/2": ["Lễ Tình nhân", false],
  "27/2": ["Ngày Thầy thuốc Việt Nam", false],
  "8/3": ["Quốc tế Phụ nữ", false],
  "26/3": ["Thành lập Đoàn TNCS Hồ Chí Minh", false],
  "30/4": ["Giải phóng miền Nam", true],
  "1/5": ["Quốc tế Lao động", true],
  "7/5": ["Chiến thắng Điện Biên Phủ", false],
  "19/5": ["Sinh nhật Chủ tịch Hồ Chí Minh", false],
  "1/6": ["Quốc tế Thiếu nhi", false],
  "28/6": ["Ngày Gia đình Việt Nam", false],
  "27/7": ["Thương binh Liệt sĩ", false],
  "19/8": ["Cách mạng tháng Tám", false],
  "2/9": ["Quốc khánh", true],
  "10/10": ["Giải phóng Thủ đô", false],
  "13/10": ["Ngày Doanh nhân Việt Nam", false],
  "20/10": ["Phụ nữ Việt Nam", false],
  "20/11": ["Nhà giáo Việt Nam", false],
  "22/12": ["Quân đội Nhân dân Việt Nam", false],
  "24/12": ["Lễ Giáng sinh", false],
};

const LUNAR: Record<string, [string, boolean]> = {
  "1/1": ["Tết Nguyên Đán", true],
  "2/1": ["Mùng 2 Tết", true],
  "3/1": ["Mùng 3 Tết", true],
  "15/1": ["Rằm tháng Giêng", false],
  "3/3": ["Tết Hàn thực", false],
  "10/3": ["Giỗ Tổ Hùng Vương", true],
  "15/4": ["Lễ Phật Đản", false],
  "5/5": ["Tết Đoan Ngọ", false],
  "15/7": ["Lễ Vu Lan", false],
  "15/8": ["Tết Trung Thu", false],
  "23/12": ["Ông Táo chầu trời", false],
};

export function eventsFor(day: number, month: number, lunar: LunarDate, isNewYearEve: boolean): DayEvent[] {
  const out: DayEvent[] = [];
  const s = SOLAR[`${day}/${month}`];
  if (s) out.push({ name: s[0], off: s[1], lunar: false });
  if (!lunar.leap) {
    const l = LUNAR[`${lunar.day}/${lunar.month}`];
    if (l) out.push({ name: l[0], off: l[1], lunar: true });
  }
  if (isNewYearEve) out.push({ name: "Giao thừa", off: true, lunar: true });
  return out;
}
