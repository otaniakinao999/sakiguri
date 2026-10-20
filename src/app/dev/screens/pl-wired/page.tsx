/**
 * 年月別 収支の確認（開発用）
 *
 * **Figma 2031:256 と数字は合わない。** 損益は計算で出るもので、Figma の
 * 値は手で置いたもの。ここで見るのは並びと体裁（行の種類、1列目の固定、
 * 費用に符号を付けていないこと）。
 *
 * **認証の外に置いてある。** タブは操作できない（状態を持たない）。
 */

import { actualToEvent } from "@/core/cash";
import { buildForecast } from "@/core/forecast";
import { buildPLMatrix } from "@/core/pl";
import { buildBalanceSeries } from "@/core/balance";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { ProfitLossView } from "@/components/pl/ProfitLossView";
import { buildPLViewRows, PL_COLUMNS } from "@/components/pl/pl-view-model";
import { buildHeaderStats } from "@/lib/header-stats";
import { buildPLDisplay, PL_MODES, PL_SCOPES } from "@/lib/pl-view";
import { forecastEnd } from "@/lib/period";

export default function DevPLWiredPage() {
  const to = forecastEnd(FIXTURE_ASOF);
  const forecast = buildForecast(
    { recurring: FIXTURE_RECURRING, oneoffs: FIXTURE_ONEOFFS, overrides: {} },
    FIXTURE_ASOF,
    to,
  );
  const series = buildBalanceSeries(
    { accounts: FIXTURE_ACCOUNTS, asOf: FIXTURE_ASOF, forecast, actuals: FIXTURE_ACTUALS },
    to,
    FIXTURE_TODAY,
  );
  const matrix = buildPLMatrix({
    forecast,
    actuals: FIXTURE_ACTUALS.map(actualToEvent),
    year: 2026,
    scope: "all",
    today: FIXTURE_TODAY,
  });
  const display = buildPLDisplay(matrix, "mixed", FIXTURE_TODAY);

  return (
        <ProfitLossView
          stats={buildHeaderStats(series, FIXTURE_ACCOUNTS, FIXTURE_TODAY)}
          panelTitle="年月別 収支（2026年度・合算）"
          columns={PL_COLUMNS}
          rows={buildPLViewRows(display)}
          year={{
            defaultValue: "2026",
            options: [{ value: "2026", label: "2026年度" }],
          }}
          mode={{ defaultValue: "mixed", options: PL_MODES }}
          scope={{ defaultValue: "all", options: PL_SCOPES }}
          lead={
            <p className="t-body-sm text-muted-foreground">
              「実績+予定」は、今日までの実績と、まだ消し込んでいない予定を足した値です。
            </p>
          }
          notes={
            <div className="flex flex-col gap-4">
              <p className="t-body-sm text-muted-foreground">
                正の値が良い方向です。費用は実額で、差引は 収入 − 固定費 − 変動費 です。
              </p>
              <p className="t-body-sm text-muted-foreground">
                12ヶ月と年計は画面に収まらないため、1列目を固定したまま横にスクロールします。
              </p>
            </div>
          }
        />
  );
}
