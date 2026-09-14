/**
 * 日付ユーティリティ
 *
 * 一次情報：CLAUDE.md §2.2、docs/adr/0002-日付を文字列で持つ.md
 *
 * **このファイルは Date オブジェクトを一切使わない。**
 * CLAUDE.md §2.2 は「Date は月末計算などの内側だけで使う」と許容しているが、
 * 閏年と月末の判定は算術で完結するため、Date を持ち込む理由がない。
 * Date を使わなければ、UTC 変換もローカルタイムゾーン依存も原理的に起きない。
 *
 * 月末寄せ（`min(day, その月の末日)`）と締め月の繰り越しは、
 * CL-1（予定の展開）・CL-2（カード引落）・CL-8（借入返済）・CL-9（入金予定）が
 * すべて同じ規則を使う。実装が分かれると片方だけ壊れるため、ここに1つだけ置く
 * （docs/PoC開発計画.md §5.6）。
 */

import type { DateStr, YearMonth } from "./types";

/** 年と月（1〜12）の組。月をまたぐ計算の中間表現。 */
export interface YM {
  year: number;
  /** 1〜12 */
  month: number;
}

/** 年月日の組。 */
export interface YMD extends YM {
  /** 1〜31 */
  day: number;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** グレゴリオ暦の閏年判定。 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * その月の末日（28〜31）。
 * @param month 1〜12
 */
export function lastDayOfMonth(year: number, month: number): number {
  if (month < 1 || month > 12 || !Number.isInteger(month)) {
    throw new RangeError(`月が範囲外です: ${month}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1];
}

/**
 * 'YYYY-MM-DD' に整形する。日は月末に丸めない（丸めるのは dayInMonth）。
 * @param month 1〜12
 */
export function formatDate(year: number, month: number, day: number): DateStr {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 'YYYY-MM-DD' を年月日に分解する。
 *
 * 書式が違う、または存在しない日付（2026-02-30 など）のときは投げる。
 * 金額を扱うアプリで、壊れた日付を黙って別の日付に読み替えるほうが危険なため。
 */
export function parseDate(date: DateStr): YMD {
  const m = DATE_PATTERN.exec(date);
  if (!m) {
    throw new RangeError(`日付の書式が 'YYYY-MM-DD' ではありません: ${date}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) {
    throw new RangeError(`月が範囲外です: ${date}`);
  }
  if (day < 1 || day > lastDayOfMonth(year, month)) {
    throw new RangeError(`存在しない日付です: ${date}`);
  }
  return { year, month, day };
}

/**
 * **月末寄せ。** `min(day, その月の末日)` の日付を返す。
 *
 * `day = 31` は自動的に月末になる（CL-1 手順2）。2月は28日または29日、
 * 4月は30日（AC-02）。CL-2 の引落日、CL-8 の返済日、CL-9 の入金予定日も
 * 同じ規則を使う。
 *
 * @param day 1〜31
 */
export function dayInMonth(year: number, month: number, day: number): DateStr {
  if (day < 1 || day > 31 || !Number.isInteger(day)) {
    throw new RangeError(`日が範囲外です: ${day}`);
  }
  return formatDate(year, month, Math.min(day, lastDayOfMonth(year, month)));
}

/**
 * 年月を n ヶ月ずらす。n は負でもよい。
 *
 * CL-2 の「締め月 = 利用月 + 1ヶ月」「支払月 = 締め月 + payMonthOffset」、
 * CL-9 の同じ構造の計算で使う。
 */
export function shiftMonth({ year, month }: YM, n: number): YM {
  const zeroBased = year * 12 + (month - 1) + n;
  return {
    year: Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

/** 'YYYY-MM-DD' から 'YYYY-MM' を取り出す。 */
export function toYearMonth(date: DateStr): YearMonth {
  return date.slice(0, 7);
}

/** 年月を 'YYYY-MM' に整形する。 */
export function formatYearMonth({ year, month }: YM): YearMonth {
  return `${String(year).padStart(4, "0")}-${pad2(month)}`;
}

/**
 * from の月から to の月までを、両端を含めて順に返す。
 *
 * from が to より後の場合は空配列。日は無視し、月単位で数える。
 */
export function eachMonth(from: DateStr, to: DateStr): YM[] {
  const start = parseDate(from);
  const end = parseDate(to);
  const months: YM[] = [];
  const count =
    (end.year * 12 + end.month) - (start.year * 12 + start.month);
  for (let i = 0; i <= count; i++) {
    months.push(shiftMonth(start, i));
  }
  return months;
}

/**
 * 1970-01-01 からの通算日数。
 *
 * Howard Hinnant の civil_from_days の逆算。Date を使わずに求める
 * （docs/adr/0006-coreの日付計算にDateオブジェクトを使わない.md）。
 * 3月始まりの暦に置き換えて閏日を年末に寄せることで、割り算だけで解ける。
 */
export function toDayNumber(date: DateStr): number {
  const { year, month, day } = parseDate(date);
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** 通算日数から 'YYYY-MM-DD' に戻す。`toDayNumber` の逆。 */
export function fromDayNumber(days: number): DateStr {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return formatDate(year + (month <= 2 ? 1 : 0), month, day);
}

/** n 日進める。n は負でもよい。 */
export function addDays(date: DateStr, n: number): DateStr {
  return fromDayNumber(toDayNumber(date) + n);
}

/** 2つの日付の隔たり（日数）。順序によらず0以上を返す。 */
export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.abs(toDayNumber(a) - toDayNumber(b));
}

/**
 * 日付が [from, to] の範囲内か（両端を含む）。
 *
 * 'YYYY-MM-DD' は辞書順が時系列順と一致するため、文字列比較でよい。
 */
export function isWithin(date: DateStr, from: DateStr, to: DateStr): boolean {
  return date >= from && date <= to;
}

/**
 * 符号位置による文字列の昇順比較。**localeCompare を使わない。**
 *
 * localeCompare は実行環境の既定ロケールに依存し、同じ入力で同じ順序が
 * 返る保証がない。core は純関数でなければならない（CLAUDE.md §2.3）。
 */
export function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 日付の昇順比較。
 *
 * 'YYYY-MM-DD' は辞書順が時系列順と一致するため、文字列比較でよい。
 */
export function compareDate(a: DateStr, b: DateStr): number {
  return compareString(a, b);
}
