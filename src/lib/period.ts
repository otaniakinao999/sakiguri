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

/**
 * プリセットの月数。
 *
 * `recent` は既定（先月〜6ヶ月先）。`custom` は開始月・終了月を自分で選ぶ。
 * 数値のプリセットは今月起点で、その月数ぶんを表示する。
 */
export type PeriodPreset = 1 | 3 | 6 | 12 | "recent" | "custom";

/** 既定。予測の確からしさは直近の実績が予定どおりだったかで判断される */
export const DEFAULT_PRESET: PeriodPreset = "recent";

/** 既定が遡る月数。1ヶ月前まで見せる */
export const RECENT_LOOKBACK_MONTHS = 1;

/**
 * 既定が先を見る月数。
 *
 * 「6ヶ月」プリセットと同じ終端にしてある（今月を含めて6ヶ月）。
 * 既定と 6ヶ月プリセットで先の広さが違うと、切り替えたときに何が
 * 変わったのか分からなくなる。
 */
export const RECENT_AHEAD_MONTHS = 6;

export const PERIOD_PRESETS: readonly {
  value: PeriodPreset;
  label: string;
}[] = [
  { value: "recent", label: "先月〜6ヶ月" },
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
 *
 * `recent`（既定）だけは1ヶ月遡る。**先月が基準日より前になる場合は
 * 基準日の月に寄せる。** 基準日より前は残高が計算できないため
 * （要件定義書 §4.2「基準日以降の任意の過去月」）。
 */
export function presetRange(
  preset: Exclude<PeriodPreset, "custom">,
  asOf: DateStr,
  today: DateStr,
): PeriodRange {
  const months = selectableMonths(asOf);
  const currentYm = toYearMonth(today);
  /* 基準日が今月より後なら indexOf が -1 になる。その場合は先頭＝基準日の月 */
  const currentIndex = Math.max(0, months.indexOf(currentYm));

  const lookback = preset === "recent" ? RECENT_LOOKBACK_MONTHS : 0;
  const span = preset === "recent" ? RECENT_AHEAD_MONTHS : preset;

  /* 遡りは基準日の月で止める。0 より前へは行けない */
  const startIndex = Math.max(0, currentIndex - lookback);
  const endIndex = Math.min(currentIndex + span - 1, months.length - 1);

  const from = months[startIndex] ?? months[0];
  const to = months[Math.max(endIndex, startIndex)] ?? from;
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
