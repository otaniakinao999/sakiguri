/**
 * 残高に含まれている「まだ記録されていない予定」（AC-49）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-3 手順3・手順4、§4.1 SC-01・SC-02
 *
 * 残高として表示するのは**予測系列だけ**である（CL-3 手順4）。予測系列は
 * 実績に加えて未消し込みの予定を予定額のまま含むので、表示している残高は
 * 「記録された分 ＋ まだ記録されていない予定額」になる。
 *
 * **その内訳を捨てない。** 実績系列との差は、かつてヘッダーと口座一覧が
 * 食い違う原因だった。同じ数字を、利用者が一番知りたい形で出す。
 *
 * > 現預金 見込み ¥297,590,377
 * > うち未記録の予定 +¥3,503,700（456件）
 *
 * 符号を出すのは方向が分かるようにするため。未消し込みが純支出なら残高を
 * 押し下げているので、消し込むと残高が上がる。
 *
 * **1箇所にしか書かない。** ヘッダー（SC-01）とダッシュボード（SC-02）の
 * 両方が使うが、両方で数え直すと片方だけずれる（CLAUDE.md §2.8）。
 */

import type { BalanceSeries } from "@/core/balance";
import { settleDateOf } from "@/core/cash";
import { isCard } from "@/core/types";
import type { Account, DateStr, ForecastInstance, Yen } from "@/core/types";

export interface Unrecorded {
  /**
   * 残高に含まれている、記録ではなく予定から来ている額。**符号つき。**
   * 正なら残高を押し上げている（未消し込みが純収入）。
   */
  amount: Yen;
  /**
   * その予定の件数。**表示しない（AC-49d）。**
   *
   * 「0件なら金額を出さない」の判定にだけ使う。金額は現金が動く日で
   * 数えるが、画面に出す件数は発生日で数える（「実績が未入力の予定」）。
   * 基準が違うので、金額の隣に並べると内訳に見えて値が食い違う。
   * **件数を出すのは画面上の1箇所だけ。**
   */
  count: number;
}

export const NONE: Unrecorded = { amount: 0, count: 0 };

/**
 * 予定インスタンスの現金が動く日（CL-2）。
 *
 * カード払いは引落日、それ以外は発生日。振替はカードでも付け替えなので
 * 発生日のまま（CL-2 が `type = transfer` を引落の集約から外している）。
 */
function cashDateOf(
  plan: ForecastInstance,
  byId: Map<string, Account>,
): DateStr {
  const account = byId.get(plan.accountId);
  if (!account || !isCard(account) || plan.type === "transfer") return plan.date;
  return settleDateOf(account, plan.date);
}

/**
 * 今日の残高のうち、未消し込みの予定から来ている額と件数。
 *
 * 金額は**予測系列と実績系列の差**そのものを使う。数え直すと、どちらかが
 * ずれたときに気づけない。カードの基準日未払は両方の系列に入るので相殺
 * され、差には残らない。
 *
 * 件数は、その差に効いている予定の数（現金が動く日が今日以前のもの）。
 * **予定日ではなく現金の日で数える。** 金額が現金ベースなので、予定日で
 * 数えるとカード払いのぶんだけ件数と金額の対象がずれる。
 */
export function unrecordedInBalance(
  series: BalanceSeries,
  accounts: Account[],
  today: DateStr,
): Unrecorded {
  const todayRow = series.rows.find((row) => row.date === today);
  if (!todayRow || todayRow.act === null) return NONE;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const count = series.unmatchedForecast.filter(
    (plan) => cashDateOf(plan, byId) <= today,
  ).length;

  return { amount: todayRow.proj - todayRow.act, count };
}
