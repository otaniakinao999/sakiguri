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
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/inputs";
import { Notification } from "@/components/ui/Notification";
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
import { addActuals, newId } from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";

import { ColumnMappingForm } from "./ColumnMappingForm";
import { ImportPreviewTable } from "./ImportPreviewTable";

/** 1ファイルの上限（要件定義書 §6.1）。 */
const MAX_BYTES = 5 * 1024 * 1024;

const PLACEHOLDER = `日付,摘要,入金,出金
2026/09/25,ｽｰﾊﾟｰ ﾏﾙｴﾂ,,4820
2026/09/25,ｶ)ｴｰｼﾔ ｷﾞﾖｳﾑｲﾀｸ,450000,`;

export function ImportScreen() {
  const { data, setData, today, session } = useAppData();

  const [accountId, setAccountId] = useState<string>("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeAccount = accountId || data.accounts[0]?.id || "";

  /** 未消込の予定。自動照合の候補になる */
  const candidates: ForecastInstance[] = useMemo(() => {
    if (!today || data.accounts.length === 0) return [];
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
    return buildBalanceSeries(
      { accounts: data.accounts, asOf: data.asOf, forecast, actuals: data.actuals },
      to,
      today,
    ).unmatchedForecast;
  }, [data, today]);

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
    setData((d) => addActuals(d, actuals));
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

  if (!today) return <Card title="CSV取込">読み込み中…</Card>;

  if (data.accounts.length === 0) {
    return (
      <Card title="CSV取込">
        <p className="text-object-base-high text-body-sm leading-normal">
          まだ口座が登録されていません。
        </p>
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          先に「予定の設定」で、取り込む先の口座かカードを登録してください。
        </p>
      </Card>
    );
  }

  const matched = preview?.filter((r) => r.matchedKey).length ?? 0;
  const chosen = preview?.filter((r) => r.include).length ?? 0;

  return (
    <div className="flex flex-col gap-12">
      {error && <Notification variant="error">{error}</Notification>}
      {notice && <Notification>{notice}</Notification>}

      {/* ---------- 1. ファイル ---------- */}
      <Card title="1. ファイルを選ぶ">
        <div className="grid gap-8 wide:grid-cols-2">
          <Field label="取り込む口座・カード">
            {(id) => (
              <Select
                id={id}
                value={activeAccount}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.kind === "card" ? "（カード）" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="CSVファイル" hint="Shift_JIS のファイルもそのまま読めます">
            {(id) => (
              <input
                id={id}
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
                className="border-border-base-high bg-surface-base-primary text-object-base-high w-full rounded-base border px-8 py-4 text-body-xs"
              />
            )}
          </Field>
        </div>

        <div className="mt-12">
          <Field label="貼り付けでも取り込めます">
            {(id) => (
              <textarea
                id={id}
                placeholder={PLACEHOLDER}
                onChange={(e) => {
                  if (e.target.value.trim()) load(e.target.value);
                }}
                className="border-border-base-high bg-surface-base-primary text-object-base-high num min-h-[var(--layout-paste-height)] w-full resize-y rounded-base border px-8 py-4 text-body-xxs"
              />
            )}
          </Field>
        </div>

        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          カードを選ぶと、利用日で取り込んだうえで引き落とし日に自動で寄せます。
          <strong className="font-semibold">
            ファイル本体はサーバーに送りません。
          </strong>
          この画面で解析し、確定した明細だけを保存します。
        </p>
      </Card>

      {/* ---------- 2. 列の対応づけ ---------- */}
      {rows && mapping && (
        <Card
          title="2. 列を対応づける"
          right={
            <Button size="sm" color="black" onClick={read}>
              読み取る
            </Button>
          }
        >
          <ColumnMappingForm
            rows={rows}
            mapping={mapping}
            onChange={setMapping}
          />
        </Card>
      )}

      {/* ---------- 3. 確認して取り込む ---------- */}
      {preview && (
        <Card
          title={`3. 確認して取り込む（${preview.length}件・うち予定と一致 ${matched}件）`}
          right={
            <Button
              size="sm"
              color="black"
              disabled={chosen === 0}
              onClick={commit}
            >
              {chosen}件を登録
            </Button>
          }
        >
          <ImportPreviewTable rows={preview} onChange={setPreview} />
        </Card>
      )}
    </div>
  );
}
