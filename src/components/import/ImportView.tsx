"use client";

import * as React from "react";

import type { ImportRule, Yen } from "@/core/types";
import {
  countRuleMatches,
  editImportRowCategory,
  type ColumnMapping,
  type ImportRow,
} from "@/core/csv";
import { categoryOf } from "@/core/categories";
import { Callout } from "@/components/sakiguri/Callout";
import { PageHeader, type PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { Panel } from "@/components/sakiguri/Panel";
import { Steps, type StepItem } from "@/components/sakiguri/Steps";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
} from "@/components/sakiguri/Table";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxField } from "@/components/ui/checkbox";
import { CategorySelect, TextInput } from "@/components/ui/inputs";
import { Field, Select } from "@/components/ui/select";
import { formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ImportAccountOption {
  id: string;
  label: string;
}

export interface ImportColumnOption {
  value: number;
  label: string;
}

export interface ImportViewProps {
  stats: PageHeaderStat[];
  steps: StepItem[];

  /* 1–2. 口座とファイル */
  accounts: ImportAccountOption[];
  accountId: string;
  onAccountChange?: (id: string) => void;
  /** 選んだファイル名。未選択なら null */
  fileName: string | null;
  onPickFile?: () => void;
  /** 貼り付け欄の開閉 */
  pasteOpen?: boolean;
  onTogglePaste?: () => void;
  onPaste?: (text: string) => void;

  /* 3. 列の割り当て */
  mapping: ColumnMapping | null;
  columns: ImportColumnOption[];
  onMappingChange?: (mapping: ColumnMapping) => void;
  /** 読み取る */
  onRead?: () => void;

  /* 4. 内容を確かめて一括登録 */
  preview: ImportRow[] | null;
  onPreviewChange?: (rows: ImportRow[]) => void;
  onCommit?: () => void;

  /**
   * **この取込で使わないことにしたルール**（FR-18・AC-57b）。
   *
   * 消したわけではないことを画面に出すために渡す。空なら何も出ない。
   */
  disabledRules?: readonly Pick<ImportRule, "id" | "pattern">[];
  /** 「このルールを使わない」。その取込のあいだだけ効く（ルールは消さない） */
  onDisableRule?: (ruleId: string) => void;
  /** 「次回もこうする」で新しいルールを作る */
  onCreateRule?: (draft: {
    pattern: string;
    categoryCode: string;
    costType: ImportRule["costType"];
    bizRatio: number;
  }) => void;

  /* 差し込み口 */
  notices?: React.ReactNode;
  /** 口座が無いときなど */
  children?: React.ReactNode;
}

/** 照合列（screens.md 05）。色は success / warning で分ける */
function MatchCell({ row }: { row: ImportRow }) {
  if (row.matchHint === "matched") {
    return (
      <span className="t-table text-fg-success">
        自動で照合（{row.matchedName}）
      </span>
    );
  }
  return (
    <span className="t-table text-fg-warning">
      要対応（
      {row.matchHint === "amountDiffers" ? "金額が一致しません" : "候補がありません"}
      ）
    </span>
  );
}

/**
 * 重複列（FR-50）。
 *
 * **`MatchCell` と別にする。** あちらは「予定と照合できたか」、こちらは
 * 「実績として既に入っているか」。1つの列にまとめると、照合できなかった
 * 重複行と、照合できた新規行の区別がつかない（CLAUDE.md §2.12）。
 *
 * **色は控えめにする。** これは間違いではなく「こちらで外しました」という
 * 知らせで、利用者がすることは無い。目を引かせるべきは `要対応` のほう。
 */
function DuplicateCell({ row }: { row: ImportRow }) {
  if (!row.alreadyRegistered) return null;
  return <span className="t-table text-muted-foreground">登録済み</span>;
}

/**
 * 費目がどう決まったか（AC-57a）。
 *
 * **ルールで決まった行と推定で決まった行を書き分ける。** 区別しないと、
 * 利用者は消せるもの（ルール）と消せないもの（推定）の見分けがつかない。
 * 手で直した行はどちらでもなくなる（`editImportRowCategory` が両方を外す）。
 */
function DecidedBy({ row }: { row: ImportRow }) {
  if (row.matchedKey !== null) {
    return <span className="t-table text-muted-foreground">予定から</span>;
  }
  if (row.ruleId !== null) {
    return (
      <span className="t-table text-foreground">
        ルール（{row.rulePattern}）
      </span>
    );
  }
  if (row.guessedFrom !== null) {
    return (
      <span className="t-table text-muted-foreground">
        推定（{row.guessedFrom}）
      </span>
    );
  }
  return <span className="t-table text-muted-foreground">—</span>;
}

/**
 * CSV取込（SC-06）の見た目
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-06・§6.1、docs/design/screens.md 05
 * （Figma 2033:858）
 *
 * **ファイル本体はサーバーに送らない。** 解析はこの画面で終わり、
 * 確定した実績だけを保存する（§5.1.1）。
 *
 * **取り込む行を選べるようにしてある。** Figma の表に選択の列は無いが、
 * 既存の画面にはあり、要らない行を外せないと取り込みをやり直すしかない。
 */
export function ImportView({
  stats,
  steps,
  accounts,
  accountId,
  onAccountChange,
  fileName,
  onPickFile,
  pasteOpen,
  onTogglePaste,
  onPaste,
  mapping,
  columns,
  onMappingChange,
  onRead,
  preview,
  onPreviewChange,
  onCommit,
  disabledRules,
  onDisableRule,
  onCreateRule,
  notices,
  children,
}: ImportViewProps) {
  /** 「次回もこうする」で開いている行と、その `pattern`（AC-57e） */
  const [draft, setDraft] = React.useState<{
    rowIndex: number;
    pattern: string;
  } | null>(null);

  const chosen = preview?.filter((r) => r.include).length ?? 0;
  const duplicates = preview?.filter((r) => r.alreadyRegistered).length ?? 0;

  const setColumn = (key: keyof ColumnMapping, value: number) => {
    if (!mapping) return;
    onMappingChange?.({ ...mapping, [key]: value });
  };

  return (
    <>
      <PageHeader
        title="CSV取込"
        subtitle="銀行の明細を取り込みます。取り込むと同時に、予定との照合が自動で行われます"
        stats={stats}
      />

      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 py-24">
        <Steps steps={steps} />

        {notices}
        {children}

        {/* 1–2. 口座とファイル — 2033:880 */}
        <Panel title="1–2. 口座とファイル">
          <div className="flex flex-wrap items-end gap-24">
            {/* 固定幅だとボタンが2行目に落ちる。残りを分け合わせる */}
            <Field label="どの口座の明細か" htmlFor="import-account" className="min-w-0 flex-1">
              <Select
                id="import-account"
                value={accountId}
                onChange={(e) => onAccountChange?.(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="ファイル" className="min-w-0 flex-1">
              <div
                className={cn(
                  "flex h-control-md items-center rounded-md border border-input bg-background px-control-md t-body",
                  fileName ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="truncate">{fileName ?? "まだ選んでいません"}</span>
              </div>
            </Field>

            <Button variant="outline" onClick={onPickFile}>
              ファイルを選ぶ
            </Button>
            <Button variant="ghost" onClick={onTogglePaste}>
              中身を貼りつける
            </Button>
          </div>

          {pasteOpen ? (
            <textarea
              aria-label="CSVの中身"
              onChange={(e) => {
                if (e.target.value.trim()) onPaste?.(e.target.value);
              }}
              placeholder={"日付,摘要,入金,出金\n2026/09/25,ｽｰﾊﾟｰ ﾏﾙｴﾂ,,4820"}
              className="num min-h-80 w-full resize-y rounded-md border border-input bg-background px-control-md py-8 t-body-sm"
            />
          ) : null}

          <Callout tone="caution">
            口座を間違えると、別の口座の予定と照合してしまいます。
          </Callout>

          {/* Figma に無い。カードを選んだときの挙動はここにしか書いていない */}
          <p className="t-body-sm text-muted-foreground">
            カードを選ぶと、利用日で取り込んだうえで引き落とし日に自動で寄せます。
          </p>
        </Panel>

        {/* 3. 列の割り当て — 2033:920 */}
        {mapping ? (
          <Panel
            title="3. 列の割り当て"
            action={<Button onClick={onRead}>読み取る</Button>}
          >
            <div className="grid gap-24 wide:grid-cols-4">
              <Field label="日付の列" htmlFor="col-date">
                <Select
                  id="col-date"
                  value={mapping.date}
                  onChange={(e) => setColumn("date", Number(e.target.value))}
                >
                  {columns.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="摘要の列" htmlFor="col-name">
                <Select
                  id="col-name"
                  value={mapping.name}
                  onChange={(e) => setColumn("name", Number(e.target.value))}
                >
                  <option value={-1}>（使わない）</option>
                  {columns.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={mapping.amount >= 0 ? "金額の列" : "入金の列"}
                htmlFor="col-inflow"
              >
                <Select
                  id="col-inflow"
                  value={mapping.amount >= 0 ? mapping.amount : mapping.inflow}
                  onChange={(e) =>
                    setColumn(
                      mapping.amount >= 0 ? "amount" : "inflow",
                      Number(e.target.value),
                    )
                  }
                >
                  {columns.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={mapping.amount >= 0 ? "符号の向き" : "出金の列"}
                htmlFor="col-outflow"
              >
                {mapping.amount >= 0 ? (
                  <Select
                    id="col-outflow"
                    value={mapping.sign}
                    onChange={(e) =>
                      onMappingChange?.({
                        ...mapping,
                        sign: e.target.value as ColumnMapping["sign"],
                      })
                    }
                  >
                    <option value="outMinus">出金がマイナス</option>
                    <option value="outPlus">出金がプラス</option>
                  </Select>
                ) : (
                  <Select
                    id="col-outflow"
                    value={mapping.outflow}
                    onChange={(e) => setColumn("outflow", Number(e.target.value))}
                  >
                    {columns.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <CheckboxField
              id="single-amount"
              checked={mapping.amount >= 0}
              onCheckedChange={(checked) =>
                onMappingChange?.({
                  ...mapping,
                  amount: checked ? Math.max(mapping.inflow, 0) : -1,
                  inflow: checked ? -1 : Math.max(mapping.amount, 0),
                  outflow: checked ? -1 : mapping.outflow,
                })
              }
            >
              金額が1列にまとまっている明細（入金と出金が同じ列）
            </CheckboxField>

            <p className="t-body-sm text-muted-foreground">
              列は自動で推定していますが、目で確かめてください。Shift_JIS
              のファイルも読み込めます。
            </p>
          </Panel>
        ) : null}

        {/* 4. 内容を確かめて一括登録 — 2033:1000 */}
        {preview ? (
          <Panel
            title="4. 内容を確かめて一括登録"
            action={
              <Button disabled={chosen === 0} onClick={onCommit}>
                {chosen}件を登録する
              </Button>
            }
          >
            <Table density="compact">
              <TableHeaderRow>
                {/* Figma に無い列。要らない行を外せないとやり直すしかない */}
                <TableHead>取込</TableHead>
                <TableHead>日付</TableHead>
                <TableHead>摘要</TableHead>
                <TableHead align="right">入金</TableHead>
                <TableHead align="right">出金</TableHead>
                <TableHead>照合</TableHead>
                <TableHead>重複</TableHead>
                {/* CL-7「行ごとに費目を修正できること」。FR-18 のルールは
                    ここで直した結果から作る */}
                <TableHead>費目</TableHead>
                <TableHead>決まり方</TableHead>
              </TableHeaderRow>
              <tbody>
                {preview.flatMap((row, i) => [
                  <TableRow
                    key={row.rowIndex}
                    fixedHeight
                    last={i === preview.length - 1}
                  >
                    <TableCell>
                      <Checkbox
                        checked={row.include}
                        aria-label={`${row.name} を取り込む`}
                        onCheckedChange={(checked) =>
                          onPreviewChange?.(
                            preview.map((r) =>
                              r.rowIndex === row.rowIndex
                                ? { ...r, include: checked === true }
                                : r,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {row.date.replace(/-/g, "/")}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell align="right" className="num text-fg-success">
                      {row.type === "income" ? formatYen(row.amount) : ""}
                    </TableCell>
                    <TableCell align="right" className="num text-fg-destructive">
                      {row.type === "income" ? "" : formatYen(row.amount as Yen)}
                    </TableCell>
                    <TableCell>
                      <MatchCell row={row} />
                    </TableCell>
                    <TableCell>
                      <DuplicateCell row={row} />
                    </TableCell>
                    <TableCell>
                      <CategorySelect
                        type={row.type}
                        value={row.categoryCode}
                        onChange={(categoryCode) =>
                          onPreviewChange?.(
                            preview.map((r) =>
                              r.rowIndex === row.rowIndex
                                ? editImportRowCategory(r, categoryCode)
                                : r,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-8">
                        <DecidedBy row={row} />
                        {row.matchedKey === null ? (
                          row.ruleId !== null ? (
                            <Button
                              variant="ghost"
                              onClick={() => onDisableRule?.(row.ruleId!)}
                            >
                              このルールを使わない
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setDraft(
                                  draft?.rowIndex === row.rowIndex
                                    ? null
                                    : { rowIndex: row.rowIndex, pattern: row.name },
                                )
                              }
                            >
                              次回もこうする
                            </Button>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>,
                  draft?.rowIndex === row.rowIndex ? (
                    <TableRow key={`${row.rowIndex}-draft`} last={i === preview.length - 1}>
                      <TableCell colSpan={9} className="bg-muted">
                        <div className="flex flex-wrap items-end gap-16">
                          <Field
                            label="摘要のどこで当てるか"
                            htmlFor={`rule-pattern-${row.rowIndex}`}
                            className="min-w-0 flex-1"
                          >
                            <TextInput
                              id={`rule-pattern-${row.rowIndex}`}
                              value={draft.pattern}
                              onChange={(e) =>
                                setDraft({ rowIndex: row.rowIndex, pattern: e.target.value })
                              }
                            />
                          </Field>
                          <p className="t-body-sm text-muted-foreground">
                            {/* **広すぎる pattern を捕まえる手段**（AC-57e）。
                                狭すぎる側は次回まで分からない（仕様で受け入れ） */}
                            このファイルの
                            <strong className="font-semibold">
                              {countRuleMatches(preview, {
                                pattern: draft.pattern,
                                accountId: null,
                                direction: null,
                                categoryCode: row.categoryCode,
                              })}
                              行
                            </strong>
                            に当たります（費目は
                            {categoryOf(row.categoryCode).name}）
                          </p>
                          <Button
                            disabled={draft.pattern.trim() === ""}
                            onClick={() => {
                              onCreateRule?.({
                                pattern: draft.pattern,
                                categoryCode: row.categoryCode,
                                costType: row.costType,
                                bizRatio: row.bizRatio,
                              });
                              setDraft(null);
                            }}
                          >
                            このルールを保存する
                          </Button>
                          <Button variant="ghost" onClick={() => setDraft(null)}>
                            やめる
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ])}
              </tbody>
            </Table>

            {disabledRules && disabledRules.length > 0 ? (
              <p className="t-body-sm text-muted-foreground">
                {/* **消していないことを画面に出す**（AC-57b）。消すのは
                    設定のルール表だけ */}
                このファイルでは{disabledRules.length}件のルールを使っていません
                （{disabledRules.map((r) => r.pattern).join("、")}）。
                ルールは消えていないので、次の取込では また当たります。
              </p>
            ) : null}

            {duplicates > 0 ? (
              <p className="t-body-sm text-fg-warning">
                同じ内容が既に登録されている{duplicates}件は、あらかじめ「取込」を
                外してあります。口座・日付・収支・金額・摘要が
                <strong className="font-semibold">すべて</strong>一致した行だけです。
                入れ直すこともできます。
              </p>
            ) : null}
            <p className="t-body-sm text-muted-foreground">
              金額が完全に一致し、日付の差が12日以内で、口座も同じ予定は、
              その場で消し込まれて「やること」には出ません。
            </p>
            <p className="t-body-sm text-muted-foreground">
              CSVのファイル自体はサーバーに保存しません。読み取った結果だけを登録します。
            </p>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
