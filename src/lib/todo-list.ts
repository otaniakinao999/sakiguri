/**
 * 実績入力画面の「要対応」リスト（SC-05、AC-37）
 *
 * 一次情報：docs/要件定義書.md §4.1.1 SC-05 実績入力の構成
 *
 * この画面には、消し込みが済んでいないことを意味する状態が2種類ある。
 *
 * | 行の種類 | 意味 |
 * |---|---|
 * | `plan`      | 予定はあるが実績が未入力 |
 * | `candidate` | 実績はあるが `key` が null で、候補の予定がある（FR-46） |
 *
 * **2つを別々のリストにしない。** どちらも「残高が正しくない状態」を指して
 * おり、利用者の課題は同じ（消し込みを終わらせる）である。分けると、片方を
 * 全部処理したのに残高が直らない理由が分からなくなる。
 *
 * 1つのリストに行の種類として混在させ、**予定日の昇順**で並べる。
 * 並びの基準を予定日に揃えるのは、`candidate` 行でも「どの予定が消えずに
 * 残っているか」が利用者の関心だからである。
 */

import type { Actual, DateStr, ForecastInstance } from "@/core/types";
import { compareDate, compareString } from "@/core/date";

import type { DoubleCount } from "./reconcile";

/** 消し込み待ちの予定。実績がまだ無い */
export interface TodoPlanRow {
  kind: "plan";
  /** 並べ替えと表示に使う日付。予定日 */
  date: DateStr;
  plan: ForecastInstance;
}

/** 照合候補のある実績。実績はあるが紐づいていない（FR-46） */
export interface TodoCandidateRow {
  kind: "candidate";
  /** 並べ替えに使う日付。**予定日**（実績日ではない） */
  date: DateStr;
  plan: ForecastInstance;
  actual: Actual;
  /** 予定日と実績日の差 */
  dayGap: number;
}

export type TodoRow = TodoPlanRow | TodoCandidateRow;

export interface TodoListInput {
  /** CL-3 の出力。消し込まれずに残っている予定インスタンス */
  unmatchedForecast: ForecastInstance[];
  /** FR-46 の候補 */
  doubleCounts: DoubleCount[];
  /** これより後の予定は出さない。直近ぶんに絞るため */
  until: DateStr;
}

/**
 * 要対応リストを組み立てる。
 *
 * 候補のある予定は `candidate` 行としてだけ出す。同じ予定を
 * 「消し込み待ち」と「候補あり」の2行で見せると、1つの課題が2件に見える。
 *
 * `candidate` 行は日付で絞らない。**候補が見つかっている＝残高がいま
 * 間違っている**ので、予定日が先でも片付ける対象である。
 */
export function buildTodoList({
  unmatchedForecast,
  doubleCounts,
  until,
}: TodoListInput): TodoRow[] {
  const claimed = new Set(doubleCounts.map((c) => c.plan.key));

  const plans: TodoRow[] = unmatchedForecast
    .filter((plan) => !claimed.has(plan.key) && plan.date <= until)
    .map((plan) => ({ kind: "plan", date: plan.date, plan }));

  const candidates: TodoRow[] = doubleCounts.map(({ plan, actual, dayGap }) => ({
    kind: "candidate",
    date: plan.date,
    plan,
    actual,
    dayGap,
  }));

  return [...plans, ...candidates].sort(
    (a, b) =>
      compareDate(a.date, b.date) ||
      compareString(a.plan.name, b.plan.name) ||
      compareString(a.plan.key, b.plan.key),
  );
}
