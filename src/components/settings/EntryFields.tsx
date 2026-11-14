"use client";

/**
 * 定期項目と単発予定で共通の列
 *
 * 一次情報：docs/要件定義書.md §3.2 RecurringItem / OneoffItem
 *   収支・固定変動・費目・金額・事業割合・口座（振替なら振替先）。
 */

import { costTypeApplies, fitCostType, fitToType } from "@/core/categories";
import { isCard } from "@/core/types";
import type { Account, CostType, EntryType } from "@/core/types";
import { CategorySelect, NumberInput, Select } from "@/components/ui/inputs";
import { ACCOUNT_LABEL, TO_ACCOUNT_LABEL } from "@/lib/account-label";

export interface EntryFieldsValue {
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  amount: number;
  bizRatio: number;
  accountId: string;
  toAccountId?: string;
}

const CELL = "border-b border-border px-cell py-8 align-top";

/**
 * 費目を変えたときの後始末。
 *
 * **費目だけを変えても固定／変動を整える。** 支出のまま費目を資金移動に
 * すると、固定変動が残ったままになる（適用規則6）。
 */
export function onCategoryChange(
  current: EntryFieldsValue,
  categoryCode: string,
): Partial<EntryFieldsValue> {
  return { categoryCode, costType: fitCostType(categoryCode, current.costType) };
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
          onChange={(e) => onChange(fitToType(value, e.target.value as EntryType))}
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
          disabled={!costTypeApplies(value.categoryCode)}
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
          onChange={(categoryCode) => onChange(onCategoryChange(value, categoryCode))}
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
        {/* **読み上げ名は収支で変わる**（FR-52・AC-58e。v1.54 で予定の設定
            にも広げた）。支出「支払元」／収入「入金先」／振替「振替元」。

            **見える語は列見出しのままである。** ここは表で、列見出しは
            全行で1つ（並べ替えのキーでもある）ので、行ごとに違う語を
            見出しに出せない。変わるのは欄の読み上げ名である。

            **対応は `lib/account-label` の1箇所から引く** ―― 実績編集と
            同じ表を2つ書くと、収支が増えたときに片方だけ古くなる（§2.8） */}
        <Select
          aria-label={ACCOUNT_LABEL[value.type]}
          value={value.accountId}
          onChange={(e) => onChange({ accountId: e.target.value })}
        >
          {/* 振替のときはカードを出さない（ActualForm と同じ理由） */}
          {accounts
            .filter((a) => value.type !== "transfer" || !isCard(a))
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
        {value.type === "transfer" && (
          <Select
            aria-label={TO_ACCOUNT_LABEL}
            value={value.toAccountId ?? ""}
            onChange={(e) => onChange({ toAccountId: e.target.value })}
          >
            <option value="">{TO_ACCOUNT_LABEL}を選ぶ</option>
            {/* カードは振替先にしない（合計の計算に入らないため） */}
            {accounts
              .filter((a) => a.id !== value.accountId && !isCard(a))
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
