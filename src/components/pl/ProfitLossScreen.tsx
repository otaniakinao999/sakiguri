"use client";

/**
 * SC-04 年月別 収支
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-04、§3.3 CL-4・CL-5、
 * docs/design/screens.md 03
 *
 * **この層はデータを集めるだけ。**
 *   行の並び → pl-view-model.ts（純関数）
 *   見た目 → ProfitLossView
 *
 * **v0.6.0 のデザインに無いものを4つ残した。** 差し込み口で渡している。
 * 経緯は docs/adr/0014。
 */

import { useMemo, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { actualToEvent } from "@/core/cash";
import { buildForecast } from "@/core/forecast";
import { buildPLMatrix, type PLMode } from "@/core/pl";
import type { Scope } from "@/core/proration";
import { touchesAccount } from "@/core/types";
import { Select } from "@/components/ui/inputs";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Callout } from "@/components/sakiguri/Callout";
import { Panel } from "@/components/sakiguri/Panel";
import { buildHeaderStats } from "@/lib/header-stats";
import { isEmpty } from "@/lib/app-data";
import { forecastEnd } from "@/lib/period";
import {
  buildPLDisplay,
  PL_MODES,
  PL_SCOPES,
  selectableYears,
} from "@/lib/pl-view";

import { ProfitLossView } from "./ProfitLossView";
import { buildPLViewRows, PL_COLUMNS } from "./pl-view-model";

const SCOPE_TITLES: Record<Scope, string> = {
  all: "合算",
  household: "家計",
  business: "事業",
};

export function ProfitLossScreen() {
  const { data, today } = useAppData();

  const [scope, setScope] = useState<Scope>("all");
  /**
   * 絞り込む口座。`"all"` は絞らない。
   *
   * **`scope`（家計／事業）とは別物。** あちらは按分のスコープで、
   * こちらは「どの口座から払ったか・どの口座に入ったか」。名前を
   * 揃えると、どちらの話をしているか読めなくなる。
   */
  const [accountScope, setAccountScope] = useState<string>("all");
  const [mode, setMode] = useState<PLMode>("mixed");
  const [year, setYear] = useState<number | null>(null);

  const computed = useMemo(() => {
    if (!today) return null;

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
    const actuals = data.actuals.map(actualToEvent);
    const years = selectableYears(
      [...forecast.map((f) => f.date), ...actuals.map((a) => a.date)],
      Number(today.slice(0, 4)),
    );
    /* PageHeader の残高サマリーは残高系列から取る。ほかの画面と同じ
       数字を出すため（AC-49）。損益の計算には使わない */
    const series =
      data.accounts.length > 0
        ? buildBalanceSeries(
            { accounts: data.accounts, asOf: data.asOf, forecast, actuals: data.actuals },
            to,
            today,
          )
        : null;
    return { forecast, actuals, years, series };
  }, [data, today]);

  const activeYear = useMemo(() => {
    if (!computed || !today) return null;
    const fallback = Number(today.slice(0, 4));
    if (year !== null && computed.years.includes(year)) return year;
    return computed.years.includes(fallback) ? fallback : computed.years[0];
  }, [computed, today, year]);

  const display = useMemo(() => {
    if (!computed || !today || activeYear === null) return null;
    /* **損益を口座で絞る。** 「その口座から払った費用／その口座に
       入った収入」という意味になる。残高の話ではないので、残高系列の
       範囲（buildBalanceSeries の scope）は使わない。
       判定は core の `touchesAccount` から借りる（§2.8） */
    const byAccount = <T extends { accountId: string; toAccountId?: string }>(
      events: readonly T[],
    ): T[] =>
      accountScope === "all"
        ? [...events]
        : events.filter((e) => touchesAccount(e, accountScope));

    const matrix = buildPLMatrix({
      forecast: byAccount(computed.forecast),
      actuals: byAccount(computed.actuals),
      year: activeYear,
      scope,
      today,
    });
    return buildPLDisplay(matrix, mode, today);
  }, [computed, today, activeYear, scope, mode, accountScope]);

  if (!today) return <Panel title="年月別 収支">読み込み中…</Panel>;

  if (isEmpty(data) || !display || !computed) {
    return (
      <Panel title="年月別 収支">
        <p className="t-body text-foreground">まだ予定も実績も登録されていません。</p>
        <p className="t-body-sm text-muted-foreground">
          「予定の設定」で定期的な入出金を登録すると、ここに費目ごとの
          年間の見通しが出ます。
        </p>
      </Panel>
    );
  }

  return (
    <ProfitLossView
      stats={
        computed.series ? buildHeaderStats(computed.series, data.accounts, today) : []
      }
      panelTitle={`年月別 収支（${activeYear}年度・${SCOPE_TITLES[scope]}${
        accountScope === "all"
          ? ""
          : `・${data.accounts.find((a) => a.id === accountScope)?.name ?? ""}`
      }）`}
      accountFilter={
        <label className="flex shrink-0 items-center gap-8 whitespace-nowrap t-body-sm text-muted-foreground">
          口座
          <Select
            aria-label="絞り込む口座"
            value={accountScope}
            onChange={(e) => setAccountScope(e.target.value)}
          >
            <option value="all">すべて</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      }
      columns={PL_COLUMNS}
      rows={buildPLViewRows(display)}
      signed={mode === "diff"}
      year={{
        value: String(activeYear),
        onChange: (v) => setYear(Number(v)),
        defaultValue: String(activeYear),
        options: computed.years.map((y) => ({ value: String(y), label: `${y}年度` })),
      }}
      mode={{
        value: mode,
        onChange: (v) => setMode(v as PLMode),
        defaultValue: "mixed",
        options: PL_MODES,
      }}
      /* 合算 / 家計 / 事業。**Figma には無いが要件定義書 §4.1 SC-04 にある。**
         無いと家事按分を見る手段が画面から消える */
      scope={{
        value: scope,
        onChange: (v) => setScope(v as Scope),
        defaultValue: "all",
        options: PL_SCOPES,
      }}
      lead={
        <p className="t-body-sm text-muted-foreground">
          「実績+予定」は、今日までの実績と、まだ消し込んでいない予定を足した値です。
        </p>
      }
      notices={
        scope !== "all" ? (
          <Callout tone="info">
            家事按分を反映しています。
            {scope === "business"
              ? "事業割合ぶんだけを経費として"
              : "事業割合を差し引いた残りを"}
            集計しています。
          </Callout>
        ) : undefined
      }
      notes={
        <div className="flex flex-col gap-4">
          <p className="t-body-sm text-muted-foreground">
            正の値が良い方向です。費用は実額で、差引は 収入 − 固定費 − 変動費 です。
          </p>
          <p className="t-body-sm text-muted-foreground">
            12ヶ月と年計は画面に収まらないため、1列目を固定したまま横にスクロールします。
          </p>
          {/* **発生日ベースであることは Figma に無いが落とせない。**
              資金繰り（現金ベース）と日付が違う理由がここにしか無い */}
          <p className="t-body-sm text-muted-foreground">
            発生日ベース（カードは利用日）で集計し、口座間振替とカード引落、
            借入返済の元金は含めていません。資金繰り（現金ベース）とは日付が
            異なります。
            {mode === "mixed" &&
              "　小さい「予」は当初の予定額で、見込みと違うときだけ添えています。"}
            {mode === "diff" &&
              "　差異は 収入なら実績−予定、費用なら予定−実績。予定側・実績側とも" +
                "発生日が本日以前のものだけを数えているため、「予定」モードの" +
                "月合計とは一致しません。"}
          </p>
          {/* AC-43。途中までの比較になっている列を名指しする */}
          {mode === "diff" && display.asOfNote && (
            <p className="t-body-sm text-fg-warning">{display.asOfNote.label}</p>
          )}
        </div>
      }
    />
  );
}
