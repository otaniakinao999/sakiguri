"use client";

/**
 * SC-06 CSV取込
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-06、§3.3 CL-7、§6.1 CSV入力仕様
 *   ファイル選択／貼付、列マッピング、確認と一括登録。
 * 対応する機能要件：FR-16
 * 対応する受入基準：AC-07
 *
 * **ファイル本体はサーバーに送らない。** 解析はすべてこの画面で行い、
 * 確定した実績だけを保存する（要件定義書 §5.1.1）。
 */

import { useMemo, useRef, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import type { Actual, ForecastInstance } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Callout } from "@/components/sakiguri/Callout";
import { Panel } from "@/components/sakiguri/Panel";
import type { StepItem } from "@/components/sakiguri/Steps";
import { buildHeaderStats } from "@/lib/header-stats";
import {
  buildImportRows,
  CSV_MAX_ROWS,
  decodeCsv,
  detectColumns,
  parseCsv,
  type ColumnMapping,
  type HistoryEntry,
  type ImportRow,
} from "@/core/csv";
import { addActuals, markReconciled, newId } from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";

import { ImportView } from "./ImportView";

/** 1ファイルの上限（要件定義書 §6.1）。 */
const MAX_BYTES = 5 * 1024 * 1024;


export function ImportScreen() {
  const { data, setData, today, session } = useAppData();

  const [accountId, setAccountId] = useState<string>("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 選んだファイルの名前。Figma 2033:890 がファイル名を出している */
  const [fileName, setFileName] = useState<string | null>(null);

  const activeAccount = accountId || data.accounts[0]?.id || "";

  /** 未消込の予定。自動照合の候補になる。残高系列は PageHeader も使う */
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
    return { series, candidates: series.unmatchedForecast };
  }, [data, today]);

  const candidates: ForecastInstance[] = computed?.candidates ?? [];

  /** 費目推定のもとになる、過去に登録した項目 */
  const history: HistoryEntry[] = useMemo(
    () =>
      [...data.recurring, ...data.oneoffs, ...data.actuals].map((item) => ({
        name: item.name,
        categoryCode: item.categoryCode,
        costType: item.costType,
        bizRatio: item.bizRatio,
      })),
    [data.recurring, data.oneoffs, data.actuals],
  );

  const reset = () => {
    setRows(null);
    setMapping(null);
    setPreview(null);
    setError(null);
    setFileName(null);
    setPasteOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const load = (text: string) => {
    setError(null);
    setNotice(null);
    try {
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setError("読み取れる行がありませんでした。");
        return;
      }
      setRows(parsed);
      setMapping(detectColumns(parsed));
      setPreview(null);
    } catch (e) {
      setError(
        e instanceof RangeError
          ? e.message
          : `解析できませんでした（上限は ${CSV_MAX_ROWS.toLocaleString("ja-JP")} 行です）。`,
      );
    }
  };

  const onFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setError(
        `ファイルが大きすぎます（${(file.size / 1024 / 1024).toFixed(1)}MB）。上限は5MBです。`,
      );
      return;
    }
    setFileName(file.name);
    /* 文字コードの判定は CL-7。UTF-8 で厳格に読み、失敗したら Shift_JIS */
    load(decodeCsv(await file.arrayBuffer()));
  };

  const read = () => {
    if (!rows || !mapping) return;
    setPreview(
      buildImportRows({
        rows,
        mapping,
        accountId: activeAccount,
        candidates,
        history,
      }),
    );
  };

  const commit = () => {
    if (!preview) return;
    const chosen = preview.filter((r) => r.include);
    const actuals: Actual[] = chosen.map((r) => ({
      id: newId(),
      key: r.matchedKey,
      date: r.date,
      name: r.name,
      type: r.type,
      costType: r.costType,
      categoryCode: r.categoryCode,
      amount: r.amount,
      bizRatio: r.bizRatio,
      accountId: r.accountId,
    }));
    /* CSV取込は、照合が1件も成立しなくても消し込み操作として数える。
       測っているのは「利用者が消し込みに向き合ったか」であって、成果の
       有無ではない（FR-43、§3.2 Settings） */
    setData((d) => {
      const next = addActuals(d, actuals);
      return today ? markReconciled(next, today) : next;
    });
    /* 件数だけを送る。金額・摘要・ファイル名は入れない（ADR-0013） */
    track(session?.user.id, "csv_imported", {
      rows: chosen.length,
      matched: chosen.filter((r) => r.matchedKey).length,
    });
    track(session?.user.id, "actual_recorded", {
      settled: chosen.some((r) => r.matchedKey),
      fromCsv: true,
    });
    setNotice(
      `${chosen.length}件を登録しました。うち${chosen.filter((r) => r.matchedKey).length}件が予定と紐づいています。`,
    );
    reset();
  };

  if (!today) return <Panel title="CSV取込">読み込み中…</Panel>;

  if (data.accounts.length === 0) {
    return (
      <Panel title="CSV取込">
        <p className="t-body text-foreground">まだ口座が登録されていません。</p>
        <p className="t-body-sm text-muted-foreground">
          先に「予定の設定」で、取り込む先の口座かカードを登録してください。
        </p>
      </Panel>
    );
  }

  /* 手順の現在地。Figma 2033:870 は4つ */
  const steps: StepItem[] = [
    { label: "口座を選ぶ", state: "done" },
    {
      label: "ファイルを選ぶ",
      state: rows ? "done" : "current",
    },
    {
      label: "列の割り当てを確かめる",
      state: preview ? "done" : rows ? "current" : "upcoming",
    },
    { label: "一括登録", state: preview ? "current" : "upcoming" },
  ];

  /* 列の選択肢。見出しがあれば見出しを、無ければ A: B: … を出す */
  const columns = (rows?.[0] ?? []).map((cell, i) => ({
    value: i,
    label: mapping?.hasHeader
      ? `${String.fromCharCode(65 + i)}：${cell}`
      : String.fromCharCode(65 + i),
  }));

  return (
    <>
      {/* ファイル選択は見えない input に任せ、見た目はボタンで出す */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />

      <ImportView
        stats={
          computed ? buildHeaderStats(computed.series, data.accounts, today) : []
        }
        steps={steps}
        accounts={data.accounts.map((a) => ({
          id: a.id,
          label: `${a.name}${a.kind === "card" ? "（カード）" : ""}`,
        }))}
        accountId={activeAccount}
        onAccountChange={setAccountId}
        fileName={fileName}
        onPickFile={() => fileRef.current?.click()}
        pasteOpen={pasteOpen}
        onTogglePaste={() => setPasteOpen((v) => !v)}
        onPaste={load}
        mapping={mapping}
        columns={columns}
        onMappingChange={setMapping}
        onRead={read}
        preview={preview}
        onPreviewChange={setPreview}
        onCommit={commit}
        notices={
          <>
            {error && <Callout tone="error">{error}</Callout>}
            {notice && <Callout tone="info">{notice}</Callout>}
          </>
        }
      />
    </>
  );
}
