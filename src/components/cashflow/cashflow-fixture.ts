/**
 * キャッシュフローの配線を試すための一式
 *
 * **口座・予定・実績はダッシュボードのフィクスチャをそのまま使う**
 * （CLAUDE.md §2.8）。同じ事業のデータで両方の画面を見たい。
 * ここで足すのは、02 だけが使う月次集計と明細の絞り込み。
 */

import { buildMonthlyCashflow, type MonthlyCashflowRow } from "@/core/monthly";
import { toYearMonth } from "@/core/date";
import { isCard } from "@/core/types";
import type { DateStr, Yen } from "@/core/types";
import { buildHeaderStats } from "@/lib/header-stats";
import { buildLedgerView, type LedgerView } from "@/lib/ledger";
import type { PageHeaderStat } from "@/components/sakiguri/PageHeader";
import type { BalanceSeries } from "@/core/balance";

import {
  buildFixtureModel,
  FIXTURE_ACCOUNTS,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";

export { FIXTURE_RESERVE_LINE, FIXTURE_TODAY };

/** 表示する期間。Figma 2030:186 と同じ6ヶ月（2026年9月〜2027年2月） */
export const FIXTURE_FROM = "2026-09";
export const FIXTURE_TO = "2027-02";

export interface CashflowFixture {
  series: BalanceSeries;
  monthly: MonthlyCashflowRow[];
  view: LedgerView;
  /** グラフの横幅 */
  from: DateStr;
  to: DateStr;
  stats: PageHeaderStat[];
  /** 生活防衛ライン。口座別のときは null */
  reserveLine: Yen | null;
}

/** 本番（CashflowScreen）と同じ順で同じ関数を通す。 */
export function buildCashflowFixture(
  today: DateStr = FIXTURE_TODAY,
  /** 見る口座。省略すると現預金の合計（本番画面と同じ既定） */
  scope?: ReadonlySet<string>,
): CashflowFixture {
  /* 口座別のあいだは生活防衛ラインを出さない（合計に対して決めた額なので） */
  const reserveLine = scope ? null : FIXTURE_RESERVE_LINE;
  const { series } = buildFixtureModel(today, scope);
  const monthly = buildMonthlyCashflow(series, reserveLine ?? 0, scope).filter(
    (m) => m.yearMonth >= FIXTURE_FROM && m.yearMonth <= FIXTURE_TO,
  );

  const view = buildLedgerView({
    series,
    monthly,
    from: FIXTURE_FROM,
    to: FIXTURE_TO,
    kind: "all",
    status: "all",
    today,
    scope,
  });

  const rows = series.rows.filter(
    (r) => toYearMonth(r.date) >= FIXTURE_FROM && toYearMonth(r.date) <= FIXTURE_TO,
  );

  return {
    series,
    monthly,
    view,
    from: rows[0]?.date ?? today,
    to: rows[rows.length - 1]?.date ?? today,
    stats: buildHeaderStats(series, FIXTURE_ACCOUNTS, today),
    reserveLine,
  };
}

/** フィクスチャにカードが1枚あることの確認用 */
export const FIXTURE_HAS_CARD = FIXTURE_ACCOUNTS.some(isCard);
