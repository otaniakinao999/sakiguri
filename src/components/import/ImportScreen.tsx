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

import { buildBalanceSeries, depositIdsOf } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { checkImportBalance } from "@/core/balance-check";
import type { Actual, ForecastInstance, ImportRule } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Callout } from "@/components/sakiguri/Callout";
import { Panel } from "@/components/sakiguri/Panel";
import type { StepItem } from "@/components/sakiguri/Steps";
import { balanceCheckMessage } from "@/lib/balance-check-message";
import {
  pickImportAccount,
  readImportAccount,
  writeImportAccount,
} from "@/lib/import-account";
import { buildHeaderStats } from "@/lib/header-stats";
import {
  actualFromImportRow,
  buildImportRows,
  CSV_MAX_ROWS,
  decodeCsv,
  detectColumns,
  parseCsv,
  redecideWithoutRule,
  ruleFromImport,
  sameMatchKey,
  type ColumnMapping,
  type HistoryEntry,
  type ImportRow,
} from "@/core/csv";
import { categoryOf } from "@/core/categories";
import { addActuals, addRule, markReconciled, newId } from "@/lib/mutations";
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

  /**
   * **取込先の口座**（FR-60・AC-67）。前回選んだ口座のまま開く。
   *
   * **効果で後から直さない。** 最初の描画でいちばん上の口座を出してから
   * 効果で入れ替えると、その一瞬のあいだに「読み取る」を押せてしまう。
   * 選ぶのは描画のたびに `pickImportAccount` が決める（純関数）。
   *
   * `remembered` を `useMemo` で持つのは、読み出しを毎回の描画でやらない
   * ためだけである。値は `localStorage` にあり、書くのは下の `chooseAccount`。
   */
  const remembered = useMemo(
    () => readImportAccount(session?.user.id),
    [session?.user.id],
  );
  const activeAccount = pickImportAccount(accountId, remembered, data.accounts);

  /** 選び直したら覚える。覚えられなくても取込は続けられる */
  const chooseAccount = (id: string) => {
    setAccountId(id);
    writeImportAccount(session?.user.id, id);
  };

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

  /**
   * **この取込で使わないことにしたルールの id**（AC-57b）。
   *
   * 画面の状態であって保存しない。ルールそのものは消さないので、次の
   * 取込では また当たる。
   */
  const [disabledRuleIds, setDisabledRuleIds] = useState<string[]>([]);
  const activeRules = useMemo(
    () => data.rules.filter((r) => !disabledRuleIds.includes(r.id)),
    [data.rules, disabledRuleIds],
  );

  const read = () => {
    if (!rows || !mapping) return;
    setPreview(
      buildImportRows({
        rows,
        mapping,
        accountId: activeAccount,
        candidates,
        history,
        /* 既に保存されている実績との突き合わせ（FR-50）。口座での絞り込みは
           core 側でやるので全件渡す */
        existing: data.actuals,
        /* 仕分けルール（CL-10）。使わないことにしたぶんは除いて渡す */
        rules: activeRules,
      }),
    );
  };

  /**
   * 「このルールを使わない」（AC-57b）。
   *
   * **決め直すのは、そのルールで決まっていた行だけ。** 取込行を作り直すと、
   * ここまでに手で直した費目も、外した取込のチェックも全部消える。
   */
  const disableRule = (ruleId: string) => {
    const remaining = activeRules.filter((r) => r.id !== ruleId);
    setDisabledRuleIds((ids) => [...ids, ruleId]);
    setPreview((rows) =>
      rows ? redecideWithoutRule(rows, ruleId, remaining, history) : rows,
    );
  };

  /**
   * 「次回もこうする」（CL-10・AC-57e / AC-57c）。
   *
   * **ルールの組み立ては core の `ruleFromImport`。** `accountId` は
   * **取込先の口座**にする ―― 当たる行数はこの取込（＝その口座）から数える
   * ので、全口座のルールにすると表示した数より広く当たる（要件定義書 §3.3）。
   */
  const createRule = (draft: {
    pattern: string;
    categoryCode: string;
    costType: ImportRule["costType"];
    bizRatio: number;
  }) => {
    const rule = ruleFromImport(draft, activeAccount, newId());
    /* 当たる条件が同じルールは増やさず上書きする（`addRule`）。
       黙って変わると「作ったのに1件のまま」に見えるので、文言を分ける */
    const replaced = data.rules.some((r) => sameMatchKey(r, rule));
    setData((d) => addRule(d, rule));
    track(session?.user.id, "import_rule_created", {
      patternLength: [...rule.pattern].length,
      fromImport: true,
    });
    setNotice(
      replaced
        ? `当たる条件が同じルールがあったので、費目を${categoryOf(rule.categoryCode).name}に差し替えました。`
        : `ルールを保存しました。「${rule.pattern}」を含む行は、次回から${categoryOf(rule.categoryCode).name}になります。`,
    );
  };

  /**
   * **残高での検算**（FR-61・AC-68）。
   *
   * 「取込後にこの口座に在ることになる実績」を渡す ―― 保存済みの全件と、
   * いま取込のチェックが入っている行である。**登録したあとは保存済みが
   * それを含むので、同じ関数に同じ値が入り、出る額も同じになる。**
   * 画面に出した額と、登録後の残高が違うということが起きない。
   *
   * 取込行から実績への変換は `actualFromImportRow` が1箇所で持つ（§2.8）。
   * `id` は検算では読まないので空で渡す。
   */
  const balanceCheck = useMemo(() => {
    if (!preview || !computed) return null;
    return checkImportBalance({
      rows: preview,
      existing: data.actuals,
      accountId: activeAccount,
      /* 現預金の集合は系列から引く（`depositIdsOf`）。口座一覧から
         組み直すと、違う集合で足すことになる */
      deposits: new Set(depositIdsOf(computed.series)),
    });
  }, [preview, computed, data.actuals, activeAccount]);

  const commit = () => {
    if (!preview) return;
    const chosen = preview.filter((r) => r.include);
    const actuals: Actual[] = chosen.map((r) => actualFromImportRow(r, newId()));
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
    /* **検算の結果を登録後にも残す**（AC-68）。`reset()` で確認画面が
       消えるので、ここで文に入れないと差額が見えなくなる。**文の組み立ては
       `balanceCheckMessage` が1箇所で持つ**（§2.8） */
    const checked = balanceCheckMessage(balanceCheck);
    setNotice(
      `${chosen.length}件を登録しました。うち${chosen.filter((r) => r.matchedKey).length}件が予定と紐づいています。` +
        (checked ? ` ${checked.text}` : ""),
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
        onAccountChange={chooseAccount}
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
        /* 残高での検算（FR-61・AC-68）。列が無ければ null で、何も出ない */
        balanceCheck={balanceCheckMessage(balanceCheck)}
        disabledRules={data.rules.filter((r) => disabledRuleIds.includes(r.id))}
        onDisableRule={disableRule}
        onCreateRule={createRule}
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
