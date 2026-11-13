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

import {
  cardIdsOf,
  depositIdsOf,
  viewDelta,
  type BalanceSeries,
} from "@/core/balance";
import { settleDateOf } from "@/core/cash";
import { isCard } from "@/core/types";
import type { Account, DateStr, ForecastInstance, Yen } from "@/core/types";

/**
 * この値を画面に出すときの語（AC-49e）。
 *
 * **3箇所で同じ値を出す。** ヘッダー（SC-01）、ダッシュボード（SC-02）、
 * 残高推移グラフのツールチップ（SC-03）。
 *
 * 文字列をそれぞれに書くと、**片方だけ言い回しが変わる。** 実際、
 * ダッシュボードだけ「まだ記録されていない予定」になっていて、
 * マニュアルの「うち未記録の予定」を探しても見つからない状態だった。
 *
 * 同じ値には同じ名前を付ける（要件定義書 §3.3・AC-49e、CLAUDE.md §2.12）。
 */
export const UNRECORDED_LABEL = "うち未記録の予定";

/**
 * 「未記録」に入る日の境界。**今日は入る**（AC-72）。
 *
 * 金額は今日の行の `proj − act` なので、**今日の予定は既に今日の残高に
 * 効いている。** 一覧だけが `< today` だと、金額から飛んだ先にその予定が
 * 無く、合計が合わない（2026-11-13 の報告）。
 *
 * **境界はここにしか書かない。** 金額・件数・一覧の3箇所に同じ条件を
 * 書いていて、一覧だけが `<` のまま残ったのがこの欠陥である
 * （CLAUDE.md §2.8・§2.12）。
 *
 * **どの日付を渡すかは呼び出し側が決める。** 金額と件数は現金が動く日
 * （`cashDateOf`）、一覧は発生日（`plan.date`）である。**この差は意図した
 * ものである** ―― 要件定義書 §3.3 が「発生日は過ぎたが引落日が未来の
 * カード利用は、件数には入るが金額には入らない。これは仕様である」と
 * 定めている（AC-49d は一覧の件数を発生日で数えることを要求している）。
 * **したがって一覧の合計と金額は、そのカード利用のぶんだけ食い違う。**
 * **一致させない**（AC-72b。2026-11-13 に条項の側を直した） ―― 一覧を
 * 現金日に倒すと、引落が未来のカード利用が一覧から消え、それは消し込む
 * 対象そのものである。**代わりに差を画面で説明する**（`awaiting`）。
 */
export function isUnrecordedOn(date: DateStr, today: DateStr): boolean {
  return date <= today;
}

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
  /**
   * **引落が未来のカード利用**（AC-72b）。一覧には出るが `amount` には
   * 入っていないぶん。**符号は一覧の行と同じ**（費用なら負）。
   *
   * 「うち未記録の予定」と、飛んだ先の一覧の合計は**このぶんだけ食い違う。**
   * 一致させずに、差の理由と額を画面に出す ―― 足し算が合わない理由が
   * その場で読めないと、利用者はどちらが正しいか判断できない。
   *
   * 0件なら `{ amount: 0, count: 0 }`。
   */
  awaiting: { amount: Yen; count: number };
}

export const NONE: Unrecorded = {
  amount: 0,
  count: 0,
  awaiting: { amount: 0, count: 0 },
};

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
 * **その予定の引落日。ただし未来のときだけ**（AC-72b）。今日以前なら null。
 *
 * この日が未来の行は、**一覧には出るが「うち未記録の予定」の金額には
 * 入っていない。** 差の原因そのものなので、行にこの日を添える。
 *
 * **判定は `cashDateOf` を借りる**（§2.8）。金額が何を見ているかと、
 * 行に何を出すかを別々に書くと、片方だけ直したときに**差の説明が
 * 差と合わなくなる。**
 */
export function awaitingSettlementOn(
  plan: ForecastInstance,
  accounts: readonly Account[] | ReadonlyMap<string, Account>,
  today: DateStr,
): DateStr | null {
  const byId =
    accounts instanceof Map
      ? (accounts as Map<string, Account>)
      : new Map((accounts as readonly Account[]).map((a) => [a.id, a]));
  const date = cashDateOf(plan, byId);
  return date > today ? date : null;
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
  const count = series.unmatchedForecast.filter((plan) =>
    isUnrecordedOn(cashDateOf(plan, byId), today),
  ).length;

  /* **一覧には出るが金額には入っていないぶん**（AC-72b）。発生日は今日
     以前（＝一覧に出る）で、現金が動く日が未来のもの。

     **符号は一覧の行と同じ引き方にする**（`viewDelta`。AC-58b）。
     ここで `amount` に符号を付け直すと、画面の行と注記で別々の規則が
     動く（§2.8） */
  const deposits = new Set(depositIdsOf(series));
  const viewed = [...depositIdsOf(series), ...cardIdsOf(series)];
  const waiting = series.unmatchedForecast.filter(
    (plan) =>
      isUnrecordedOn(plan.date, today) &&
      awaitingSettlementOn(plan, byId, today) !== null,
  );

  return {
    amount: todayRow.proj - todayRow.act,
    count,
    awaiting: {
      amount: waiting.reduce(
        (sum, plan) => sum + viewDelta(plan, viewed, deposits),
        0,
      ),
      count: waiting.length,
    },
  };
}
