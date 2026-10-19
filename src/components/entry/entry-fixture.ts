/**
 * 実績入力の配線を試すための一式
 *
 * 口座・予定・実績はダッシュボードのフィクスチャを使う（§2.8）。
 * **候補が1件出るように、実績を1件足してある。** 照合の帯（Figma 2032:800）
 * は候補が無いと描かれないので、既定のフィクスチャだけでは確認できない。
 */

import { buildBalanceSeries } from "@/core/balance";
import { addDays } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import type { Actual, DateStr } from "@/core/types";
import { buildActualList, type ActualListView } from "@/lib/actual-list";
import { findCandidates } from "@/lib/reconcile";
import { forecastEnd } from "@/lib/period";
import { buildTodoList, type TodoRow } from "@/lib/todo-list";

import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";

export { FIXTURE_ACCOUNTS, FIXTURE_TODAY };

/** 要対応に出す予定の範囲。EntryScreen と同じ */
export const PENDING_LOOKAHEAD_DAYS = 7;

/**
 * 9/25 の売上入金と金額がぴったり同じ実績。
 *
 * `key` が null なので予定に紐づいておらず、金額が一致し日付も近いので
 * 照合の候補になる（FR-46）。CSV で取り込んだ直後の状態。
 */
const CSV_ACTUAL: Actual = {
  id: "ac-csv",
  key: null,
  name: "○○商会 振込入金",
  type: "income",
  costType: null,
  categoryCode: "INC-01",
  amount: 330_000,
  bizRatio: 100,
  accountId: "a1",
  date: "2026-09-30",
};

export const ENTRY_ACTUALS: Actual[] = [...FIXTURE_ACTUALS, CSV_ACTUAL];

export interface EntryFixture {
  todo: TodoRow[];
  candidateCount: number;
  list: ActualListView;
  actuals: Actual[];
}

/** 本番（EntryScreen）と同じ順で同じ関数を通す。 */
export function buildEntryFixture(today: DateStr = FIXTURE_TODAY): EntryFixture {
  const to = forecastEnd(FIXTURE_ASOF);
  const forecast = buildForecast(
    { recurring: FIXTURE_RECURRING, oneoffs: FIXTURE_ONEOFFS, overrides: {} },
    FIXTURE_ASOF,
    to,
  );
  const series = buildBalanceSeries(
    { accounts: FIXTURE_ACCOUNTS, asOf: FIXTURE_ASOF, forecast, actuals: ENTRY_ACTUALS },
    to,
    today,
  );
  const candidates = findCandidates({
    actuals: ENTRY_ACTUALS,
    unmatchedForecast: series.unmatchedForecast,
  });

  return {
    todo: buildTodoList({
      unmatchedForecast: series.unmatchedForecast,
      candidates,
      until: addDays(today, PENDING_LOOKAHEAD_DAYS),
    }),
    candidateCount: candidates.length,
    list: buildActualList({ actuals: ENTRY_ACTUALS, yearMonth: null }),
    actuals: ENTRY_ACTUALS,
  };
}

/** PageHeader 用。残高系列も同じ経路で作る */
export function buildEntrySeries(today: DateStr = FIXTURE_TODAY) {
  const to = forecastEnd(FIXTURE_ASOF);
  const forecast = buildForecast(
    { recurring: FIXTURE_RECURRING, oneoffs: FIXTURE_ONEOFFS, overrides: {} },
    FIXTURE_ASOF,
    to,
  );
  return buildBalanceSeries(
    { accounts: FIXTURE_ACCOUNTS, asOf: FIXTURE_ASOF, forecast, actuals: ENTRY_ACTUALS },
    to,
    today,
  );
}
