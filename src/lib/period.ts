/**
 * 期間の指定（SC-03）
 *
 * 一次情報：docs/要件定義書.md §4.2
 *   プリセット（今月／3ヶ月／6ヶ月／12ヶ月）と、開始月・終了月の任意指定を
 *   切り替えられる。任意指定では基準日以降の任意の過去月を選べる。
 */

import {
  formatYearMonth,
  parseDate,
  shiftMonth,
  toYearMonth,
} from "@/core/date";
import type { DateStr, YearMonth } from "@/core/types";

/**
 * 予測期間。基準日から何ヶ月ぶんの行を作るか。
 *
 * 要件定義書 §5.1 が性能目標の条件として「予測期間24ヶ月」を挙げている。
 * 12ヶ月のプリセットを今月起点で表示するには12ヶ月あれば足りるが、
 * 基準日が過去にある場合に備えて余裕を持たせてある。
 */
export const FORECAST_HORIZON_MONTHS = 24;

/** プリセットの月数。`custom` は開始月・終了月を自分で選ぶ。 */
export type PeriodPreset = 1 | 3 | 6 | 12 | "custom";

export const PERIOD_PRESETS: readonly {
  value: PeriodPreset;
  label: string;
}[] = [
  { value: 1, label: "今月" },
  { value: 3, label: "3ヶ月" },
  { value: 6, label: "6ヶ月" },
  { value: 12, label: "12ヶ月" },
  { value: "custom", label: "期間を指定" },
];

/** 表示する年月の範囲（両端を含む）。 */
export interface PeriodRange {
  from: YearMonth;
  to: YearMonth;
}

/** 予測の終端。基準日から `FORECAST_HORIZON_MONTHS` ヶ月後の末日。 */
export function forecastEnd(asOf: DateStr): DateStr {
  const { year, month } = parseDate(asOf);
  const end = shiftMonth({ year, month }, FORECAST_HORIZON_MONTHS);
  /* 月末に寄せる。dayInMonth は 31 を各月の末日に丸める */
  return `${formatYearMonth(end)}-01`;
}

/**
 * 選べる年月の一覧。基準日の月から予測の終端まで。
 *
 * 任意指定では**基準日以降の**過去月も選べる（要件定義書 §4.2）。
 * 基準日より前は残高が計算できないため選べない。
 */
export function selectableMonths(asOf: DateStr): YearMonth[] {
  const { year, month } = parseDate(asOf);
  const months: YearMonth[] = [];
  for (let i = 0; i <= FORECAST_HORIZON_MONTHS; i++) {
    months.push(formatYearMonth(shiftMonth({ year, month }, i)));
  }
  return months;
}

/**
 * プリセットから表示範囲を決める。
 *
 * 起点は今月。ただし基準日が今月より後なら基準日の月から始める。
 * 終端は予測の終端を超えない。
 */
export function presetRange(
  preset: Exclude<PeriodPreset, "custom">,
  asOf: DateStr,
  today: DateStr,
): PeriodRange {
  const months = selectableMonths(asOf);
  const currentYm = toYearMonth(today);
  const startIndex = Math.max(0, months.indexOf(currentYm));
  const from = months[startIndex] ?? months[0];
  const to = months[Math.min(startIndex + preset - 1, months.length - 1)] ?? from;
  return { from, to };
}

/** 任意指定を範囲にする。開始と終了が逆でも受け付ける。 */
export function customRange(a: YearMonth, b: YearMonth): PeriodRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** 現在の指定から表示範囲を求める。 */
export function resolveRange(
  preset: PeriodPreset,
  custom: PeriodRange,
  asOf: DateStr,
  today: DateStr,
): PeriodRange {
  return preset === "custom" ? customRange(custom.from, custom.to) : presetRange(preset, asOf, today);
}
