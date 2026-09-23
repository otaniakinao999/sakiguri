"use client";

/**
 * 入力の部品
 *
 * 一次情報：docs/designsystem.md §4 TextInput / Select ほか、§2.4
 *   枠線は border-base-high。フォーカスは globals.css の :focus-visible。
 *   金額・件数・日付を含む数値は等幅（tabular-nums）にする。
 */

import { useId, useState } from "react";

import {
  CATEGORIES,
  categoriesInGroup,
  type CategoryGroup,
} from "@/core/categories";
import type { EntryType } from "@/core/types";
import { parseMonthsField, parseNumberField } from "@/lib/number-field";

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
 * 解析の規則と根拠は `@/lib/number-field` にある。
 *
 * **入力途中の文字列を自前で持つ。** 値（number）から表示を作り直すと、
 * 空文字が 0 に戻ってしまい、既存の値を消して入れ直せなくなる。
 * 欄を離れたら下書きを捨て、正規化した値を出す。
 */
export function NumberInput({
  value,
  onValueChange,
  allowNegative = false,
  max,
  onBlur,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: number;
  onValueChange: (value: number) => void;
  /** 負の値を受け付けるか。既定は false（要件定義書 §3.2「絶対値」） */
  allowNegative?: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      {...props}
      type="text"
      /* マイナスを打てる必要がある欄では数字キーパッドに符号が無いため text
         にする。それ以外は numeric のままにして入力を楽にする */
      inputMode={allowNegative ? "text" : "numeric"}
      value={draft ?? String(value)}
      onChange={(e) => {
        const { text, value: parsed, clamped } = parseNumberField(e.target.value, {
          allowNegative,
          max,
        });
        /* 上限で丸めたときは下書きを捨て、丸めた値を見せる */
        setDraft(clamped ? null : text);
        onValueChange(parsed);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      className={`${CONTROL} num text-right`}
    />
  );
}

/**
 * 定期項目の「対象月」の入力（AC-21）。
 *
 * 一次情報：docs/要件定義書.md §3.2 months
 *   null は毎月、配列はその月だけ、空配列はどの月でもない（＝発生しない）。
 *
 * **読めない入力では値を書き換えない。** 直前の値を保ったままエラーを
 * 出す。空配列を保存すると CL-1 が1件も展開しないのに欄は空欄＝「毎月」
 * に見え、逆に null へ倒すと誤入力が全月に1件ずつ発生して気づけない。
 * どちらも黙って資金繰りを変えてしまうので、書き換えずに知らせる。
 *
 * 入力途中の文字列は自前で持つ（ADR-0015 と同じ理由）。
 */
export function MonthsInput({
  value,
  onValueChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: number[] | null;
  onValueChange: (months: number[] | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const messageId = useId();

  return (
    <>
      <input
        {...props}
        type="text"
        value={draft ?? (value ? value.join(",") : "")}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const got = parseMonthsField(raw);
          setInvalid(!got.ok);
          /* 読めたときだけ書き換える。読めなければ直前の値が残る */
          if (got.ok) onValueChange(got.months);
        }}
        onBlur={(e) => {
          /* 直せていないうちは打った文字を消さない。消すと何が悪いのか
             分からなくなる */
          if (!invalid) setDraft(null);
          props.onBlur?.(e);
        }}
        className={`${CONTROL} ${invalid ? "border-object-error-dim" : ""}`}
      />
      {invalid && (
        <p id={messageId} className="text-object-error-dim mt-4 text-body-xxs leading-normal">
          1〜12 の月を入れてください。直前の指定のままにしてあります。
        </p>
      )}
    </>
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
