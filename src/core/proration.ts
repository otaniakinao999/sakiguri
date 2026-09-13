/**
 * CL-4 家事按分の適用
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-4
 * 対応する機能要件：FR-10
 * 対応する受入基準：AC-05
 *
 * **損益集計時にのみ適用する。** 資金繰りには適用しない（現金は全額動くため）。
 */

import type { Yen } from "./types";

/**
 * 集計のビュー。
 *
 * - `all`       合算。amount の全額
 * - `business`  事業。amount × bizRatio ÷ 100
 * - `household` 家計。合算から事業分を差し引いた残り
 */
export type Scope = "all" | "business" | "household";

/** 0〜100 に収める。 */
function clampRatio(bizRatio: number): number {
  if (!Number.isFinite(bizRatio)) {
    throw new RangeError(`事業割合が数値ではありません: ${bizRatio}`);
  }
  return Math.min(100, Math.max(0, bizRatio));
}

/**
 * 事業ぶんの計上額。`amount × bizRatio ÷ 100` を円未満で丸める。
 *
 * 丸めは計算の各段で行う（CLAUDE.md §2.1）。
 */
export function businessShare(amount: Yen, bizRatio: number): Yen {
  return Math.round((amount * clampRatio(bizRatio)) / 100);
}

/**
 * 家計ぶんの計上額。
 *
 * **要件定義書 CL-4 の表は `amount × (100 − bizRatio) ÷ 100` と書いているが、
 * ここでは `amount − 事業ぶん` として求める。** 詳細は
 * docs/adr/0010-家事按分の家計ぶんを残差で求める.md
 *
 * 表のとおり両側を独立に丸めると、事業ぶんと家計ぶんの合計が合算ビューと
 * 一致しないことがある。たとえば 10,001円・事業割合50% では、両側とも
 * 5,001円に丸められて合計が 10,002円になる。同じデータを3つのビューで
 * 見せる画面で、1円合わないほうが問題が大きい。
 */
export function householdShare(amount: Yen, bizRatio: number): Yen {
  return amount - businessShare(amount, bizRatio);
}

/**
 * CL-4 家事按分。ビューに応じた計上額を返す。
 *
 * 資金繰り（CL-2・CL-3・CL-6）ではこの関数を呼ばない。現金は全額動く。
 */
export function share(amount: Yen, bizRatio: number, scope: Scope): Yen {
  switch (scope) {
    case "all":
      return amount;
    case "business":
      return businessShare(amount, bizRatio);
    case "household":
      return householdShare(amount, bizRatio);
  }
}
