"use client";

/**
 * 要対応リスト（SC-05、AC-37、FR-06、FR-07、FR-46）
 *
 * 一次情報：docs/要件定義書.md §4.1.1 SC-05 実績入力の構成
 *
 * 消し込み待ちの予定と、照合候補のある実績を**1つのリスト**に混在させ、
 * 予定日の昇順で並べる。どちらも「残高が正しくない状態」を指しており、
 * 利用者の課題は同じ（消し込みを終わらせる）ためである。
 *
 * 各行は「予定どおり」に相当する操作だけを常時表示し、残りは行を開いて
 * 出す。**行を開いた時点で、金額欄は予定額をプリフィルした編集可能な
 * 入力になっている。** 水道光熱費のように毎月額が変わる項目は頻度が
 * 高いので、「金額を直す」を押してから入力欄が出る形にはしない。
 */

import { useState } from "react";

import { categoryOf } from "@/core/categories";
import type { Account } from "@/core/types";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/inputs";
import { formatAmount, formatMonthDay } from "@/lib/format";
import type { TodoRow } from "@/lib/todo-list";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";

export interface TodoActions {
  /** 予定額のまま実績にする */
  settleAsIs: (row: Extract<TodoRow, { kind: "plan" }>) => void;
  /** 金額を直して実績にする */
  settleWithAmount: (
    row: Extract<TodoRow, { kind: "plan" }>,
    amount: number,
  ) => void;
  /** 払えなかった。繰延（FR-07） */
  defer: (row: Extract<TodoRow, { kind: "plan" }>) => void;
  /** 候補を確定して紐づける（FR-46） */
  linkCandidate: (row: Extract<TodoRow, { kind: "candidate" }>) => void;
  /** 別の取引だとして候補を却下する */
  dismissCandidate: (row: Extract<TodoRow, { kind: "candidate" }>) => void;
}

export function TodoTable({
  rows,
  accounts,
  actions,
}: {
  rows: TodoRow[];
  accounts: Account[];
  actions: TodoActions;
}) {
  /** 開いている行のキー。1度に1行だけ開く */
  const [openKey, setOpenKey] = useState<string | null>(null);

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? "—";

  if (rows.length === 0) {
    return (
      <p className="text-object-base-mid py-24 text-center text-body-xs">
        対応が必要なものはありません。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-xs">
        <tbody>
          {rows.map((row) => {
            const open = openKey === row.plan.key;
            return (
              <TodoRowView
                key={row.plan.key}
                row={row}
                open={open}
                onToggle={() => setOpenKey(open ? null : row.plan.key)}
                accountName={accountName}
                actions={actions}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TodoRowView({
  row,
  open,
  onToggle,
  accountName,
  actions,
}: {
  row: TodoRow;
  open: boolean;
  onToggle: () => void;
  accountName: (id: string) => string;
  actions: TodoActions;
}) {
  /* 行を開いた時点で予定額が入っている。押してから入力欄が出る形にしない */
  const [amount, setAmount] = useState(row.plan.amount);

  const candidate = row.kind === "candidate";

  return (
    <>
      <tr className={candidate ? "bg-surface-caution-subtle" : ""}>
        <td className={`${CELL} num text-object-base-mid whitespace-nowrap`}>
          {formatMonthDay(row.plan.date)}
          {row.plan.origDate && (
            <span className="block text-body-xxs">
              ←{formatMonthDay(row.plan.origDate)}
            </span>
          )}
        </td>
        <td className={CELL}>
          {row.plan.name}
          <span className="text-object-base-mid block text-body-xxs">
            {categoryOf(row.plan.categoryCode).name} ／{" "}
            {accountName(row.plan.accountId)}
          </span>
          {candidate && (
            <span className="text-object-caution-dim block text-body-xxs font-semibold">
              同じ取引かもしれない実績があります（
              {formatMonthDay(row.actual.date)} {row.actual.name}／
              {row.dayGap === 0 ? "同じ日" : `${row.dayGap}日違い`}）
            </span>
          )}
        </td>
        <td className={`${CELL} num text-right whitespace-nowrap`}>
          {formatAmount(row.plan.amount)}
        </td>
        <td className={`${CELL} text-right`}>
          <span className="flex flex-wrap justify-end gap-4">
            {/* 常時出すのは1つだけ。残りは行を開いて出す */}
            {row.kind === "plan" ? (
              <Button size="sm" color="black" onClick={() => actions.settleAsIs(row)}>
                予定どおり
              </Button>
            ) : (
              <Button
                size="sm"
                color="black"
                onClick={() => actions.linkCandidate(row)}
              >
                同じ取引
              </Button>
            )}
            <Button size="sm" onClick={onToggle} aria-expanded={open}>
              {open ? "閉じる" : "ほかの操作"}
            </Button>
          </span>
        </td>
      </tr>

      {open && (
        <tr className="bg-surface-overlay-hoverd">
          <td className={CELL} />
          <td className={CELL} colSpan={3}>
            {row.kind === "plan" ? (
              <span className="flex flex-wrap items-center gap-8">
                <label className="text-object-base-mid text-body-xxs">
                  実際の金額
                </label>
                <span className="w-[var(--layout-field-width)]">
                  <NumberInput
                    aria-label="実際の金額"
                    value={amount}
                    onValueChange={setAmount}
                  />
                </span>
                <Button
                  size="sm"
                  color="black"
                  disabled={amount === 0}
                  onClick={() => actions.settleWithAmount(row, amount)}
                >
                  この金額で記録
                </Button>
                <Button size="sm" color="line_gray" onClick={() => actions.defer(row)}>
                  払えなかった
                </Button>
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-8">
                <span className="text-object-base-mid text-body-xxs">
                  別の取引なら候補を消せます。予定は消し込み待ちに戻ります。
                </span>
                <Button size="sm" onClick={() => actions.dismissCandidate(row)}>
                  別の取引
                </Button>
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
