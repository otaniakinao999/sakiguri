"use client";

/**
 * CSV取込の確認（開発用）
 *
 * **実際の CSV を parseCsv → detectColumns → buildImportRows に通す。**
 * 照合の列（自動で照合 / 要対応2種）は本物の照合結果から出る。
 * 認証の外に置いてある。
 */

import { useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import {
  buildImportRows,
  detectColumns,
  parseCsv,
  type ColumnMapping,
  type ImportRow,
} from "@/core/csv";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ASOF,
  FIXTURE_ACTUALS,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { ImportView } from "@/components/import/ImportView";
import { buildHeaderStats } from "@/lib/header-stats";
import { forecastEnd } from "@/lib/period";

/**
 * 照合の3種類が全部出るように作ってある。
 *   9/25 330,000 → 売上入金の予定と完全一致（自動で照合）
 *   10/1 10,230 → 通信費の予定は 9,800。金額だけ違う（要対応）
 *   10/10 入金 200,000 → 12日以内に同じ向きの予定が無い（候補なし）
 *
 * **4件目の日付と向きは選んである。** 出金だと a1 の費用の予定
 * （1日・5日・27日）がどこかの12日以内に入ってしまい、必ず
 * 「金額が一致しません」になる。入金の予定は25日だけなので、
 * そこから13日以上離れた10/10にした。
 */
const CSV = `お取引日,お取引内容,お預入額,お引出額
2026/09/25,ﾌﾘｺﾐ ｼﾖｳｶｲ,330000,
2026/09/27,ｼﾞﾑｼﾖﾔﾁﾝ,,95000
2026/10/01,ﾂｳｼﾝﾋ,,10230
2026/10/10,ﾌﾘｺﾐ ﾀﾅｶ,200000,`;

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
const rows = parseCsv(CSV);

export default function DevImportWiredPage() {
  const [mapping, setMapping] = useState<ColumnMapping>(detectColumns(rows));
  const [preview, setPreview] = useState<ImportRow[]>(() =>
    buildImportRows({
      rows,
      mapping: detectColumns(rows),
      accountId: "a1",
      candidates: series.unmatchedForecast,
      history: [],
    }),
  );

  return (
        <ImportView
          stats={buildHeaderStats(series, FIXTURE_ACCOUNTS, FIXTURE_TODAY)}
          steps={[
            { label: "口座を選ぶ", state: "done" },
            { label: "ファイルを選ぶ", state: "done" },
            { label: "列の割り当てを確かめる", state: "done" },
            { label: "一括登録", state: "current" },
          ]}
          accounts={FIXTURE_ACCOUNTS.map((a) => ({
            id: a.id,
            label: `${a.name}${a.kind === "card" ? "（カード）" : ""}`,
          }))}
          accountId="a1"
          fileName="○○銀行_2026-09.csv"
          mapping={mapping}
          columns={rows[0].map((cell, i) => ({
            value: i,
            label: `${String.fromCharCode(65 + i)}：${cell}`,
          }))}
          onMappingChange={setMapping}
          preview={preview}
          onPreviewChange={setPreview}
        />
  );
}
