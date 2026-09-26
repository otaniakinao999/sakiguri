/**
 * 分類を予定から引き継いだことの知らせ（AC-46）
 *
 * 一次情報：docs/要件定義書.md §3.3 前書き、§9 AC-46
 *
 * **黙って上書きしない。** 「この予定と同じ取引」を押すことは「これはあの
 * 予定の項目だ」という宣言なので分類を引き継ぐのが正しいが、利用者が
 * 入力時に選んだ費目が変わることには変わりない。何が変わったかを画面に
 * 出し、実績の編集から直せるようにする（`unplanned` と同じ扱い）。
 */

import { categoryOf } from "@/core/categories";
import type {
  Classification,
  ClassificationField,
} from "@/core/classification";
import type { CostType } from "@/core/types";

const COST_TYPE_LABEL: Record<CostType, string> = {
  fixed: "固定費",
  variable: "変動費",
};

/**
 * 引き継ぎで変わった項目を文にする。変わっていなければ null。
 *
 * 変わらなかった項目は並べない。3項目のうち1つだけ変わったときに
 * 3つとも読ませると、どれが変わったのか分からなくなる。
 */
export function describeInheritance(
  planName: string,
  plan: Classification,
  changes: readonly ClassificationField[],
): string | null {
  if (changes.length === 0) return null;

  const parts = changes.map((field) => {
    switch (field) {
      case "categoryCode":
        return `費目を「${categoryOf(plan.categoryCode).name}」`;
      case "costType":
        return plan.costType === null
          ? "固定/変動の区分をなし"
          : `固定/変動を「${COST_TYPE_LABEL[plan.costType]}」`;
      case "bizRatio":
        return `事業割合を ${plan.bizRatio}%`;
    }
  });

  return `「${planName}」に合わせて、${parts.join("、")}に変えました。実績の編集から直せます。`;
}
