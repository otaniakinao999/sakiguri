"use client";

/**
 * 列の対応づけ（CL-7）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-7「列の自動推定」
 *   **推定結果は必ず画面に表示し、利用者が修正できること。**
 *   推定が外れても取込が壊れないのは、この画面があるからである。
 */

import type { ColumnMapping } from "@/core/csv";
import { Field, Select } from "@/components/ui/inputs";

const NONE = -1;

export function ColumnMappingForm({
  rows,
  mapping,
  onChange,
}: {
  rows: string[][];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
}) {
  const columns = rows[0] ?? [];
  const patch = (value: Partial<ColumnMapping>) =>
    onChange({ ...mapping, ...value });

  const options = (allowNone: boolean) => (
    <>
      {allowNone && <option value={NONE}>なし</option>}
      {columns.map((cell, index) => (
        <option key={index} value={index}>
          {index + 1}: {String(cell).slice(0, 14) || "（空）"}
        </option>
      ))}
    </>
  );

  const singleAmount = mapping.inflow < 0 && mapping.outflow < 0;

  return (
    <>
      <div className="grid gap-8 wide:grid-cols-4">
        <Field label="日付の列">
          {(id) => (
            <Select
              id={id}
              value={mapping.date}
              onChange={(e) => patch({ date: Number(e.target.value) })}
            >
              {options(false)}
            </Select>
          )}
        </Field>
        <Field label="摘要の列">
          {(id) => (
            <Select
              id={id}
              value={mapping.name}
              onChange={(e) => patch({ name: Number(e.target.value) })}
            >
              {options(true)}
            </Select>
          )}
        </Field>
        <Field label="入金の列">
          {(id) => (
            <Select
              id={id}
              value={mapping.inflow}
              onChange={(e) => patch({ inflow: Number(e.target.value) })}
            >
              {options(true)}
            </Select>
          )}
        </Field>
        <Field label="出金の列">
          {(id) => (
            <Select
              id={id}
              value={mapping.outflow}
              onChange={(e) => patch({ outflow: Number(e.target.value) })}
            >
              {options(true)}
            </Select>
          )}
        </Field>
        <Field
          label="金額が1列の場合"
          hint={singleAmount ? undefined : "入金・出金の列があるので使いません"}
        >
          {(id) => (
            <Select
              id={id}
              value={mapping.amount}
              onChange={(e) => patch({ amount: Number(e.target.value) })}
            >
              {options(true)}
            </Select>
          )}
        </Field>
        <Field label="金額の符号">
          {(id) => (
            <Select
              id={id}
              value={mapping.sign}
              disabled={!singleAmount}
              onChange={(e) =>
                patch({ sign: e.target.value as ColumnMapping["sign"] })
              }
            >
              <option value="outMinus">出金がマイナス</option>
              <option value="outPlus">出金がプラス</option>
            </Select>
          )}
        </Field>
        <Field label="1行目">
          {(id) => (
            <Select
              id={id}
              value={mapping.hasHeader ? "1" : "0"}
              onChange={(e) => patch({ hasHeader: e.target.value === "1" })}
            >
              <option value="1">見出し</option>
              <option value="0">データ</option>
            </Select>
          )}
        </Field>
      </div>

      {/* 先頭の数行を見せて、対応づけが合っているかを目で確かめられるようにする */}
      <div className="mt-12 overflow-x-auto">
        <table className="w-full border-collapse text-body-xxs">
          <tbody>
            {rows.slice(0, 3).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td
                    key={index}
                    className="border-b-border-base-low text-object-base-mid border-b px-8 py-4 whitespace-nowrap"
                  >
                    {String(cell).slice(0, 16)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        見出しから自動で推定しています。違っていればここで直してください。
        全部で {rows.length.toLocaleString("ja-JP")} 行です。
      </p>
    </>
  );
}
