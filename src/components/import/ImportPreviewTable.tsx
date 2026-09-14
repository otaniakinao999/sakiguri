"use client";

/**
 * 取込前の確認（CL-7）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-7「確認画面」
 *   取込前に全行を一覧表示し、行ごとに 取込可否・収支・固定変動・費目・
 *   事業割合 を修正できること。**自動照合された行は照合先を明示すること。**
 */

import type { ImportRow } from "@/core/csv";
import type { EntryType } from "@/core/types";
import {
  CategorySelect,
  fitCategory,
  NumberInput,
  Select,
} from "@/components/ui/inputs";
import { Tag } from "@/components/ui/Tag";
import { formatAmount, formatMonthDay, MINUS } from "@/lib/format";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";
const HEAD =
  "bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-8 py-8 text-left text-body-xxs font-semibold tracking-wide whitespace-nowrap";

export function ImportPreviewTable({
  rows,
  onChange,
}: {
  rows: ImportRow[];
  onChange: (rows: ImportRow[]) => void;
}) {
  const patch = (rowIndex: number, value: Partial<ImportRow>) =>
    onChange(
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const next = { ...r, ...value };
        if (value.type) {
          next.costType =
            value.type === "expense" ? (r.costType ?? "variable") : null;
          next.categoryCode = fitCategory(value.type, r.categoryCode);
        }
        return next;
      }),
    );

  const allIncluded = rows.every((r) => r.include);
  const toggleAll = () =>
    onChange(rows.map((r) => ({ ...r, include: !allIncluded })));

  return (
    <>
      <div className="max-h-[var(--layout-ledger-height)] overflow-auto">
        <table className="w-full border-collapse text-body-xs">
          <thead>
            <tr>
              <th className={HEAD}>
                <input
                  type="checkbox"
                  checked={allIncluded}
                  aria-label="すべて取り込む"
                  onChange={toggleAll}
                />
              </th>
              <th className={HEAD}>日付</th>
              <th className={`${HEAD} min-w-[var(--layout-field-width)]`}>摘要</th>
              <th className={`${HEAD} text-right`}>金額</th>
              <th className={HEAD}>収支</th>
              <th className={HEAD}>固定/変動</th>
              <th className={HEAD}>費目</th>
              <th className={HEAD}>事業%</th>
              <th className={HEAD}>消し込み先</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowIndex} className={row.include ? "" : "opacity-50"}>
                <td className={CELL}>
                  <input
                    type="checkbox"
                    checked={row.include}
                    aria-label={`${row.name} を取り込む`}
                    onChange={(e) =>
                      patch(row.rowIndex, { include: e.target.checked })
                    }
                  />
                </td>
                <td className={`${CELL} num text-object-base-mid whitespace-nowrap`}>
                  {formatMonthDay(row.date)}
                </td>
                <td className={CELL}>{row.name}</td>
                <td
                  className={`${CELL} num text-right whitespace-nowrap ${
                    row.type === "income" ? "text-object-success-bright" : ""
                  }`}
                >
                  {row.type === "income" ? "+" : MINUS}
                  {formatAmount(row.amount)}
                </td>
                <td className={CELL}>
                  <Select
                    aria-label="収支"
                    value={row.type}
                    onChange={(e) =>
                      patch(row.rowIndex, { type: e.target.value as EntryType })
                    }
                  >
                    <option value="expense">支出</option>
                    <option value="income">収入</option>
                  </Select>
                </td>
                <td className={CELL}>
                  <Select
                    aria-label="固定/変動"
                    value={row.costType ?? ""}
                    disabled={row.type !== "expense"}
                    onChange={(e) =>
                      patch(row.rowIndex, {
                        costType: e.target.value === "fixed" ? "fixed" : "variable",
                      })
                    }
                  >
                    <option value="variable">変動費</option>
                    <option value="fixed">固定費</option>
                  </Select>
                </td>
                <td className={CELL}>
                  <CategorySelect
                    type={row.type}
                    value={row.categoryCode}
                    onChange={(categoryCode) =>
                      patch(row.rowIndex, { categoryCode })
                    }
                  />
                </td>
                <td className={`${CELL} w-[var(--layout-ratio-width)]`}>
                  <NumberInput
                    aria-label="事業割合"
                    value={row.bizRatio}
                    max={100}
                    onValueChange={(bizRatio) => patch(row.rowIndex, { bizRatio })}
                  />
                </td>
                <td className={`${CELL} text-object-base-mid text-body-xxs`}>
                  {row.matchedName ? (
                    <span className="flex flex-wrap items-center gap-4">
                      <Tag variant="actual">自動</Tag>
                      {row.matchedName}
                    </span>
                  ) : (
                    "—"
                  )}
                  {row.guessedFrom && (
                    <span className="block">
                      費目は「{row.guessedFrom}」から推定
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        金額が一致し日付が近い予定を自動で探して紐づけています。紐づいた行を
        取り込むと、その予定は予測から外れます。1件の予定に2行は紐づきません。
        費目は過去の名前から推測しているので、違うものだけ直してください。
      </p>
    </>
  );
}
