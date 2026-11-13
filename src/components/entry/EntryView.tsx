"use client";

import * as React from "react";

import type { Yen } from "@/core/types";
import { Amount } from "@/components/sakiguri/Amount";
import { CategoryTag } from "@/components/sakiguri/CategoryTag";
import { PageHeader, type PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { Panel } from "@/components/sakiguri/Panel";
import { TodoRow } from "@/components/sakiguri/TodoRow";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/format";

import type { EntryTodoRow, RowBase } from "./rows";

export type {
  EntryActualRow,
  EntryCandidateRow,
  EntryMonth,
  EntryPlanRow,
  EntryTodoRow,
  RowBase,
} from "./rows";

/* ---------------------------------------------------------------- 型 */

export interface EntryViewProps {
  stats: PageHeaderStat[];
  headerAction?: React.ReactNode;

  todoCount: number;
  todos: EntryTodoRow[];
  /** 開いている［ほかの操作］の行。1度に1行だけ */
  openRowId?: string | null;

  onSettleAsIs?: (id: string) => void;
  onToggleOther?: (id: string) => void;
  onSettleWithAmount?: (id: string, amount: Yen) => void;
  /**
   * 「払えなかった」（繰延）。**打った額を一緒に渡す**（AC-59）。
   *
   * ［実際の金額］に打った額が捨てられていて、繰延の画面では予定の額が
   * 出ていた。一部だけ払えた回を繰延するのに、同じ額を2度打つことに
   * なっていた。打っていなければ `undefined`。
   */
  onDefer?: (id: string, amount?: Yen) => void;
  onLink?: (rowId: string, candidateId: string) => void;
  onUnplanned?: (id: string) => void;

  /* 差し込み口。v0.6.0 に無いもの（ADR-0023） */
  notices?: React.ReactNode;
  todoFooter?: React.ReactNode;
  /** やることの見出しに出す操作。手入力（§4.1.1） */
  todoAction?: React.ReactNode;
  /** 実績一覧への導線（FR-54） */
  footer?: React.ReactNode;
  dialog?: React.ReactNode;
}

/* ------------------------------------------------------------ 小物 */

/** ［ほかの操作］の中身（Figma 2032:845）。金額の訂正と繰延 */
function OtherActions({
  defaultAmount,
  onRecord,
  onDefer,
}: {
  defaultAmount: Yen;
  onRecord?: (amount: Yen) => void;
  onDefer?: (amount?: Yen) => void;
}) {
  /* 桁区切りを付けて出す。Figma 2032:850 は「10,230」 */
  const [text, setText] = React.useState(formatAmount(defaultAmount));
  const parsed = Number(text.replace(/[^0-9-]/g, ""));
  const valid = Number.isFinite(parsed) && text.trim() !== "";

  return (
    <div className="mb-12 flex flex-wrap items-end gap-12 rounded-md bg-muted p-16">
      <label className="flex flex-col gap-4">
        <span className="t-label-sm text-muted-foreground">実際の金額</span>
        <input
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="num h-control-md w-amount rounded-md border border-border bg-background px-control-md t-body"
        />
      </label>
      <Button disabled={!valid} onClick={() => valid && onRecord?.(parsed)}>
        この金額で記録
      </Button>
      {/* **ここで打った額を繰延に渡す**（AC-59）。触っていなければ
          `defaultAmount` のままなので、渡しても予定の額と同じになる */}
      <Button variant="outline" onClick={() => onDefer?.(valid ? parsed : undefined)}>
        払えなかった
      </Button>
      <p className="t-body-sm text-muted-foreground">
        金額の訂正と「払えなかった」は［ほかの操作］の中にあります。
      </p>
    </div>
  );
}

/** 照合の候補（Figma 2032:800）。bg-primary-subtle の帯 */
function CandidateBox({
  candidates,
  onLink,
}: {
  candidates: RowBase[];
  onLink?: (candidateId: string) => void;
}) {
  return (
    <div className="mb-12 flex flex-col gap-8 rounded-md bg-primary-subtle p-16">
      <p className="t-body-sm text-fg-primary">
        照合の候補：金額が完全に一致し、日付の差が12日以内で、口座も同じ予定です
      </p>
      {candidates.map((c) => (
        <div key={c.id} className="flex items-center gap-12">
          <span className="num w-48 shrink-0 t-table text-muted-foreground">{c.date}</span>
          <span className="min-w-0 flex-1 truncate t-body text-foreground">{c.title}</span>
          <Amount
            value={c.display.value}
            type={c.display.type}
            signed={c.display.signed}
            size="body"
            className="shrink-0"
          />
          {c.category ? <CategoryTag category={c.category} /> : null}
          <Button size="sm" onClick={() => onLink?.(c.id)}>
            この予定と照合
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ 本体 */

/**
 * やること（SC-05 実績入力）の見た目
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、docs/design/screens.md 04
 * （Figma 2032:753）
 *
 * **計算をしない。** 値はすべて props で受け取る。
 *
 * 行は2種類。消し込まれていない予定（plan）と、照合されていない実績
 * （candidate）。操作5つは既存の TodoActions と1対1で対応する。
 * 「払えなかった」が繰延（FR-07）。
 *
 * **実績一覧は別のページにある**（FR-54・AC-61）。1つのページに並べて
 * いたので、やることを片付けるあいだも長い一覧が下に付いていた。
 * **照合の候補はこちらに置く** ―― 未照合の実績を予定に結びつけるのは、
 * やることを片付ける操作である。
 */
export function EntryView({
  stats,
  headerAction,
  todoCount,
  todos,
  openRowId,
  onSettleAsIs,
  onToggleOther,
  onSettleWithAmount,
  onDefer,
  onLink,
  onUnplanned,
  notices,
  todoFooter,
  todoAction,
  footer,
  dialog,
}: EntryViewProps) {
  return (
    <>
      <PageHeader
        title="実績入力"
        subtitle="予定どおりだったか、違ったかを記録します。CSVで取り込んだ実績はここで予定と照合します"
        stats={stats}
        action={headerAction}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-24 bg-muted px-16 py-24 wide:px-32">
        {/* やること — 2032:760 */}
        <Panel title="やること" count={`${todoCount}件`} action={todoAction}>
          <p className="t-body-sm text-muted-foreground">
            予定日の古い順に、2種類の行が並びます。どちらも残高が正しくない状態です。
          </p>

          {notices}

          {todos.length === 0 ? (
            <p className="py-24 text-center t-body-sm text-muted-foreground">
              要対応はありません。
            </p>
          ) : (
            <div>
              {todos.map((row, i) => (
                <TodoRow
                  key={row.id}
                  date={row.date}
                  title={row.title}
                  /* 資金移動の向き（FR-63・AC-70） */
                  detail={row.direction}
                  amount={row.display.value}
                  amountType={row.display.type}
                  signed={row.display.signed}
                  category={row.category}
                  status={row.kind === "plan" ? "予定" : "実績"}
                  last={i === todos.length - 1}
                  actions={
                    row.kind === "plan" ? (
                      <>
                        <Button size="sm" onClick={() => onSettleAsIs?.(row.id)}>
                          予定どおり
                        </Button>
                        <Button
                          variant={openRowId === row.id ? "secondary" : "outline"}
                          size="sm"
                          aria-expanded={openRowId === row.id}
                          onClick={() => onToggleOther?.(row.id)}
                        >
                          ほかの操作
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUnplanned?.(row.id)}
                      >
                        予定にない取引として登録
                      </Button>
                    )
                  }
                >
                  {row.kind === "candidate" && row.candidates.length > 0 ? (
                    <CandidateBox
                      candidates={row.candidates}
                      onLink={(candidateId) => onLink?.(row.id, candidateId)}
                    />
                  ) : null}

                  {row.kind === "plan" && openRowId === row.id ? (
                    <OtherActions
                      defaultAmount={row.amount}
                      onRecord={(amount) => onSettleWithAmount?.(row.id, amount)}
                      onDefer={(amount) => onDefer?.(row.id, amount)}
                    />
                  ) : null}
                </TodoRow>
              ))}
            </div>
          )}

          {todoFooter}

          <p className="t-body-sm text-muted-foreground">
            照合すると、費目・固定変動の区分・事業割合は予定から引き継ぎ、
            日付・金額・口座は実績の値を使います。
          </p>
          <p className="t-body-sm text-muted-foreground">
            金額が1円でも違えば候補になりません。迷う行は触らずに残してください。
          </p>
        </Panel>

        {footer}
      </div>

      {dialog}
    </>
  );
}
