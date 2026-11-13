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
  /* **予定の側の資金移動**（`type = transfer`）。向き（FR-63・AC-70）が
     「やること」と「ダッシュボードの要対応」にも出ることを画面で見る
     ために入れてある。**実績だけだと、予定の行には1件も無い** ――
     行が0件の条項は必ず通る（CLAUDE.md §2.11 の3つ目の形）。

     **単発にしてある。** 定期項目にすると24ヶ月ぶんの予定が立ち、
     件数を見ているほかの条項の母数が動く。 */
  {
    id: "o2",
    name: "△△信金へ資金移動",
    type: "transfer",
    costType: null,
    categoryCode: "TRF-01",
    amount: 200_000,
    bizRatio: 0,
    accountId: "a1",
    toAccountId: "a2",
    /* **基準日（10/18）より前にしてある。** ダッシュボードの要対応は
       「実績が未入力の過去の予定」なので、未来の日付だとそちらに
       出てこない（`lib/dashboard` の `unfilled`） */
    date: "2026-10-15",
  },
  /* **今日（10/18）の予定**（AC-72）。

     これを入れるまで、今日付の予定は**1件も無かった。** 一覧の境界が
     `< today` でも `<= today` でも結果が同じになるデータで、**今日を
     外している実装でも AC-72 が通る**（CLAUDE.md §2.11 の3つ目の形 ――
     対象の行が0件のとき、その条項は必ず通る）。

     **単発にしてある。** 定期項目にすると24ヶ月ぶん立ち、件数を見ている
     ほかの条項の母数が動く。額は他の行に出てこない 31,500 */
  {
    id: "o3",
    name: "電気代",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-02",
    amount: 31_500,
    bizRatio: 40,
    accountId: "a1",
    date: FIXTURE_TODAY,
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
  /* **両側記録の振替**（FR-51・AC-58・AC-20d）。`type` は入出金のまま、
     費目だけが資金移動である。

     **1組入れてあるのは、画面で見られるようにするため。** 0件だと、
     月次資金繰り表で「振替の費目を持つ入出金が、入金と出金にそれぞれ
     乗る」ところを一度も見られない ―― **行が無い条項は必ず通る**
     （CLAUDE.md §2.11 の3つ目の形）。

     **金額は他の行に出てこない 77,777。** 両側が同額なので差引では0に
     なって消える。入金・出金を個別に見るための額である。
     **現預金の合計は動かない**（a1 から a2 への移動なので）。 */
  {
    id: "ac2",
    key: null,
    unplanned: true,
    name: "△△信金へ移動",
    type: "expense",
    costType: null,
    categoryCode: "TRF-01",
    amount: 77_777,
    bizRatio: 0,
    accountId: "a1",
    date: "2026-10-09",
  },
  {
    id: "ac3",
    key: null,
    unplanned: true,
    name: "○○銀行から移動",
    type: "income",
    costType: null,
    categoryCode: "TRF-01",
    amount: 77_777,
    bizRatio: 0,
    accountId: "a2",
    date: "2026-10-09",
  },
  /* **両端を持つ振替（`type = transfer`）が2件**。向き（FR-63・AC-70）と
     口座ごとの日別（FR-64・AC-71）を画面で見るために入れてある。

     **現金（a0）を動かす行は、これを入れるまで0件だった。** 0件の口座で
     日別を測ると増減も合計も0で、どんな実装でも通る（CLAUDE.md §2.11 の
     3つ目の形）。**入る日と出る日を両方**作る。

     **向きが逆の組にしてある。** これが 2026-11-12 に 46,000円 ずれた
     ときの形である ―― 引出し17件のなかに預け入れ1件が同じ名前で紛れて
     いた。合計の範囲では両方とも符号が付かない（閉じる振替）ので、
     **向きが出ていないと2件の区別が付かない。**

     額は他の行に出てこない 50,000 と 23,000。相殺して0にならない
     （+27,000。§2.11 の1つ目の形） */
  {
    id: "ac4",
    key: null,
    unplanned: true,
    name: "ＡＴＭ　セブン銀行",
    type: "transfer",
    costType: null,
    categoryCode: "TRF-01",
    amount: 50_000,
    bizRatio: 0,
    accountId: "a1",
    toAccountId: "a0",
    date: "2026-10-14",
  },
  {
    id: "ac5",
    key: null,
    unplanned: true,
    name: "ＡＴＭ　ローソン",
    type: "transfer",
    costType: null,
    categoryCode: "TRF-01",
    amount: 23_000,
    bizRatio: 0,
    accountId: "a0",
    toAccountId: "a1",
    date: "2026-10-23",
  },
];

export interface FixtureModel {
  series: BalanceSeries;
  dashboard: Dashboard;
  reconcile: ReconcileWarnings;
}

/** 本番（DashboardScreen）と同じ順で同じ関数を通す。 */
export function buildFixtureModel(
  today: DateStr = FIXTURE_TODAY,
  /** 見る口座。省略すると全口座（本番と同じ既定） */
  scope?: ReadonlySet<string>,
): FixtureModel {
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
    scope,
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
