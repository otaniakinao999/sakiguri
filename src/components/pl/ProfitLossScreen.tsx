"use client";

/**
 * SC-04 年月別 収支
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-04、§3.3 CL-4・CL-5
 *   予実マトリクス（年・スコープ・表示モードの切替）。
 */

import { useMemo, useState } from "react";

import { actualToEvent } from "@/core/cash";
import { buildForecast } from "@/core/forecast";
import { buildPLMatrix, type PLMode } from "@/core/pl";
import { toYearMonth } from "@/core/date";
import type { Scope } from "@/core/proration";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Card } from "@/components/ui/Card";
import { Notification } from "@/components/ui/Notification";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { isEmpty } from "@/lib/app-data";
import { forecastEnd } from "@/lib/period";
import {
  buildPLDisplay,
  PL_MODES,
  PL_SCOPES,
  selectableYears,
} from "@/lib/pl-view";

import { ProfitLossMatrix } from "./ProfitLossMatrix";

const SCOPE_TITLES: Record<Scope, string> = {
  all: "家計+事業 合算",
  household: "家計",
  business: "事業",
};

export function ProfitLossScreen() {
  const { data, today } = useAppData();

  const [scope, setScope] = useState<Scope>("all");
  const [mode, setMode] = useState<PLMode>("mixed");
  const [year, setYear] = useState<number | null>(null);

  const computed = useMemo(() => {
    if (!today) return null;

    const forecast = buildForecast(
      {
        recurring: data.recurring,
        oneoffs: data.oneoffs,
        overrides: data.overrides,
      },
      data.asOf,
      forecastEnd(data.asOf),
    );
    const actuals = data.actuals.map(actualToEvent);
    const years = selectableYears(
      [...forecast.map((f) => f.date), ...actuals.map((a) => a.date)],
      Number(today.slice(0, 4)),
    );
    return { forecast, actuals, years };
  }, [data, today]);

  const activeYear = useMemo(() => {
    if (!computed || !today) return null;
    const fallback = Number(today.slice(0, 4));
    if (year !== null && computed.years.includes(year)) return year;
    return computed.years.includes(fallback) ? fallback : computed.years[0];
  }, [computed, today, year]);

  const display = useMemo(() => {
    if (!computed || !today || activeYear === null) return null;
    const matrix = buildPLMatrix({
      forecast: computed.forecast,
      actuals: computed.actuals,
      year: activeYear,
      scope,
    });
    return buildPLDisplay(matrix, mode, toYearMonth(today));
  }, [computed, today, activeYear, scope, mode]);

  if (!today) {
    return <Card title="年月別 収支">読み込み中…</Card>;
  }

  if (isEmpty(data) || !display || !computed) {
    return (
      <Card title="年月別 収支">
        <p className="text-object-base-high text-body-sm leading-normal">
          まだ予定も実績も登録されていません。
        </p>
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          「予定の設定」で定期的な入出金を登録すると、ここに費目ごとの
          年間の見通しが出ます。
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-8">
        <SegmentedControl
          label="年"
          value={activeYear ?? 0}
          options={computed.years.map((y) => ({ value: y, label: `${y}年` }))}
          onChange={setYear}
        />
        <SegmentedControl
          label="集計の範囲"
          value={scope}
          options={PL_SCOPES}
          onChange={setScope}
        />
        <SegmentedControl
          label="表示モード"
          value={mode}
          options={PL_MODES}
          onChange={setMode}
        />
      </div>

      {scope !== "all" && (
        <Notification>
          家事按分を反映しています。
          {scope === "business"
            ? "事業割合ぶんだけを経費として"
            : "事業割合を差し引いた残りを"}
          集計しています。
        </Notification>
      )}

      <Card title={`年月別 収支（${SCOPE_TITLES[scope]}）`}>
        <ProfitLossMatrix display={display} />
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          発生日ベース（カードは利用日）で集計し、口座間振替とカード引落、
          借入返済の元金は含めていません。資金繰り（現金ベース）とは日付が
          異なります。
          {mode === "mixed" && "　過去月は実績、未来月は予定です。"}
          {mode === "diff" &&
            "　差異は 収入なら実績−予定、費用なら予定−実績。正の値が良い方向です。"}
        </p>
      </Card>
    </div>
  );
}
