/**
 * 分類は予定が持ち、事実は実績が持つ
 *
 * 一次情報：docs/要件定義書.md §3.3 前書き
 * 対応する受入基準：AC-45（CL-7 の自動照合）、AC-46（FR-46 の候補確定）
 *
 * 予定と実績を結びつけるとき、どちらの値を採るかはこの線で決める。
 *
 * | 項目 | 出どころ |
 * |---|---|
 * | 費目・固定変動区分・事業割合 | **予定** |
 * | 日付・金額・口座 | **実績** |
 *
 * 分類は予定を登録した時点で利用者が落ち着いて決めている。実績側の値は
 * 機械の推定か、入力時のその場の判断である。日付と金額は実際に起きた
 * ことなので実績を採る（120,000 の予定に 118,000 の実績が付いてよい）。
 *
 * **経路で結果を変えない。** CSV取込の自動照合（CL-7）、「予定どおり」の
 * 消し込み（FR-06）、照合候補の確定（FR-46）は、どちらが先に存在したか
 * だけが違う同じ操作である。ここを1つの関数にしておくことで、経路ごとに
 * 書き分ける余地を作らない（CLAUDE.md §2.8）。
 */

import type { CostType } from "./types";

/** 予定から引き継ぐ3項目。 */
export interface Classification {
  categoryCode: string;
  costType: CostType | null;
  bizRatio: number;
}

export type ClassificationField = keyof Classification;

/** 引き継ぎで値が変わる項目。変わらなければ空。 */
export function classificationChanges(
  actual: Classification,
  plan: Classification,
): ClassificationField[] {
  const fields: ClassificationField[] = ["categoryCode", "costType", "bizRatio"];
  return fields.filter((field) => actual[field] !== plan[field]);
}

/**
 * 実績に予定の分類を当てる。**日付・金額・口座には触れない。**
 *
 * 型引数で元のオブジェクトの形を保つので、`id` や `key` を落とさない。
 */
export function applyClassification<T extends Classification>(
  actual: T,
  plan: Classification,
): T {
  return {
    ...actual,
    categoryCode: plan.categoryCode,
    costType: plan.costType,
    bizRatio: plan.bizRatio,
  };
}
