"use client";

/**
 * SC-03 キャッシュフロー
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-03・§4.2、docs/design/screens.md 02
 *   残高推移グラフ（日次／月次切替）、月次資金繰り表、入出金予定表。
 *
 * **この層はデータを集めて記録を取るだけ。**
 *   数字 → cashflow-view-model.ts（純関数。フィクスチャで検査できる）
 *   見た目 → CashflowView
 * この画面は Supabase に繋がないと開けないので、中に置いたものは
 * 目視でしか確かめられなくなる。置かない（ダッシュボードと同じ形）。
 *
 * **v0.6.0 のデザインに無いものを5つ残した。** 差し込み口で渡している。
 * 経緯は docs/adr/0014。
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { buildMonthlyCashflow } from "@/core/monthly";
import { daysBetween, toYearMonth } from "@/core/date";
import type { Actual } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Panel } from "@/components/sakiguri/Panel";
import { track } from "@/lib/analytics/track";
import { buildHeaderStats } from "@/lib/header-stats";
import { formatYearMonthLabel } from "@/lib/format";
import { isEmpty } from "@/lib/app-data";
import {
  buildLedgerView,
  LEDGER_KINDS,
  LEDGER_STATUSES,
  type LedgerKind,
  type LedgerStatus,
} from "@/lib/ledger";
import {
  DEFAULT_PRESET,
  forecastEnd,
  PERIOD_PRESETS,
  resolveRange,
  selectableMonths,
  type PeriodPreset,
} from "@/lib/period";
import {
  ActualForm,
  applyActualPatch,
  isSubmittable,
} from "@/components/entry/ActualForm";
import { updateActual } from "@/lib/mutations";

import { CashflowView } from "./CashflowView";
import {
  buildCashflowViewModel,
  formatLedgerTotal,
} from "./cashflow-view-model";

type Grain = "daily" | "monthly";

const GRAINS = [
  { value: "daily" as const, label: "日次" },
  { value: "monthly" as const, label: "月次" },
];

export function CashflowScreen() {
  const { data, setData, today, session } = useAppData();

  const [grain, setGrain] = useState<Grain>("daily");
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PRESET);
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [kind, setKind] = useState<LedgerKind>("all");
  const [status, setStatus] = useState<LedgerStatus>("all");
  /**
   * 編集中の実績（FR-41）。
   *
   * 入出金予定表からも実績を直せるようにする。画面遷移させないのは、
   * 明細の並びの中で直したいためと、クエリパラメータを足すと静的生成の
   * 前提（ADR-0003）に Suspense 境界が要るようになるため。
   */
  const [editing, setEditing] = useState<Actual | null>(null);

  const computed = useMemo(() => {
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
      monthly: buildMonthlyCashflow(series, data.reserveLine),
      months: selectableMonths(data.asOf),
    };
  }, [data, today]);

  const range = useMemo(() => {
    if (!today) return { from: "", to: "" };
    const months = computed?.months ?? [];
    return resolveRange(
      preset,
      {
        from: customFrom ?? months[0] ?? toYearMonth(today),
        to: customTo ?? months[0] ?? toYearMonth(today),
      },
      data.asOf,
      today,
    );
  }, [preset, customFrom, customTo, data.asOf, today, computed]);

  const model = useMemo(() => {
    if (!computed || !today) return null;
    const monthly = computed.monthly.filter(
      (m) => m.yearMonth >= range.from && m.yearMonth <= range.to,
    );
    const rows = computed.series.rows.filter((r) => {
      const ym = toYearMonth(r.date);
      return ym >= range.from && ym <= range.to;
    });
    const view = buildLedgerView({
      series: computed.series,
      monthly,
      from: range.from,
      to: range.to,
      kind,
      status,
      today,
    });
    return buildCashflowViewModel({
      series: computed.series,
      monthly,
      view,
      from: rows[0]?.date ?? today,
      to: rows[rows.length - 1]?.date ?? today,
      today,
      reserveLine: data.reserveLine,
      stats: buildHeaderStats(computed.series, data.accounts, today),
    });
  }, [computed, range, kind, status, today, data.reserveLine, data.accounts]);

  /* ---------- 指標（PoC開発計画 §4） ----------
     予定がどこまで先にあるかを記録する。金額も日付も送らない
     （docs/adr/0013）。画面を開くたびに1回だけ。 */
  const reportedRef = useRef(false);
  useEffect(() => {
    if (!computed || !today || reportedRef.current) return;
    reportedRef.current = true;

    /* 警告の記録はダッシュボード（SC-02）に一本化してある。
       ここでも出すと、同じ警告が2回数えられて指標の分母がふくらむ。 */
    const lastPlan = computed.series.unmatchedForecast.at(-1)?.date;
    track(session?.user.id, "forecast_horizon", {
      months: lastPlan ? Math.round(daysBetween(today, lastPlan) / 30) : 0,
      accounts: data.accounts.length,
    });
  }, [computed, today, session, data.accounts.length]);

  if (!today) return <Panel title="キャッシュフロー">読み込み中…</Panel>;

  if (isEmpty(data) || !computed || !model) {
    return (
      <Panel title="キャッシュフロー">
        <p className="t-body text-foreground">まだ口座が登録されていません。</p>
        <p className="t-body-sm text-muted-foreground">
          「予定の設定」で基準日・口座残高・定期的な入出金を登録すると、
          ここに残高の推移が出ます。
        </p>
      </Panel>
    );
  }

  const monthOptions = computed.months;

  return (
    <CashflowView
      stats={model.stats}
      chart={model.chart}
      trend={{
        value: grain,
        onChange: (v) => setGrain(v as Grain),
        defaultValue: "daily",
        options: GRAINS,
      }}
      monthlyChart={model.monthlyChart}
      months={model.months}
      monthsNote={model.monthsNote}
      ledger={model.ledger}
      ledgerMonths={model.ledgerMonths}
      ledgerTotal={formatLedgerTotal(model.total)}
      period={{
        value: String(preset),
        onChange: (v) => setPreset((v === "recent" || v === "custom" ? v : Number(v)) as PeriodPreset),
        defaultValue: String(DEFAULT_PRESET),
        options: PERIOD_PRESETS.map((p) => ({ value: String(p.value), label: p.label })),
      }}
      categoryFilter={{
        value: kind,
        onChange: (v) => setKind(v as LedgerKind),
        defaultValue: "all",
        options: LEDGER_KINDS.map((k) => ({ value: k.value, label: k.label })),
      }}
      kindFilter={{
        value: status,
        onChange: (v) => setStatus(v as LedgerStatus),
        defaultValue: "all",
        options: LEDGER_STATUSES.map((s) => ({ value: s.value, label: s.label })),
      }}
      /* 「期間を指定」を選んだときだけ出す。Figma はタブまでしか無い */
      periodDetail={
        preset === "custom" ? (
          <span className="flex items-center gap-8">
            <label className="sr-only" htmlFor="period-from">
              開始月
            </label>
            <select
              id="period-from"
              value={customFrom ?? range.from}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-control-sm rounded-md border border-border bg-background px-control-sm t-label"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatYearMonthLabel(m)}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">〜</span>
            <label className="sr-only" htmlFor="period-to">
              終了月
            </label>
            <select
              id="period-to"
              value={customTo ?? range.to}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-control-sm rounded-md border border-border bg-background px-control-sm t-label"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatYearMonthLabel(m)}
                </option>
              ))}
            </select>
          </span>
        ) : undefined
      }
      /* FR-41。明細の内容を押すとここが開く */
      ledgerEditor={
        editing ? (
          <div className="rounded-md border border-border-primary-subtle bg-primary-subtle p-16">
            <h3 className="mb-12 t-card-title text-foreground">実績を編集</h3>
            <ActualForm
              value={editing}
              accounts={data.accounts}
              mode="edit"
              onChange={(patch) =>
                setEditing((e) => (e ? applyActualPatch(e, patch) : e))
              }
              onSubmit={() => {
                if (!editing || !isSubmittable(editing)) return;
                const target = editing;
                /* id と key は updateActual が保持する（AC-24・AC-25） */
                setData((d) =>
                  updateActual(d, target.id, {
                    date: target.date,
                    name: target.name.trim(),
                    type: target.type,
                    costType: target.costType,
                    categoryCode: target.categoryCode,
                    amount: target.amount,
                    bizRatio: target.bizRatio,
                    accountId: target.accountId,
                    toAccountId: target.toAccountId,
                  }),
                );
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : undefined
      }
      onEditActual={(actualId) =>
        setEditing(data.actuals.find((a) => a.id === actualId) ?? null)
      }
    />
  );
}
