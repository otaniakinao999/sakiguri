"use client";

/**
 * 要対応リスト（SC-05、AC-37、AC-38、AC-39、FR-06、FR-07、FR-46）
 *
 * 一次情報：docs/要件定義書.md §4.1.1 SC-05 実績入力の構成
 *
 * 消し込み待ちの予定と、照合候補のある実績を**1つのリスト**に混在させ、
 * 予定日の昇順で並べる。どちらも「残高が正しくない状態」を指しており、
 * 利用者の課題は同じ（消し込みを終わらせる）ためである。
 *
 * 各行は常時1操作だけを出し、残りは行を開いて出す。**行を開いた時点で、
 * 金額欄は予定額をプリフィルした編集可能な入力になっている。** 水道光熱費の
 * ように毎月額が変わる項目は頻度が高いので、押してから入力欄が出る形には
 * しない。
 *
 * 候補は**全件**出す（AC-39）。1件に絞ると、本当の相手が2件目だったときに
 * 選べない。「予定にない支出」は実績1件につき1つで、どの予定でもないことを
 * 記録する（AC-38）。
 */

import { useState } from "react";

import { categoryOf } from "@/core/categories";
import type { Account } from "@/core/types";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/inputs";
import { formatAmount, formatMonthDay } from "@/lib/format";
import type { TodoCandidateRow, TodoPlanRow, TodoRow } from "@/lib/todo-list";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";

export interface TodoActions {
  /** 予定額のまま実績にする */
  settleAsIs: (row: TodoPlanRow) => void;
  /** 金額を直して実績にする */
  settleWithAmount: (row: TodoPlanRow, amount: number) => void;
  /** 払えなかった。繰延（FR-07） */
  defer: (row: TodoPlanRow) => void;
  /** この予定と同じ取引だと確定する（FR-46） */
  linkTo: (row: TodoCandidateRow, planKey: string) => void;
  /** どの予定でもない突発の支出だと確定する（AC-38） */
  markUnplanned: (row: TodoCandidateRow) => void;
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
  /** 開いている行。1度に1行だけ開く */
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
          {rows.map((row) =>
            row.kind === "plan" ? (
              <PlanRowView
                key={row.rowKey}
                row={row}
                open={openKey === row.rowKey}
                onToggle={() =>
                  setOpenKey(openKey === row.rowKey ? null : row.rowKey)
                }
                accountName={accountName}
                actions={actions}
              />
            ) : (
              <CandidateRowView
                key={row.rowKey}
                row={row}
                open={openKey === row.rowKey}
                onToggle={() =>
                  setOpenKey(openKey === row.rowKey ? null : row.rowKey)
                }
                accountName={accountName}
                actions={actions}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ========================= 消し込み待ちの予定 ========================= */

function PlanRowView({
  row,
  open,
  onToggle,
  accountName,
  actions,
}: {
  row: TodoPlanRow;
  open: boolean;
  onToggle: () => void;
  accountName: (id: string) => string;
  actions: TodoActions;
}) {
  /* 行を開いた時点で予定額が入っている。押してから入力欄が出る形にしない */
  const [amount, setAmount] = useState(row.plan.amount);

  return (
    <>
      <tr>
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
        </td>
        <td className={`${CELL} num text-right whitespace-nowrap`}>
          {formatAmount(row.plan.amount)}
        </td>
        <td className={`${CELL} text-right`}>
          <span className="flex flex-wrap justify-end gap-4">
            <Button size="sm" color="black" onClick={() => actions.settleAsIs(row)}>
              予定どおり
            </Button>
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
          </td>
        </tr>
      )}
    </>
  );
}

/* ========================= 照合候補のある実績 ========================= */

function CandidateRowView({
  row,
  open,
  onToggle,
  accountName,
  actions,
}: {
  row: TodoCandidateRow;
  open: boolean;
  onToggle: () => void;
  accountName: (id: string) => string;
  actions: TodoActions;
}) {
  const [first, ...rest] = row.plans;
  /* 候補が1件なら開かなくても片付く。2件以上は選ばせる */
  const single = rest.length === 0;

  return (
    <>
      <tr className="bg-surface-caution-subtle">
        <td className={`${CELL} num text-object-base-mid whitespace-nowrap`}>
          {formatMonthDay(first.plan.date)}
        </td>
        <td className={CELL}>
          {first.plan.name}
          <span className="text-object-base-mid block text-body-xxs">
            {categoryOf(first.plan.categoryCode).name} ／{" "}
            {accountName(first.plan.accountId)}
          </span>
          <span className="text-object-caution-dim block text-body-xxs font-semibold">
            同じ取引かもしれない実績があります（{formatMonthDay(row.actual.date)}{" "}
            {row.actual.name}
            {single
              ? `／${first.dayGap === 0 ? "同じ日" : `${first.dayGap}日違い`}`
              : `／候補 ${row.plans.length}件`}
            ）
          </span>
        </td>
        <td className={`${CELL} num text-right whitespace-nowrap`}>
          {formatAmount(row.actual.amount)}
        </td>
        <td className={`${CELL} text-right`}>
          <span className="flex flex-wrap justify-end gap-4">
            {single && (
              <Button
                size="sm"
                color="black"
                onClick={() => actions.linkTo(row, first.plan.key)}
              >
                同じ取引
              </Button>
            )}
            <Button size="sm" onClick={onToggle} aria-expanded={open}>
              {open ? "閉じる" : single ? "ほかの操作" : "候補を選ぶ"}
            </Button>
          </span>
        </td>
      </tr>

      {open && (
        <tr className="bg-surface-overlay-hoverd">
          <td className={CELL} />
          <td className={CELL} colSpan={3}>
            <div className="flex flex-col gap-8">
              {/* 候補は全件出す（AC-39）。1件に絞ると本当の相手が選べない */}
              {row.plans.map(({ plan, dayGap }) => (
                <span key={plan.key} className="flex flex-wrap items-center gap-8">
                  <span className="num text-object-base-mid text-body-xxs">
                    {formatMonthDay(plan.date)}
                  </span>
                  <span>{plan.name}</span>
                  <span className="text-object-base-mid text-body-xxs">
                    {categoryOf(plan.categoryCode).name} ／{" "}
                    {dayGap === 0 ? "同じ日" : `${dayGap}日違い`}
                  </span>
                  <Button size="sm" onClick={() => actions.linkTo(row, plan.key)}>
                    この予定と同じ取引
                  </Button>
                </span>
              ))}

              <span className="flex flex-wrap items-center gap-8">
                <span className="text-object-base-mid text-body-xxs">
                  どの予定でもないなら、突発の支出として確定します。以後この
                  実績に候補は出ません（実績の編集から取り消せます）。
                </span>
                <Button size="sm" onClick={() => actions.markUnplanned(row)}>
                  予定にない支出
                </Button>
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
