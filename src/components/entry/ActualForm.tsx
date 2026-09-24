"use client";

/**
 * 実績の入力・編集フォーム
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、§3.1 FR-05・FR-41
 *
 * 入力（新規）と編集の両方に使う。編集の入口は「最近の実績」一覧と
 * 入出金予定表の実績行の2箇所あり（FR-41）、どちらからでも同じ項目を
 * 同じ並びで触れるようにするため1つの部品にしてある。
 *
 * **`key`（予定との紐づけ）は編集項目に無い。** 日付や金額を直しただけで
 * 消し込みが外れてはいけない（AC-24・AC-25）。保持は `updateActual` が
 * 行い、この画面には出さない。
 */

import type { Account, Actual, EntryType } from "@/core/types";
import { Button } from "@/components/ui/Button";
import {
  CategorySelect,
  DateInput,
  Field,
  fitCategory,
  NumberInput,
  Select,
  TextInput,
} from "@/components/ui/inputs";

/** 収支を変えたときに、合わなくなった項目を整える。 */
export function applyActualPatch(
  current: Actual,
  patch: Partial<Actual>,
): Actual {
  const next = { ...current, ...patch };
  if (patch.type) {
    next.costType =
      patch.type === "expense" ? (current.costType ?? "variable") : null;
    next.categoryCode = fitCategory(patch.type, current.categoryCode);
  }
  return next;
}

/** 登録・保存できる状態か。 */
export function isSubmittable(form: Actual): boolean {
  return form.name.trim() !== "" && form.amount !== 0;
}

export function ActualForm({
  value,
  accounts,
  mode,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: Actual;
  accounts: Account[];
  mode: "create" | "edit";
  onChange: (patch: Partial<Actual>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="grid gap-8 wide:grid-cols-2">
        <Field label="日付">
          {(id) => (
            <DateInput
              id={id}
              value={value.date}
              onChange={(e) => onChange({ date: e.target.value })}
            />
          )}
        </Field>
        <Field label="内容">
          {(id) => (
            <TextInput
              id={id}
              value={value.name}
              placeholder="スーパー"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="金額">
          {(id) => (
            <NumberInput
              id={id}
              value={value.amount}
              onValueChange={(amount) => onChange({ amount })}
            />
          )}
        </Field>
        <Field label="収支">
          {(id) => (
            <Select
              id={id}
              value={value.type}
              onChange={(e) => onChange({ type: e.target.value as EntryType })}
            >
              <option value="expense">支出</option>
              <option value="income">収入</option>
              <option value="transfer">振替</option>
            </Select>
          )}
        </Field>
        <Field label="固定/変動">
          {(id) => (
            <Select
              id={id}
              value={value.costType ?? ""}
              disabled={value.type !== "expense"}
              onChange={(e) =>
                onChange({
                  costType: e.target.value === "fixed" ? "fixed" : "variable",
                })
              }
            >
              <option value="variable">変動費</option>
              <option value="fixed">固定費</option>
            </Select>
          )}
        </Field>
        <Field label="費目">
          {(id) => (
            <CategorySelect
              id={id}
              type={value.type}
              value={value.categoryCode}
              onChange={(categoryCode) => onChange({ categoryCode })}
            />
          )}
        </Field>
        <Field label="事業割合 %" hint="初期値は0。項目ごとに設定します">
          {(id) => (
            <NumberInput
              id={id}
              value={value.bizRatio}
              max={100}
              onValueChange={(bizRatio) => onChange({ bizRatio })}
            />
          )}
        </Field>
        <Field label="支払方法">
          {(id) => (
            <Select
              id={id}
              value={value.accountId}
              onChange={(e) => onChange({ accountId: e.target.value })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.kind === "card" ? "（カード）" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {value.type === "transfer" && (
          <Field label="振替先">
            {(id) => (
              <Select
                id={id}
                value={value.toAccountId ?? ""}
                onChange={(e) => onChange({ toAccountId: e.target.value })}
              >
                <option value="">選んでください</option>
                {accounts
                  .filter((a) => a.id !== value.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      <div className="mt-12 flex gap-8">
        <Button color="black" onClick={onSubmit} disabled={!isSubmittable(value)}>
          {mode === "edit" ? "保存" : "登録"}
        </Button>
        <Button onClick={onCancel}>やめる</Button>
      </div>

      {value.key && (
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          {mode === "edit"
            ? "この実績は予定に紐づいています。日付や金額を直しても紐づけは外れません。"
            : "この予定に紐づけて登録します。予測からは自動で除かれます。年月別収支の「予定」列は変わりません。"}
        </p>
      )}

      {/* 「予定にない支出」の取り消し（AC-38）。誤って押した場合の戻し手段を
          編集に置く。ここでしか戻せないと分かるよう、状態も説明する */}
      {mode === "edit" && value.key === null && value.unplanned && (
        <div className="border-border-base-low mt-16 border-t pt-12">
          <p className="text-object-base-mid text-body-xxs leading-normal">
            この実績は「予定にない支出」として確定済みです。消し込み候補は
            出ません。取り消すと、条件に合う予定があれば候補が戻ります。
          </p>
          <div className="mt-8">
            <Button size="sm" onClick={() => onChange({ unplanned: false })}>
              「予定にない支出」を取り消す
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
