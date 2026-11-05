import { planKeySource } from "@/core/forecast";
import type { Actual } from "@/core/types";

/**
 * 実績が登録済みの単発予定
 *
 * 単発の予定は実績が付けば終わる。**終わったものが表に残り続けると、
 * 項目が増えるほど、これから起きる予定が読めなくなる。**
 *
 * 判定は**実績の `key` から引く。** 予測（`unmatchedForecast`）に無いこと
 * では判定しない。予測は期間で切ってあるので、**基準日より前の単発予定は
 * そもそも展開されず、「済み」に倒れてしまう**（§9.1：測る側が通る方向に
 * 間違っている）。
 *
 * キーの形を読むのは `planKeySource` に任せる（CLAUDE.md §2.8。キーの
 * 形を知るのは `recurringKey` / `oneoffKey` / `planKeySource` の3つだけ）。
 *
 * **定期項目は対象にしない。** 毎月くり返すので、1回ぶんの実績が付いても
 * 終わらない。
 */
export function settledOneoffIds(actuals: readonly Actual[]): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const actual of actuals) {
    if (!actual.key) continue;
    const source = planKeySource(actual.key);
    if (source?.src === "oneoff") ids.add(source.id);
  }

  return ids;
}
