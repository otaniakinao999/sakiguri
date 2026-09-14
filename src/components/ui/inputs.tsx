"use client";

/**
 * 入力の部品
 *
 * 一次情報：docs/designsystem.md §4 TextInput / Select ほか、§2.4
 *   枠線は border-base-high。フォーカスは globals.css の :focus-visible。
 *   金額・件数・日付を含む数値は等幅（tabular-nums）にする。
 */

import { useId } from "react";

import {
  CATEGORIES,
  categoriesInGroup,
  type CategoryGroup,
} from "@/core/categories";
import type { EntryType } from "@/core/types";

const CONTROL =
  "border-border-base-high bg-surface-base-primary text-object-base-high w-full rounded-base border px-8 py-4 text-body-xs leading-normal disabled:bg-surface-overlay-hoverd disabled:text-object-base-low";

/** ラベルと入力の組。 */
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="text-object-base-mid mb-4 block text-body-xxs font-semibold"
      >
        {label}
      </label>
      {children(id)}
      {hint && (
        <p className="text-object-base-mid mt-4 text-body-xxs">{hint}</p>
      )}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="text" className={CONTROL} />;
}

export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="date" className={`${CONTROL} num`} />;
}

/**
 * 金額・整数の入力。
 *
 * 数字以外を弾き、右寄せの等幅で出す。金額は円単位の整数で持つ
 * （ADR-0001）ので、小数点も指数も受け付けない。
 */
export function NumberInput({
  value,
  onValueChange,
  max,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: number;
  onValueChange: (value: number) => void;
  max?: number;
}) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, "");
        const parsed = digits === "" ? 0 : Number(digits);
        onValueChange(max === undefined ? parsed : Math.min(parsed, max));
      }}
      className={`${CONTROL} num text-right`}
    />
  );
}

export function Select({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={CONTROL}>
      {children}
    </select>
  );
}

/** 収支の向きから、選べる費目のグループを決める。 */
export function categoryGroupFor(type: EntryType): CategoryGroup {
  if (type === "income") return "INC";
  if (type === "transfer") return "TRF";
  return "EXP";
}

/**
 * 費目の選択。
 *
 * 収支の向きに合うグループだけを出す。v1.0 では利用者が費目を
 * 追加・削除できない（要件定義書 §3.1.2 適用規則4）。
 * 自動生成される費目（カード引落・借入返済の元金）は選ばせない。
 */
export function CategorySelect({
  type,
  value,
  onChange,
  id,
}: {
  type: EntryType;
  value: string;
  onChange: (code: string) => void;
  id?: string;
}) {
  const options = categoriesInGroup(categoryGroupFor(type)).filter(
    (c) => !c.generated,
  );

  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

/** 収支の向きを変えたとき、費目が合わなくなっていれば先頭に寄せる。 */
export function fitCategory(type: EntryType, current: string): string {
  const group = categoryGroupFor(type);
  const found = CATEGORIES.find((c) => c.code === current);
  if (found && found.group === group && !found.generated) return current;
  return categoriesInGroup(group).find((c) => !c.generated)!.code;
}
