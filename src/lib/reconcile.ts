/**
 * 消し込み候補の提示（FR-46）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-3「未消込の過去予定の扱い」、CL-7「予定との自動照合」
 * 対応する受入基準：AC-30、AC-38、AC-39
 *
 * CL-3 手順2 は `key` を持つ実績だけを消し込む。CSV取込の自動照合が外れた行や、
 * 「予定どおり」を使わずに手入力した行は `key` が null のまま残り、**同じ取引が
 * 予定と実績の両方で残高に乗る**。残高が低く出て、防衛ラインの警告が誤って鳴る。
 *
 * **自動では消し込まない。** 金額と日付が近いだけで同一取引と決めつけると、
 * 利用者が気づけない誤りが残高に混ざる。候補として見せ、利用者が確定した
 * ときだけ `key` を張る。
 *
 * **候補は全件出す（AC-39）。** CL-7 の「最初の1件」は自動確定のための規則で
 * あり、利用者に選ばせる場面では全件を並べるのが正しい。1件に絞ると、
 * 本当の相手が2件目だったときに選べない。
 *
 * **`unplanned` の実績は対象外（AC-38）。** `key` が null であることには
 * 「まだ判定していない」と「判定した結果、突発だった」が混ざっている。
 * 後者に候補を出し続けると、却下が機能していないように見える。
 */

import { MATCH_WINDOW_DAYS } from "@/core/csv";
import { daysBetween } from "@/core/date";
import type { Actual, ForecastInstance } from "@/core/types";

/** 1つの実績に対する候補の予定。 */
export interface Candidate {
  plan: ForecastInstance;
  /** 予定日と実績日の差（日数）。近いほど確からしい */
  dayGap: number;
}

/** 候補のある実績1件ぶん。 */
export interface CandidateGroup {
  actual: Actual;
  /** 候補の予定。日付の近い順、同じなら予定日の昇順 */
  plans: Candidate[];
}

export interface ReconcileInput {
  actuals: Actual[];
  /** CL-3 の出力。消し込まれずに残っている予定インスタンス */
  unmatchedForecast: ForecastInstance[];
}

/**
 * 実績1件が予定1件の候補になるか（FR-46）。
 *
 * CL-7 の自動照合と同じ4条件（金額完全一致・日付±12日以内・収支の向き一致・
 * 同一口座）。
 *
 * `unplanned` が立っている実績は、利用者が「どの予定でもない」と判定済みな
 * ので候補にしない。
 */
export function isCandidate(actual: Actual, plan: ForecastInstance): boolean {
  if (actual.key !== null) return false;
  if (actual.unplanned) return false;
  if (actual.amount !== plan.amount) return false;
  if (actual.type !== plan.type) return false;
  if (actual.accountId !== plan.accountId) return false;
  return daysBetween(plan.date, actual.date) <= MATCH_WINDOW_DAYS;
}

/**
 * 候補のある実績を集める。
 *
 * **1つの実績に対する候補を全件返す（AC-39）。** 1つの予定が複数の実績の
 * 候補になることもある。どれか1つを確定すればその予定は消し込まれ、次の
 * 計算で他方の候補から消える。先に取ったもの勝ちにする必要はない。
 *
 * 並びは実績の日付降順 → id。候補は日付の近い順 → 予定日の昇順。
 */
export function findCandidates({
  actuals,
  unmatchedForecast,
}: ReconcileInput): CandidateGroup[] {
  const ordered = [...actuals]
    .filter((a) => a.key === null && !a.unplanned)
    .sort((a, b) =>
      a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1,
    );

  const out: CandidateGroup[] = [];
  for (const actual of ordered) {
    const plans = unmatchedForecast
      .filter((plan) => isCandidate(actual, plan))
      .map((plan) => ({ plan, dayGap: daysBetween(plan.date, actual.date) }))
      .sort(
        (a, b) =>
          a.dayGap - b.dayGap ||
          (a.plan.date < b.plan.date ? -1 : a.plan.date > b.plan.date ? 1 : 0),
      );

    if (plans.length > 0) out.push({ actual, plans });
  }
  return out;
}
