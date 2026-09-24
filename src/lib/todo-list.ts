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
 */

import { compareDate, compareString } from "@/core/date";
import type { Actual, DateStr, ForecastInstance } from "@/core/types";

import type { Candidate, CandidateGroup } from "./reconcile";

/** 消し込み待ちの予定。実績がまだ無い */
export interface TodoPlanRow {
  kind: "plan";
  /** 並べ替えと表示に使う日付。予定日 */
  date: DateStr;
  /** 行を一意に指す。React の key と開閉の管理に使う */
  rowKey: string;
  plan: ForecastInstance;
}

/** 照合候補のある実績。実績はあるが紐づいていない（FR-46） */
export interface TodoCandidateRow {
  kind: "candidate";
  /** 並べ替えに使う日付。**最も近い候補の予定日**（実績日ではない） */
  date: DateStr;
  rowKey: string;
  actual: Actual;
  /** 候補の予定。全件（AC-39） */
  plans: Candidate[];
}

export type TodoRow = TodoPlanRow | TodoCandidateRow;

/**
 * 要対応リストの既定の表示件数（B-2）。
 *
 * 古いものから20件だけ出し、残りは「すべて表示」で開く。基準日から時間が
 * 経つほど未消し込みは単調に増えるため、全件を常に描くと画面が埋まる。
 * 古い順に出すのは、放置が長いものほど残高への影響が確定しているため。
 */
export const TODO_PREVIEW_COUNT = 20;

export interface TodoListInput {
  /** CL-3 の出力。消し込まれずに残っている予定インスタンス */
  unmatchedForecast: ForecastInstance[];
  /** FR-46 の候補。`unplanned` の実績は除かれている */
  candidates: CandidateGroup[];
  /** これより後の予定は出さない。直近ぶんに絞るため */
  until: DateStr;
}

/**
 * 要対応リストを組み立てる。
 *
 * 候補に挙がっている予定は `plan` 行として出さない。同じ予定を「消し込み
 * 待ち」と「候補あり」の2箇所で見せると、1つの課題が2件に見える。
 *
 * `candidate` 行は日付で絞らない。**候補が見つかっている＝残高がいま
 * 間違っている**ので、予定日が先でも片付ける対象である。
 */
export function buildTodoList({
  unmatchedForecast,
  candidates,
  until,
}: TodoListInput): TodoRow[] {
  const claimed = new Set(
    candidates.flatMap((g) => g.plans.map((c) => c.plan.key)),
  );

  const plans: TodoRow[] = unmatchedForecast
    .filter((plan) => !claimed.has(plan.key) && plan.date <= until)
    .map((plan) => ({
      kind: "plan",
      date: plan.date,
      rowKey: `p:${plan.key}`,
      plan,
    }));

  const groups: TodoRow[] = candidates.map(({ actual, plans: found }) => ({
    kind: "candidate",
    /* 最も近い候補の予定日で並べる。候補は日付の近い順に並んでいる */
    date: found.reduce(
      (earliest, c) => (c.plan.date < earliest ? c.plan.date : earliest),
      found[0].plan.date,
    ),
    rowKey: `a:${actual.id}`,
    actual,
    plans: found,
  }));

  return [...plans, ...groups].sort(
    (a, b) => compareDate(a.date, b.date) || compareString(a.rowKey, b.rowKey),
  );
}
