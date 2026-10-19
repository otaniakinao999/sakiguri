"use client";

/**
 * SC-02 ダッシュボード
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-02、docs/design/screens.md 01
 *
 * **6要素のうち3つに絞っている。**
 *   今後90日の資金繰り（最低残高と警告）
 *   実績が未入力の予定（件数と一覧）
 *   口座・カード残高
 * 当月の予実サマリ、直近の大きな入出金、繰延した予定の一覧は作らない。
 *
 * **この層はデータを集めて記録を取るだけ。**
 *   数字 → dashboard-view-model.ts（純関数。フィクスチャで検査できる）
 *   見た目 → DashboardView
 *   警告の文言 → DashboardNotices
 * この画面は Supabase に繋がないと開けないので、中に置いたものは
 * 目視でしか確かめられなくなる。置かない。
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

import { buildBalanceSeries } from "@/core/balance";
import { daysBetween } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { DashboardView } from "@/components/dashboard/DashboardView";
import {
  ReconcileNotices,
  ShortfallNotice,
} from "@/components/dashboard/DashboardNotices";
import {
  buildDashboardViewModel,
  type Range,
} from "@/components/dashboard/dashboard-view-model";
import { Panel } from "@/components/sakiguri/Panel";
import { Button } from "@/components/ui/v06/button";
import { track } from "@/lib/analytics/track";
import { isEmpty } from "@/lib/app-data";
import { buildDashboard, DASHBOARD_HORIZON_DAYS } from "@/lib/dashboard";
import { buildReconcileWarnings } from "@/lib/reconcile-warnings";
import { forecastEnd } from "@/lib/period";

export function DashboardScreen() {
  const { data, today, session } = useAppData();
  const [range, setRange] = useState<Range>("90");

  const model = useMemo(() => {
    if (!today || data.accounts.length === 0) return null;
    const to = forecastEnd(data.asOf);
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
      { accounts: data.accounts, asOf: data.asOf, forecast, actuals: data.actuals },
      to,
      today,
    );
    return {
      series,
      dashboard: buildDashboard({
        series,
        accounts: data.accounts,
        reserveLine: data.reserveLine,
        today,
      }),
      /* FR-43。消し込みの停止と取り残しは別の警告として出す */
      reconcile: buildReconcileWarnings({
        lastReconciledAt: data.lastReconciledAt,
        asOf: data.asOf,
        unmatchedForecast: series.unmatchedForecast,
        /* AC-29d。下の early return でも止まるが、担保は関数側にある */
        accountCount: data.accounts.length,
        today,
      }),
    };
  }, [data, today]);

  /* 警告を見せたことを1回だけ記録する（指標の分母） */
  const warnedRef = useRef(false);
  useEffect(() => {
    const warning = model?.dashboard.warning;
    if (!warning || !today || warnedRef.current) return;
    warnedRef.current = true;
    track(session?.user.id, "shortfall_warned", {
      shortfall: warning.kind === "shortfall",
      daysAhead: daysBetween(today, warning.date),
    });
  }, [model, today, session]);

  const view = useMemo(
    () =>
      model && today
        ? buildDashboardViewModel({
            series: model.series,
            dashboard: model.dashboard,
            today,
            reserveLine: data.reserveLine,
            range,
          })
        : null,
    [model, today, data.reserveLine, range],
  );

  if (!today) return <Panel title="ダッシュボード">読み込み中…</Panel>;

  if (isEmpty(data) || !model || !view) {
    return (
      <Panel title="ダッシュボード">
        <p className="t-body text-foreground">まだ口座が登録されていません。</p>
        <p className="t-body-sm text-muted-foreground">
          「予定の設定」で基準日・口座残高・毎月の入出金を登録すると、
          ここに今後{DASHBOARD_HORIZON_DAYS}日の見通しが出ます。
        </p>
        <div>
          <Link href="/settings">
            <Button>予定の設定へ</Button>
          </Link>
        </div>
      </Panel>
    );
  }

  const { warning } = model.dashboard;

  return (
    <DashboardView
      {...view}
      range={range}
      onRangeChange={(next) => setRange(next as Range)}
      heroActions={
        <Link href="/import">
          <Button>
            <ArrowUpTrayIcon />
            CSVを取り込む
          </Button>
        </Link>
      }
      heroNotice={
        warning && (
          <ShortfallNotice
            warning={warning}
            reserveLine={data.reserveLine}
            onAct={(toEntry) => track(session?.user.id, "shortfall_acted", { toEntry })}
          />
        )
      }
      notices={<ReconcileNotices warnings={model.reconcile} />}
      todoAction={
        view.todoCount > 0 ? (
          <Link href="/entry">
            <Button variant="outline" size="sm">
              消し込む
            </Button>
          </Link>
        ) : undefined
      }
      footer={
        /* 要件定義書 §7 制約3。
           「利用者にはその旨を画面上で注記する」と明記されている */
        <p className="t-body-sm text-muted-foreground">
          借入の返済を定期項目1件として登録している場合、元金と利息が分かれない
          ため、年月別収支の費用が実際より大きく出ます（資金繰りの予測は実態と
          一致します）。元金と利息の自動分離は v2.0 で対応します。
        </p>
      }
    />
  );
}
