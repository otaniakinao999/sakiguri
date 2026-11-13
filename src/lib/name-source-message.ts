/**
 * 摘要の差し替えの結果を1文にする（FR-62・AC-69）
 *
 * **件数を2つ出す。** 1つの数字にすると、どちらに寄せても嘘になる（§2.12）。
 *
 * | 出す数 | 起きること |
 * |---|---|
 * | 当たった件数（61） | **画面で変わった行は54なので、数字と画面が合わない** |
 * | 置き換えた件数（54） | **当たっている7行が、当たらなかったように見える** |
 *
 * **記帳代行では意味が違う。** 「当たらなかった」は**別のところを探せ**、
 * 「当たったが明細に名前が無い」は**探しても無い**である。区別が無いと、
 * 毎月その件数ぶん無駄に探すことになる。1件あたりの手数がそのまま原価に
 * なる業務なので、ここは効く。
 *
 * **文の組み立てはここだけに置く**（CLAUDE.md §2.8）。
 */

import type { NameSourceResult } from "@/core/name-source";

const NONE = "摘要を店名に置き換えた行はありません。";

/** 明細に店名が無かったぶんの説明。0件なら何も足さない */
function noNameNote(count: number): string {
  return count === 0
    ? ""
    : `${count}件は明細に店名が無いので番号のままです。`;
}

export function nameSourceMessage({
  replaced,
  noName,
}: Pick<NameSourceResult, "replaced" | "noName">): string {
  const head = replaced === 0 ? NONE : `${replaced}件の摘要を店名に置き換えました。`;
  return `${head}${noNameNote(noName)}`;
}
