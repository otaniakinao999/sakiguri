"use client";

/**
 * SC-03 キャッシュフロー
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-03、§4.2
 *   残高推移グラフ（日次／月次切替）、月次資金繰り表、入出金予定表。
 */

import { useMemo, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { buildMonthlyCashflow } from "@/core/monthly";
import { toYearMonth } from "@/core/date";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatAmount, formatYearMonthLabel, MINUS } from "@/lib/format";
import { isEmpty } from "@/lib/app-data";
import {
  buildLedgerView,
  LEDGER_KINDS,
  LEDGER_STATUSES,
  type LedgerKind,
  type LedgerStatus,
} from "@/lib/ledger";
import {
  forecastEnd,
  PERIOD_PRESETS,
  resolveRange,
  selectableMonths,
  type PeriodPreset,
} from "@/lib/period";

import { BalanceChart, type ChartGrain } from "./BalanceChart";
import { LedgerTable } from "./LedgerTable";
import { MonthlyCashflowTable } from "./MonthlyCashflowTable";

const GRAINS: readonly { value: ChartGrain; label: string }[] = [
  { value: "day", label: "日次" },
  { value: "month", label: "月次" },
];

export function CashflowScreen() {
  const { data, today } = useAppData();

  const [grain, setGrain] = useState<ChartGrain>("day");
  const [preset, setPreset] = useState<PeriodPreset>(3);
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [kind, setKind] = useState<LedgerKind>("all");
  const [status, setStatus] = useState<LedgerStatus>("all");

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
      {
        accounts: data.accounts,
        asOf: data.asOf,
        forecast,
        actuals: data.actuals,
      },
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

  const view = useMemo(() => {
    if (!computed) return null;
    return buildLedgerView({
      series: computed.series,
      monthly: computed.monthly,
      from: range.from,
      to: range.to,
      kind,
      status,
    });
  }, [computed, range, kind, status]);

  /* 表示範囲に絞った行と月 */
  const inRange = useMemo(() => {
    if (!computed) return { rows: [], monthly: [] };
    return {
      rows: computed.series.rows.filter((r) => {
        const ym = toYearMonth(r.date);
        return ym >= range.from && ym <= range.to;
      }),
      monthly: computed.monthly.filter(
        (m) => m.yearMonth >= range.from && m.yearMonth <= range.to,
      ),
    };
  }, [computed, range]);

  if (!today) {
    return <Card title="キャッシュフロー">読み込み中…</Card>;
  }

  if (isEmpty(data) || !computed || !view) {
    return (
      <Card title="キャッシュフロー">
        <p className="text-object-base-high text-body-sm leading-normal">
          まだ口座が登録されていません。
        </p>
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          「予定の設定」で基準日・口座残高・定期的な入出金を登録すると、
          ここに残高の推移が出ます。
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {/* ---------- 残高推移グラフ ---------- */}
      <div className="flex flex-wrap items-center gap-8">
        <SegmentedControl
          label="グラフの粒度"
          value={grain}
          options={GRAINS}
          onChange={setGrain}
        />
        <span className="text-object-base-mid text-body-xxs">
          実線＝実績　破線＝予測
        </span>
      </div>

      <Card
        title={grain === "day" ? "残高推移（日次）" : "残高推移と月間収支（月次）"}
      >
        <BalanceChart
          grain={grain}
          rows={inRange.rows}
          monthly={inRange.monthly}
          reserveLine={data.reserveLine}
          today={today}
        />
      </Card>

      {/* ---------- 月次資金繰り表 ---------- */}
      {grain === "month" && (
        <Card title="月次資金繰り表">
          <MonthlyCashflowTable rows={inRange.monthly} />
        </Card>
      )}

      {/* ---------- 入出金予定表 ---------- */}
      <Card
        title={`入出金予定表（${formatYearMonthLabel(range.from)}〜${formatYearMonthLabel(range.to)}・現金ベース）`}
        right={
          <span className="num text-object-base-mid text-body-xxs font-normal">
            {view.total.count}件 ／ 入金 {formatAmount(view.total.inflow)} ／ 出金{" "}
            {MINUS}
            {formatAmount(view.total.outflow)}
          </span>
        }
      >
        <div className="mb-12 flex flex-wrap items-center gap-8">
          <SegmentedControl
            label="期間"
            value={preset}
            options={PERIOD_PRESETS}
            onChange={setPreset}
          />
          {preset === "custom" && (
            <span className="flex items-center gap-8">
              <label className="sr-only" htmlFor="period-from">
                開始月
              </label>
              <select
                id="period-from"
                value={customFrom ?? range.from}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border-border-base-high bg-surface-base-primary rounded-base border px-8 py-4 text-body-xs"
              >
                {computed.months.map((m) => (
                  <option key={m} value={m}>
                    {formatYearMonthLabel(m)}
                  </option>
                ))}
              </select>
              <span className="text-object-base-mid">〜</span>
              <label className="sr-only" htmlFor="period-to">
                終了月
              </label>
              <select
                id="period-to"
                value={customTo ?? range.to}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border-border-base-high bg-surface-base-primary rounded-base border px-8 py-4 text-body-xs"
              >
                {computed.months.map((m) => (
                  <option key={m} value={m}>
                    {formatYearMonthLabel(m)}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>

        <div className="mb-12 flex flex-wrap items-center gap-8">
          <SegmentedControl
            label="種別"
            value={kind}
            options={LEDGER_KINDS}
            onChange={setKind}
          />
          <SegmentedControl
            label="状態"
            value={status}
            options={LEDGER_STATUSES}
            onChange={setStatus}
          />
        </div>

        <LedgerTable view={view} accounts={data.accounts} />
      </Card>
    </div>
  );
}
