"use client";

/**
 * キャッシュフローの**配線**の確認（開発用）
 *
 * /dev/screens/cashflow が Figma と見比べるためのページで、こちらは
 * 実データの経路を通したときにどう出るかを見るためのページ。
 * buildForecast から buildCashflowViewModel まで本番と同じ関数を通す。
 *
 * **認証の外に置いてある。** 日次／月次だけ切り替えられる。
 * ほかのフィルターは固定（状態を持たない）。
 */

import { useState } from "react";

import { CashflowView } from "@/components/cashflow/CashflowView";
import {
  buildCashflowFixture,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/cashflow/cashflow-fixture";
import {
  buildCashflowViewModel,
  formatLedgerTotal,
} from "@/components/cashflow/cashflow-view-model";
import { LEDGER_KINDS, LEDGER_STATUSES } from "@/lib/ledger";
import { PERIOD_PRESETS } from "@/lib/period";

export default function DevCashflowWiredPage() {
  const [grain, setGrain] = useState<"daily" | "monthly">("daily");
  const fixture = buildCashflowFixture();
  const view = buildCashflowViewModel({
    series: fixture.series,
    monthly: fixture.monthly,
    view: fixture.view,
    from: fixture.from,
    to: fixture.to,
    today: FIXTURE_TODAY,
    reserveLine: FIXTURE_RESERVE_LINE,
    stats: fixture.stats,
  });

  return (
        <CashflowView
          stats={view.stats}
          chart={view.chart}
          trend={{
            value: grain,
            onChange: (v) => setGrain(v as "daily" | "monthly"),
            defaultValue: "daily",
            options: [
              { value: "daily", label: "日次" },
              { value: "monthly", label: "月次" },
            ],
          }}
          monthlyChart={view.monthlyChart}
          months={view.months}
          monthsNote={view.monthsNote}
          ledger={view.ledger}
          ledgerTotal={formatLedgerTotal(view.total)}
          period={{
            defaultValue: "recent",
            options: PERIOD_PRESETS.map((p) => ({ value: String(p.value), label: p.label })),
          }}
          categoryFilter={{
            defaultValue: "all",
            options: LEDGER_KINDS.map((k) => ({ value: k.value, label: k.label })),
          }}
          kindFilter={{
            defaultValue: "all",
            options: LEDGER_STATUSES.map((s) => ({ value: s.value, label: s.label })),
          }}
        />
  );
}
