"use client";

/**
 * 入出金予定表（FR-12、SC-03）
 *
 * 一次情報：docs/要件定義書.md §4.2 入出金予定表の詳細要件
 *
 * 明細を年月ごとにグループ化し、見出し行に 件数・入金計・出金計・
 * 月末残高・月中最低（警告時）を表示する。見出し行のクリックで折りたたむ。
 */

import { Fragment, useState } from "react";

import { categoryOf } from "@/core/categories";
import type { Account } from "@/core/types";
import { Button } from "@/components/ui/Button";
import { KindTag, RatioTag, StatusTag } from "@/components/ui/Tag";
import { formatAmount, formatMonthDay, MINUS } from "@/lib/format";
import type { LedgerMonthGroup, LedgerView } from "@/lib/ledger";
import { formatYearMonthLabel } from "@/lib/format";

const CELL = "border-b-border-base-low border-b px-12 py-8 whitespace-nowrap";
const HEAD =
  "bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-12 py-8 text-body-xxs font-semibold tracking-wide whitespace-nowrap";

function GroupHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: LedgerMonthGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="bg-surface-accent-subtle">
      <td colSpan={9} className="border-b-border-base-low border-b p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="hover:bg-surface-overlay-selected flex w-full flex-wrap items-center gap-x-16 gap-y-4 px-12 py-8 text-left"
        >
          <span className="font-semibold">
            {collapsed ? "▸" : "▾"} {formatYearMonthLabel(group.yearMonth)}
          </span>
          <span className="text-object-base-mid text-body-xxs">
            {group.count}件
            {/* 過去月は「何件あるか」より「実態がどこまで入っているか」が
                知りたい情報になる（要件定義書 §4.2 過去月の表示） */}
            {group.past && `（実績 ${group.actualCount}件）`}
          </span>
          {group.overdueCount > 0 && (
            <span className="text-object-error-dim text-body-xxs font-semibold">
              未入力 {group.overdueCount}件
            </span>
          )}
          <span className="num text-body-xxs">
            <span className="text-object-success-bright">
              +{formatAmount(group.inflow)}
            </span>{" "}
            <span className="text-object-error-dim">
              {MINUS}
              {formatAmount(group.outflow)}
            </span>
          </span>
          {group.closing !== null && (
            <span className="num text-object-base-mid text-body-xxs">
              月末残高{" "}
              <span
                className={
                  group.closing < 0 ? "text-object-error-dim" : "text-object-base-high"
                }
              >
                {formatAmount(group.closing)}
              </span>
            </span>
          )}
          {group.warning && (
            <span className="num text-object-error-dim text-body-xxs">
              月中最低 {formatAmount(group.warning.balance)}（
              {formatMonthDay(group.warning.date)}
              {group.warning.kind === "shortfall"
                ? " 資金ショート"
                : " 防衛ライン割れ"}
              ）
            </span>
          )}
        </button>
      </td>
    </tr>
  );
}

export function LedgerTable({
  view,
  accounts,
  onEditActual,
}: {
  view: LedgerView;
  accounts: Account[];
  /**
   * 実績行の「編集」を押したとき（FR-41）。
   *
   * 入出金予定表は実績の編集の入口の1つ。もう1つは実績入力画面の
   * 「最近の実績」一覧。渡さなければボタンを出さない。
   */
  onEditActual?: (actualId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? "—";

  const allCollapsed = Object.values(collapsed).filter(Boolean).length > 0;
  const toggleAll = () =>
    setCollapsed(
      allCollapsed
        ? {}
        : Object.fromEntries(view.groups.map((g) => [g.yearMonth, true])),
    );

  if (view.groups.length === 0) {
    return (
      <p className="text-object-base-mid py-24 text-center text-body-xs">
        この条件に合う入出金はありません。
      </p>
    );
  }

  return (
    <>
      <div className="mb-12">
        <button
          type="button"
          onClick={toggleAll}
          className="border-border-base-high bg-surface-base-primary text-object-base-high hover:bg-surface-overlay-hoverd rounded-base border px-16 py-8 text-body-xs font-semibold"
        >
          {allCollapsed ? "すべて展開" : "すべて折りたたむ"}
        </button>
      </div>

      <div className="max-h-[var(--layout-ledger-height)] overflow-auto">
        <table className="w-full border-collapse text-body-xs leading-normal">
          <thead>
            <tr>
              <th className={`${HEAD} text-left`}>日付</th>
              <th className={`${HEAD} text-left`}>内容</th>
              <th className={`${HEAD} text-left`}>区分</th>
              <th className={`${HEAD} text-left`}>費目</th>
              <th className={`${HEAD} text-left`}>口座</th>
              <th className={`${HEAD} num text-right`}>入出金</th>
              <th className={`${HEAD} num text-right`}>残高</th>
              <th className={`${HEAD} text-left`}>状態</th>
              <th className={HEAD} />
            </tr>
          </thead>
          <tbody>
            {view.groups.map((group) => (
              <Fragment key={group.yearMonth}>
                <GroupHeader
                  group={group}
                  collapsed={Boolean(collapsed[group.yearMonth])}
                  onToggle={() =>
                    setCollapsed((c) => ({
                      ...c,
                      [group.yearMonth]: !c[group.yearMonth],
                    }))
                  }
                />
                {!collapsed[group.yearMonth] &&
                  group.entries.map((entry, index) => (
                    <tr
                      key={`${entry.key}_${index}`}
                      /* 未入力（今日より前の未消込）を最優先で目立たせる。
                         繰延の黄と区別できるよう error 系にする（§1.3 で
                         error は purple） */
                      className={
                        entry.overdue
                          ? "bg-surface-error-subtle"
                          : entry.deferred
                            ? "bg-surface-caution-subtle"
                            : ""
                      }
                    >
                      <td className={`${CELL} num text-object-base-mid`}>
                        {formatMonthDay(entry.date)}
                        {entry.origDate && (
                          <span className="text-object-base-mid text-body-xxs">
                            {" "}
                            ←{formatMonthDay(entry.origDate)}
                          </span>
                        )}
                      </td>
                      <td className={CELL}>{entry.name}</td>
                      <td className={CELL}>
                        <span className="flex gap-4">
                          <KindTag event={entry} />
                          <RatioTag bizRatio={entry.bizRatio} />
                        </span>
                      </td>
                      <td className={`${CELL} text-object-base-mid`}>
                        {categoryOf(entry.categoryCode).name}
                      </td>
                      <td className={`${CELL} text-object-base-mid`}>
                        {accountName(entry.accountId)}
                      </td>
                      <td
                        className={`${CELL} num text-right ${
                          entry.type === "income"
                            ? "text-object-success-bright"
                            : entry.type === "transfer"
                              ? "text-object-base-mid"
                              : ""
                        }`}
                      >
                        {entry.type === "transfer"
                          ? "±"
                          : entry.type === "income"
                            ? "+"
                            : MINUS}
                        {formatAmount(entry.amount)}
                      </td>
                      <td
                        className={`${CELL} num text-right ${
                          entry.balance < 0 ? "text-object-error-dim" : ""
                        }`}
                      >
                        {formatAmount(entry.balance)}
                      </td>
                      <td className={CELL}>
                        <StatusTag status={entry.status} />
                        {entry.overdue && (
                          <span className="text-object-error-dim block text-body-xxs font-semibold">
                            未入力
                          </span>
                        )}
                      </td>
                      <td className={`${CELL} text-right`}>
                        {entry.status === "actual" && entry.srcId && onEditActual && (
                          <Button
                            size="sm"
                            onClick={() => onEditActual(entry.srcId!)}
                          >
                            編集
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        カード払いの明細はここには出ません。締め日ごとにまとまった「引落」として
        現れます。月の見出しを押すと折りたためます。
        「未入力」は、その日が過ぎたのに実績が入っていない予定です。予定額の
        まま予測に残っているので、実績を入れて消し込むか、支払日をずらして
        ください。
      </p>
    </>
  );
}
