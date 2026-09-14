/**
 * 残高ヘッダー（SC-01）に出す数字
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-01
 *   現預金残高、30日後・90日後の予測、カード未払残高
 *
 * core の CL-1 と CL-3 を組み合わせるだけの薄い層。純関数。
 */

import { buildBalanceSeries } from "@/core/balance";
import { addDays } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import { isCard } from "@/core/types";
import type { DateStr, Yen } from "@/core/types";

import type { AppData } from "./app-data";

/** ヘッダーに並べる4つの数字。 */
export interface BalanceSummary {
  /** 現預金残高（今日時点）。実績が入っていればその値 */
  current: Yen;
  /** 30日後の予測残高 */
  in30: Yen;
  /** 90日後の予測残高 */
  in90: Yen;
  /** カードの未払残高の合計。カードが無ければ0 */
  cardDue: Yen;
}

const EMPTY: BalanceSummary = { current: 0, in30: 0, in90: 0, cardDue: 0 };

/**
 * 残高ヘッダーの数字を求める。
 *
 * 予測は90日先までで足りる。90日より後に起きるカード引落は、
 * 90日時点の残高を動かさない。
 */
export function computeBalanceSummary(
  data: AppData,
  today: DateStr,
): BalanceSummary {
  if (data.accounts.length === 0) return EMPTY;

  const in30 = addDays(today, 30);
  const in90 = addDays(today, 90);
  /* 基準日が未来にある場合でも行が作られるように、遅いほうを終端にする */
  const to = data.asOf > in90 ? data.asOf : in90;

  const forecast = buildForecast(
    {
      recurring: data.recurring,
      oneoffs: data.oneoffs,
      overrides: data.overrides,
    },
    data.asOf,
    to,
  );

  const series = buildBalanceSeries(
    {
      accounts: data.accounts,
      asOf: data.asOf,
      forecast,
      actuals: data.actuals,
    },
    to,
    today,
  );

  const rowAt = (date: DateStr) => series.rows.find((r) => r.date === date);
  const todayRow = rowAt(today);

  const cardIds = data.accounts.filter(isCard).map((c) => c.id);
  const cardDue = todayRow
    ? cardIds.reduce((sum, id) => sum + (todayRow.byCard[id] ?? 0), 0)
    : data.accounts.filter(isCard).reduce((sum, c) => sum + c.balance, 0);

  return {
    /* 実績が入っている範囲では実績残高、その先は予測 */
    current: todayRow ? (todayRow.act ?? todayRow.proj) : 0,
    in30: rowAt(in30)?.proj ?? todayRow?.proj ?? 0,
    in90: rowAt(in90)?.proj ?? todayRow?.proj ?? 0,
    cardDue,
  };
}
