/**
 * 消し込みの停止・取り残しの警告（FR-43）
 *
 * 一次情報：docs/要件定義書.md §3.1 FR-43、§3.2 Settings
 * 対応する受入基準：AC-29a、AC-29b
 *
 * **2つは別の警告である。** 意味も、利用者が取るべき行動も違う。
 *
 * | 警告 | 意味 | 取るべき行動 |
 * |---|---|---|
 * | `stalled`  | 消し込みが止まっている。予測が予定額に依存しきっている | まとめて消し込む／CSVを取り込む |
 * | `stranded` | 取り残された予定がある | 個別に処理する |
 *
 * 閾値は BS-2 の「CSV取込は月1〜2回」から置いた机上の値である。実利用の
 * 消し込み間隔を見て調整する（OI-20）。
 */

import { daysBetween } from "@/core/date";
import type { DateStr, ForecastInstance } from "@/core/types";

/**
 * 「消し込みが止まっている」と判定する日数。
 *
 * **月次の周期より十分に長く取る。** 毎月5日に消し込む利用者の間隔は
 * 最大31日（1/5 → 2/5）になるため、30日にするとその人が毎月1〜2日だけ
 * 警告を受ける。無視される警告になり、残高警告本体の信頼も落とす。
 * 45日は31日を余裕を持って超え、1周期飛ばした人（62日）より手前で鳴る。
 */
export const STALLED_DAYS = 45;

/** 「取り残された」と判定する、予定日からの経過日数。 */
export const STRANDED_DAYS = 60;

export interface ReconcileWarningsInput {
  /** 最後に消し込み操作を行った日。null は未実施 */
  lastReconciledAt: DateStr | null;
  /** 基準日。`lastReconciledAt` が null のときの起点 */
  asOf: DateStr;
  /** CL-3 の出力。消し込まれずに残っている予定インスタンス */
  unmatchedForecast: ForecastInstance[];
  today: DateStr;
}

export interface ReconcileWarnings {
  /**
   * 消し込みが止まっている。null なら警告なし。
   *
   * `neverReconciled` は「一度も消し込んでいない」。**文面を分けるために
   * 持つ（AC-29c）。** 止まっているのではなく、まだ始まっていない。
   * 一度も消し込んでいない利用者に「○日止まっています」と出すのは誤りで、
   * 設定だけして放置した新規利用者がまさにこの状態になる。
   */
  stalled: {
    sinceDays: number;
    from: DateStr;
    neverReconciled: boolean;
  } | null;
  /** 取り残された予定がある。null なら警告なし */
  stranded: { count: number; oldest: DateStr } | null;
}

/**
 * 2つの警告を判定する。
 *
 * `lastReconciledAt` が null のときの起点は**基準日**である。null を
 * 「とても古い」と扱うと新規利用者が初日から警告を受ける。基準日から45日
 * 経って一度も消し込んでいないなら「設定して放置した」状態なので鳴るのが
 * 正しく、初日は0日経過なので鳴らない（AC-29a）。
 *
 * 取り残しは**予定日が到来しているものだけ**を数える。未到来の予定は
 * 消し込みようがない（AC-29b）。`unplanned` の実績はそもそも予定ではない
 * ため、ここには現れない。
 */
export function buildReconcileWarnings({
  lastReconciledAt,
  asOf,
  unmatchedForecast,
  today,
}: ReconcileWarningsInput): ReconcileWarnings {
  const from = lastReconciledAt ?? asOf;
  /* 起点が未来（基準日を先に置いた）なら経過0として扱う */
  const sinceDays = from > today ? 0 : daysBetween(from, today);

  const stranded = unmatchedForecast
    .filter((plan) => plan.date < today && daysBetween(plan.date, today) >= STRANDED_DAYS)
    .map((plan) => plan.date)
    .sort();

  return {
    stalled:
      sinceDays >= STALLED_DAYS
        ? { sinceDays, from, neverReconciled: lastReconciledAt === null }
        : null,
    stranded:
      stranded.length > 0
        ? { count: stranded.length, oldest: stranded[0] }
        : null,
  };
}
