/**
 * ダッシュボードの配線を試すための一式
 *
 * **本番の画面は Supabase に繋がないと開けない。** だから「props を作る
 * ところ」を目視でしか確かめられない状態になりがちで、実際に
 * DashboardView を組んだ時点では固定値しか通していなかった。
 *
 * ここに置いた一式は、**本番と同じ経路**を通る：
 *   buildForecast → buildBalanceSeries → buildDashboard
 *   → buildReconcileWarnings → buildDashboardViewModel
 * 検査（`__tests__/dashboard-view-model.test.ts`）と画面の確認
 * （/dev/screens/dashboard-wired）が同じ一式を使う。
 *
 * 数字は docs/design/screens.md 01 に寄せてあるが、**Figma と同じ絵には
 * ならない。** 予測は計算で出るものなので、ここで決めるのは入力だけ。
 * Figma と見比べるのは /dev/screens/dashboard のほう。
 */

import { buildBalanceSeries, type BalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import type {
  Account,
  Actual,
  CardAccount,
  DateStr,
  DepositAccount,
  OneoffItem,
  RecurringItem,
  Yen,
} from "@/core/types";
import { buildDashboard, type Dashboard } from "@/lib/dashboard";
import { buildReconcileWarnings, type ReconcileWarnings } from "@/lib/reconcile-warnings";
import { forecastEnd } from "@/lib/period";

export const FIXTURE_ASOF: DateStr = "2026-09-01";
export const FIXTURE_TODAY: DateStr = "2026-10-18";
export const FIXTURE_RESERVE_LINE: Yen = 1_500_000;

const cash: DepositAccount = { id: "a0", name: "現金", kind: "cash", balance: 52_000 };
const bank: DepositAccount = {
  id: "a1",
  name: "○○銀行 普通",
  kind: "bank",
  balance: 2_145_300,
};
const shinkin: DepositAccount = {
  id: "a2",
  name: "△△信金 普通",
  kind: "bank",
  balance: 650_000,
};
const card: CardAccount = {
  id: "c1",
  name: "××カード",
  kind: "card",
  balance: 186_200,
  closingDay: 15,
  payMonthOffset: 1,
  payDay: 10,
  settleAccountId: "a1",
};

export const FIXTURE_ACCOUNTS: Account[] = [cash, bank, shinkin, card];

export const FIXTURE_RECURRING: RecurringItem[] = [
  {
    id: "r1",
    name: "○○商会 売上入金",
    type: "income",
    costType: null,
    categoryCode: "INC-01",
    amount: 330_000,
    bizRatio: 100,
    accountId: "a1",
    day: 25,
    months: null,
    active: true,
  },
  {
    id: "r2",
    name: "事務所家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 95_000,
    bizRatio: 100,
    accountId: "a1",
    day: 27,
    months: null,
    active: true,
  },
  {
    id: "r3",
    name: "通信費",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-03",
    amount: 9_800,
    bizRatio: 80,
    accountId: "a1",
    day: 1,
    months: null,
    active: true,
  },
  {
    id: "r4",
    name: "外注費",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-09",
    amount: 140_000,
    bizRatio: 100,
    accountId: "a1",
    day: 5,
    months: null,
    active: true,
  },
  /* カードに乗る費用。これが無いと引落が立たず「次回引落 —」になる */
  {
    id: "r5",
    name: "サブスク",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-19",
    amount: 12_000,
    bizRatio: 50,
    accountId: "c1",
    day: 8,
    months: null,
    active: true,
  },
];

/** 12/10 の納税。これで90日以内に生活防衛ラインを割る */
export const FIXTURE_ONEOFFS: OneoffItem[] = [
  {
    id: "o1",
    name: "税金の納付",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-28",
    amount: 1_600_000,
    bizRatio: 0,
    accountId: "a1",
    date: "2026-12-10",
  },
];

/**
 * 実績。**わざと少なくしてある。**
 *
 * 9月分だけ消し込んで10月は手つかず、という状態を作る。こうすると
 * 「実線が今日より前で終わり、そこから破線」になり、消し込みが遅れた
 * ときの見え方が確認できる。今日で切る実装だとこの区間が実績に見える。
 */
export const FIXTURE_ACTUALS: Actual[] = [
  {
    id: "ac1",
    key: null,
    unplanned: true,
    name: "備品",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-09",
    amount: 18_000,
    bizRatio: 100,
    accountId: "a1",
    date: "2026-09-24",
  },
];

export interface FixtureModel {
  series: BalanceSeries;
  dashboard: Dashboard;
  reconcile: ReconcileWarnings;
}

/** 本番（DashboardScreen）と同じ順で同じ関数を通す。 */
export function buildFixtureModel(today: DateStr = FIXTURE_TODAY): FixtureModel {
  const to = forecastEnd(FIXTURE_ASOF);
  const forecast = buildForecast(
    { recurring: FIXTURE_RECURRING, oneoffs: FIXTURE_ONEOFFS, overrides: {} },
    FIXTURE_ASOF,
    to,
  );
  const series = buildBalanceSeries(
    {
      accounts: FIXTURE_ACCOUNTS,
      asOf: FIXTURE_ASOF,
      forecast,
      actuals: FIXTURE_ACTUALS,
    },
    to,
    today,
  );
  return {
    series,
    dashboard: buildDashboard({
      series,
      accounts: FIXTURE_ACCOUNTS,
      reserveLine: FIXTURE_RESERVE_LINE,
      today,
    }),
    reconcile: buildReconcileWarnings({
      /* 一度も消し込んでいない。AC-29c のもう一方の文面が出る */
      lastReconciledAt: null,
      asOf: FIXTURE_ASOF,
      unmatchedForecast: series.unmatchedForecast,
      accountCount: FIXTURE_ACCOUNTS.length,
      today,
    }),
  };
}
