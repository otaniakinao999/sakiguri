"use client";

/**
 * キャッシュフローの**配線**の確認（開発用）
 *
 * /dev/screens/cashflow が Figma と見比べるためのページで、こちらは
 * 実データの経路を通したときにどう出るかを見るためのページ。
 * buildForecast から buildCashflowViewModel まで本番と同じ関数を通す。
 *
 * **認証の外に置いてある。** 日次／月次と、見る口座を切り替えられる。
 * ほかのフィルターは固定（状態を持たない）。
 *
 * 口座の切り替えは本番（CashflowScreen）と同じ順で同じ関数を通す。
 * ここで確かめられないと、口座別の数字は本番でしか見られない。
 */

import { useState } from "react";

import { CashflowView } from "@/components/cashflow/CashflowView";
import {
  buildCashflowFixture,
  FIXTURE_TODAY,
} from "@/components/cashflow/cashflow-fixture";
import { FIXTURE_ACCOUNTS } from "@/components/dashboard/dashboard-fixture";
import { isCard } from "@/core/types";
import { Select } from "@/components/ui/inputs";
import {
  buildCashflowViewModel,
  formatLedgerTotal,
} from "@/components/cashflow/cashflow-view-model";
import { LEDGER_KINDS, LEDGER_STATUSES } from "@/lib/ledger";
import { PERIOD_PRESETS } from "@/lib/period";

export default function DevCashflowWiredPage() {
  const [grain, setGrain] = useState<"daily" | "monthly">("daily");
  const [accountScope, setAccountScope] = useState<string>("all");
  const scope = accountScope === "all" ? undefined : new Set([accountScope]);
  const fixture = buildCashflowFixture(FIXTURE_TODAY, scope);
  const view = buildCashflowViewModel({
    series: fixture.series,
    monthly: fixture.monthly,
    view: fixture.view,
    from: fixture.from,
    to: fixture.to,
    today: FIXTURE_TODAY,
    reserveLine: fixture.reserveLine,
    stats: fixture.stats,
  });

  return (
        <CashflowView
          headerAction={
            <label className="flex shrink-0 items-center gap-8 whitespace-nowrap t-body-sm text-muted-foreground">
              口座
              <Select
                aria-label="見る口座"
                value={accountScope}
                onChange={(e) => setAccountScope(e.target.value)}
              >
                <option value="all">現預金 合計</option>
                {FIXTURE_ACCOUNTS.filter((a) => !isCard(a)).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </label>
          }
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
          ledgerMonths={view.ledgerMonths}
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
