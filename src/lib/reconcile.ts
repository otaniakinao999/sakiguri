/**
 * 二重計上の候補提示（FR-46）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-3「未消込の過去予定の扱い」、CL-7「予定との自動照合」
 * 対応する受入基準：AC-30
 *
 * CL-3 手順2 は `key` を持つ実績だけを消し込む。CSV取込の自動照合が外れた行や、
 * 「予定どおり」を使わずに手入力した行は `key` が null のまま残り、**同じ取引が
 * 予定と実績の両方で残高に乗る**。実測では 120,000 の予定と 118,000 の実績が
 * 両方引かれ、残高が 238,000 低く出る。
 *
 * 残高が低く出ると生活防衛ラインの警告が誤って鳴る。PoC で測る指標は
 * 「残高警告からの操作率」なので、この状態では指標そのものが測れない。
 *
 * **自動では消し込まない。** 金額と日付が近いだけで同一取引と決めつけると、
 * 利用者が気づけない誤りが残高に混ざる。候補として見せ、利用者が確定した
 * ときだけ `key` を張る。確定するまでは二重計上のまま残す（そのほうが
 * 残高を楽観視しないため安全側）。
 *
 * 一定期間で自動スキップする案は OI-4 の検討対象。v1.0 では行わない。
 */

import { MATCH_WINDOW_DAYS } from "@/core/csv";
import { daysBetween } from "@/core/date";
import type { Actual, ForecastInstance } from "@/core/types";

/** 二重計上のおそれがある1組。 */
export interface DoubleCount {
  /** `key` を持たない実績 */
  actual: Actual;
  /** 同一取引かもしれない未消込の予定 */
  plan: ForecastInstance;
  /** 予定日と実績日の差（日数）。近いほど確からしい */
  dayGap: number;
}

export interface ReconcileInput {
  actuals: Actual[];
  /** CL-3 の出力。消し込まれずに残っている予定インスタンス */
  unmatchedForecast: ForecastInstance[];
}

/**
 * 実績1件が予定1件の候補になるか（FR-46）。
 *
 * CL-7 の自動照合と同じ条件に**同一口座**を足したもの。
 * CL-7 は取込時に1つの口座を選ばせる前提なので口座を見ていないが、
 * ここは登録済みの実績すべてを相手にするため口座で絞らないと、
 * 生活口座の 10,000 と事業口座の 10,000 が入れ替わって当たる。
 *
 * 収支の向きは CL-7 と同じく一致を要求する。これを外すと、同額の
 * 入金と出金が当たってしまう。
 */
export function isDoubleCountCandidate(
  actual: Actual,
  plan: ForecastInstance,
): boolean {
  if (actual.key !== null) return false;
  if (actual.amount !== plan.amount) return false;
  if (actual.type !== plan.type) return false;
  if (actual.accountId !== plan.accountId) return false;
  return daysBetween(plan.date, actual.date) <= MATCH_WINDOW_DAYS;
}

/**
 * 二重計上のおそれがある組を集める。
 *
 * **1つの予定に当たる実績は1件まで。** 同じ予定に2つの実績を紐づけると
 * 消し込みの対応が崩れる（CL-7 の `matchPlan` と同じ制約）。
 *
 * 並びは実績の日付降順 → id。同じ入力なら同じ順序で返る。
 */
export function findDoubleCounts({
  actuals,
  unmatchedForecast,
}: ReconcileInput): DoubleCount[] {
  const claimed = new Set<string>();
  const out: DoubleCount[] = [];

  const ordered = [...actuals]
    .filter((a) => a.key === null)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1));

  for (const actual of ordered) {
    const plan = unmatchedForecast.find(
      (p) => !claimed.has(p.key) && isDoubleCountCandidate(actual, p),
    );
    if (!plan) continue;
    claimed.add(plan.key);
    out.push({ actual, plan, dayGap: daysBetween(plan.date, actual.date) });
  }

  return out;
}
