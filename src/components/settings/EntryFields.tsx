"use client";

/**
 * 定期項目と単発予定で共通の列
 *
 * 一次情報：docs/要件定義書.md §3.2 RecurringItem / OneoffItem
 *   収支・固定変動・費目・金額・事業割合・口座（振替なら振替先）。
 */

import type { Account, CostType, EntryType } from "@/core/types";
import { CategorySelect, fitCategory, NumberInput, Select } from "@/components/ui/inputs";

export interface EntryFieldsValue {
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  amount: number;
  bizRatio: number;
  accountId: string;
  toAccountId?: string;
}

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";

/**
 * 収支の向きを変えたときの後始末。
 *
 * 費用でなければ固定／変動は持たない（要件定義書 §3.1.2 適用規則6）。
 * 費目もグループが変わるので合わせる。
 */
export function onTypeChange(
  current: EntryFieldsValue,
  type: EntryType,
): Partial<EntryFieldsValue> {
  return {
    type,
    costType: type === "expense" ? (current.costType ?? "variable") : null,
    categoryCode: fitCategory(type, current.categoryCode),
    toAccountId: type === "transfer" ? current.toAccountId : undefined,
  };
}

export function EntryFieldCells({
  value,
  accounts,
  onChange,
}: {
  value: EntryFieldsValue;
  accounts: Account[];
  onChange: (patch: Partial<EntryFieldsValue>) => void;
}) {
  return (
    <>
      <td className={CELL}>
        <Select
          aria-label="収支"
          value={value.type}
          onChange={(e) => onChange(onTypeChange(value, e.target.value as EntryType))}
        >
          <option value="expense">支出</option>
          <option value="income">収入</option>
          <option value="transfer">振替</option>
        </Select>
      </td>
      <td className={CELL}>
        <Select
          aria-label="固定/変動"
          value={value.costType ?? ""}
          disabled={value.type !== "expense"}
          onChange={(e) =>
            onChange({ costType: e.target.value === "fixed" ? "fixed" : "variable" })
          }
        >
          <option value="variable">変動費</option>
          <option value="fixed">固定費</option>
        </Select>
      </td>
      <td className={CELL}>
        <CategorySelect
          type={value.type}
          value={value.categoryCode}
          onChange={(categoryCode) => onChange({ categoryCode })}
        />
      </td>
      <td className={CELL}>
        <NumberInput
          aria-label="金額"
          value={value.amount}
          onValueChange={(amount) => onChange({ amount })}
        />
      </td>
      <td className={CELL}>
        <NumberInput
          aria-label="事業割合"
          value={value.bizRatio}
          max={100}
          onValueChange={(bizRatio) => onChange({ bizRatio })}
        />
      </td>
      <td className={CELL}>
        <Select
          aria-label="口座"
          value={value.accountId}
          onChange={(e) => onChange({ accountId: e.target.value })}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {value.type === "transfer" && (
          <Select
            aria-label="振替先"
            value={value.toAccountId ?? ""}
            onChange={(e) => onChange({ toAccountId: e.target.value })}
          >
            <option value="">振替先を選ぶ</option>
            {accounts
              .filter((a) => a.id !== value.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  → {a.name}
                </option>
              ))}
          </Select>
        )}
      </td>
    </>
  );
}
