// 中国法定节假日查询
// 数据由 scripts/fetch-holidays.mjs 从 NateScarlet/holiday-cn (MIT) 显式刷新
// （npm run fetch:holidays），不是 build 钩子。生成 src/data/holidays/{year}.json
// 与 index.ts。esbuild 通过 JSON import 把数据编入 main.js，运行时无网络依赖。

import { ALL_HOLIDAYS } from '../data/holidays/index';

/** holiday-cn 的单日记录 */
export interface HolidayDay {
  name: string;
  date: string;       // "YYYY-MM-DD"
  isOffDay: boolean;  // true=放假,false=调休补班
}

/** holiday-cn 的年度数据 */
export interface HolidayYear {
  year: number;
  papers?: string[];
  days: HolidayDay[];
}

let _index: Map<string, HolidayDay> | null = null;

function buildIndex(): Map<string, HolidayDay> {
  if (_index) return _index;
  const m = new Map<string, HolidayDay>();
  for (const y of ALL_HOLIDAYS) {
    if (!y || !Array.isArray(y.days)) continue;
    for (const d of y.days) {
      if (d && typeof d.date === 'string') {
        m.set(d.date, d);
      }
    }
  }
  _index = m;
  return m;
}

/** 把 Date 按本地时区格式化为 "YYYY-MM-DD"(与 scheduler 的 getDate/getDay 保持一致) */
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 查询指定日期的节假日记录,无则返回 undefined。Accepts Date or "YYYY-MM-DD". */
export function lookupHoliday(date: Date | string): HolidayDay | undefined {
  const key = typeof date === 'string' ? date : formatLocalDate(date);
  return buildIndex().get(key);
}
