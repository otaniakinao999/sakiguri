/**
 * 表示のための整形
 *
 * 一次情報：docs/要件定義書.md §4.3 表示ルール、docs/designsystem.md §2.4
 *
 * ここは表示の都合であり、計算ではない。`src/core/` には置かない。
 */

import type { DateStr, Yen } from "@/core/types";

/**
 * マイナス記号（U+2212）。
 *
 * **ハイフンを使わない**（要件定義書 §4.3、designsystem.md §2.4）。
 * 等幅数字のなかでハイフンは幅と高さが揃わず、桁が読みにくくなる。
 */
export const MINUS = "−";

const grouping = new Intl.NumberFormat("ja-JP");

/** 3桁区切りの数字。符号は付けない。 */
function digits(amount: Yen): string {
  return grouping.format(Math.abs(Math.round(amount)));
}

/** 3桁区切り。マイナスは − を前に置く。単位は付けない。 */
export function formatAmount(amount: Yen): string {
  return (amount < 0 ? MINUS : "") + digits(amount);
}

/** 3桁区切りに ¥ を付ける。マイナスは −¥1,234 の形。 */
export function formatYen(amount: Yen): string {
  return (amount < 0 ? MINUS : "") + "¥" + digits(amount);
}

/** 符号を必ず付ける。増減を示す箇所に使う。 */
export function formatSigned(amount: Yen): string {
  return (amount < 0 ? MINUS : "+") + digits(amount);
}

/** 符号つきに ¥ を付ける。+¥1,234 / −¥1,234 の形 */
export function formatSignedYen(amount: Yen): string {
  return (amount < 0 ? MINUS : "+") + "¥" + digits(amount);
}

/** '2026-09-14' → '9/14' */
export function formatMonthDay(date: DateStr): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/**
 * '2026-09-14' → '2026年9月14日'
 *
 * 日付を取り違えさせたくない場面で使う。`formatMonthDay`（9/14）は
 * 年が落ちるので、**戻すための控えには使えない。**
 */
export function formatYearMonthDay(date: DateStr): string {
  return (
    `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月` +
    `${Number(date.slice(8, 10))}日`
  );
}

/**
 * '2026-10-18' → '10月18日'
 *
 * 年を落とすので、**戻すための控えには使わない**（formatYearMonthDay を使う）。
 * 画面の見出しと注記で使う（docs/design/screens.md 01）。
 */
export function formatMonthDayJa(date: DateStr): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/** '2026-09' → '2026年9月' */
export function formatYearMonthLabel(yearMonth: string): string {
  return `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5, 7))}月`;
}
