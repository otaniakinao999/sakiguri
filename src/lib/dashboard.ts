/**
 * ダッシュボードの表示モデル（SC-02）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-02、§3.3 CL-3
 *
 * **SC-02 の6要素のうち3つに絞る。**
 *   今後90日の資金繰り（最低残高と警告）
 *   実績が未入力の予定（件数と一覧）
 *   口座・カード残高
 * 当月の予実サマリ、直近の大きな入出金、繰延した予定の一覧は作らない。
 *
 * 純関数。core を組み合わせるだけ。
 */

import type { BalanceSeries } from "@/core/balance";
import { addDays } from "@/core/date";
import type { ShortfallKind } from "@/core/monthly";
import { isCard } from "@/core/types";
import type {
  Account,
  CardAccount,
  DateStr,
  DepositAccount,
  ForecastInstance,
  Yen,
} from "@/core/types";

/** ダッシュボードが見る期間（要件定義書 §4.1 SC-02「90日最低残高」）。 */
export const DASHBOARD_HORIZON_DAYS = 90;

export interface DashboardWarning {
  kind: ShortfallKind;
  date: DateStr;
  balance: Yen;
}

export interface AccountBalance {
  account: DepositAccount;
  balance: Yen;
}

export interface CardBalance {
  card: CardAccount;
  /** 未払残高 */
  due: Yen;
  /** 次に到来する引落。無ければ null */
  next: { date: DateStr; amount: Yen } | null;
}

export interface Dashboard {
  /** 今日の現預金残高。実績があればその値 */
  current: Yen;
  /** 今後90日の最低残高と、その日 */
  lowest: { balance: Yen; date: DateStr };
  /** 防衛ラインを下回らなければ null */
  warning: DashboardWarning | null;
  /** 実績が未入力の過去の予定。新しい順 */
  unfilled: ForecastInstance[];
  accounts: AccountBalance[];
  cards: CardBalance[];
  /** 現預金の合計（今日時点） */
  total: Yen;
}

export interface DashboardInput {
  series: BalanceSeries;
  accounts: Account[];
  reserveLine: Yen;
  today: DateStr;
}

/**
 * ダッシュボードに出す数字をまとめる。
 *
 * 最低残高は**今日から90日先まで**を見る。月の区切りではなく、
 * 今いる地点からの見通しを出す。
 */
export function buildDashboard(input: DashboardInput): Dashboard {
  const { series, accounts, reserveLine, today } = input;

  const horizonEnd = addDays(today, DASHBOARD_HORIZON_DAYS);
  const window = series.rows.filter(
    (row) => row.date >= today && row.date <= horizonEnd,
  );
  const todayRow = series.rows.find((row) => row.date === today);

  /* 90日ぶんの行が無ければ、あるところまでで見る */
  let lowest = { balance: todayRow?.proj ?? 0, date: today };
  for (const row of window) {
    if (row.proj < lowest.balance) {
      lowest = { balance: row.proj, date: row.date };
    }
  }

  const warning: DashboardWarning | null =
    lowest.balance < reserveLine
      ? {
          kind: lowest.balance < 0 ? "shortfall" : "reserveBreach",
          date: lowest.date,
          balance: lowest.balance,
        }
      : null;

  /* CL-3 の注記：実績が入力されていない過去の予定は予定額のまま
     予測に残す。UI では件数と一覧を出して消し込みを促す */
  const unfilled = series.unmatchedForecast
    .filter((plan) => plan.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const depositAccounts = accounts.filter(
    (a): a is DepositAccount => !isCard(a),
  );
  const accountBalances: AccountBalance[] = depositAccounts.map((account) => ({
    account,
    balance: todayRow?.byAccount[account.id] ?? account.balance,
  }));

  const cardBalances: CardBalance[] = accounts.filter(isCard).map((card) => {
    const settlement = series.projectedCash.find(
      (event) =>
        event.src === "settle" && event.cardId === card.id && event.date >= today,
    );
    return {
      card,
      due: todayRow?.byCard[card.id] ?? card.balance,
      next: settlement
        ? { date: settlement.date, amount: settlement.amount }
        : null,
    };
  });

  return {
    current: todayRow ? (todayRow.act ?? todayRow.proj) : 0,
    lowest,
    warning,
    unfilled,
    accounts: accountBalances,
    cards: cardBalances,
    total: accountBalances.reduce((sum, a) => sum + a.balance, 0),
  };
}
