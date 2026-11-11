/**
 * 一覧に出す金額の、符号と色（AC-58b）
 *
 * 一次情報：docs/要件定義書.md §3.3「全体に効く原則」
 *
 * **符号と色は別の軸である。**
 *
 * | | 何が決めるか |
 * |---|---|
 * | 符号 | その行が**いま見ている範囲で残高をどちら向きに動かすか**（`viewDelta`） |
 * | 色 | 費目（費用は赤、収入は teal、振替は既定色） |
 *
 * **ここが唯一の判定である。** もとは「振替だから符号なし」を `type` で
 * 決めていて、同じ規則が3箇所（キャッシュフロー・ダッシュボード・実績入力）に
 * 散っていた。`type` で決めると**両側の明細から記録した振替**（適用規則5a）で
 * 破れる ―― 片側だけ記録した振替は `type = transfer` ではないのに一方向に
 * 残高を動かすので、符号を落とすと**隣の残高列と食い違う。** 実績の一覧でも
 * 出金の振替と入金の振替が同じ見た目になる（CLAUDE.md §2.8・§2.12）。
 */

import type { Yen } from "@/core/types";
import type { AmountType } from "./Amount";
import type { Category } from "./CategoryTag";

export interface AmountView {
  /** `Amount` の `value`。符号を付けるときは符号付きの額が入る */
  value: Yen;
  /** `Amount` の `signed`。false なら符号を付けない */
  signed: boolean;
  /** `Amount` の `type`。色だけを決める */
  type: AmountType;
}

export interface AmountViewInput {
  /** 行の金額（正の額）。符号を付けないときはこちらを出す */
  amount: Yen;
  /**
   * いま見ている範囲で残高を動かす額（`core/balance` の `viewDelta`）。
   *
   * **0 は「動かさない」である** ―― 合計の中で閉じる振替と、残高に
   * 反映していない振替（`oneSided`）。どちらも符号を付けない。
   */
  delta: Yen;
  /** 色を決める区分。`categoryTagFor` が返すもの */
  category: Category | null;
}

/**
 * 色。**費目が決める。** 符号を付けても費用の色にはしない。
 *
 * `type === "transfer"` も振替に寄せる ―― 費目が TRF でない振替の行
 * （古いデータ）を赤くしないため。
 */
function toneOf(input: { category: Category | null; type?: string }): AmountType {
  if (input.category === "振替" || input.type === "transfer") return "neutral";
  if (input.category === "収入") return "income";
  return "expense";
}

export function amountView(input: AmountViewInput & { type?: string }): AmountView {
  const type = toneOf(input);
  /* **動かさない行は符号を付けない。** 金額そのものは出す ―― 額のある行で
     残高が動かない理由は、明細の備考が言う（`lib/ledger` の `oneSided`） */
  if (input.delta === 0) return { value: input.amount, signed: false, type };
  return { value: input.delta, signed: true, type };
}
