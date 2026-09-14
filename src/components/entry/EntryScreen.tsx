"use client";

/**
 * SC-05 実績入力
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05
 *   消し込み待ちリスト、実績入力フォーム、最近の実績。
 * 対応する機能要件：FR-05（実績の手入力）、FR-06（消し込み）、FR-07（繰延）
 * 対応する受入基準：AC-03
 */

import { useMemo, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { categoryOf } from "@/core/categories";
import { addDays } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import type { Actual, EntryType, ForecastInstance } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  CategorySelect,
  DateInput,
  Field,
  fitCategory,
  NumberInput,
  Select,
  TextInput,
} from "@/components/ui/inputs";
import { KindTag, RatioTag } from "@/components/ui/Tag";
import { formatAmount, formatMonthDay, MINUS } from "@/lib/format";
import {
  addActual,
  blankActual,
  newId,
  removeActual,
  settleAsPlanned,
} from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";

import { DeferralEditor } from "./DeferralEditor";

/** 消し込み待ちに出す範囲。今日から先1週間ぶんまで拾う */
const PENDING_LOOKAHEAD_DAYS = 7;

export function EntryScreen() {
  const { data, setData, today } = useAppData();
  const [form, setForm] = useState<Actual | null>(null);
  const [deferring, setDeferring] = useState<ForecastInstance | null>(null);

  const pending = useMemo(() => {
    if (!today || data.accounts.length === 0) return [];
    const to = forecastEnd(data.asOf);
    const forecast = buildForecast(
      {
        recurring: data.recurring,
        oneoffs: data.oneoffs,
        overrides: data.overrides,
      },
      data.asOf,
      to,
    );
    const series = buildBalanceSeries(
      { accounts: data.accounts, asOf: data.asOf, forecast, actuals: data.actuals },
      to,
      today,
    );
    const limit = addDays(today, PENDING_LOOKAHEAD_DAYS);
    return series.unmatchedForecast.filter((f) => f.date <= limit);
  }, [data, today]);

  const recent = useMemo(
    () => [...data.actuals].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40),
    [data.actuals],
  );

  const accountName = (id: string) =>
    data.accounts.find((a) => a.id === id)?.name ?? "—";

  if (!today) return <Card title="実績入力">読み込み中…</Card>;

  if (data.accounts.length === 0) {
    return (
      <Card title="実績入力">
        <p className="text-object-base-high text-body-sm leading-normal">
          まだ口座が登録されていません。
        </p>
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          先に「予定の設定」で口座を登録してください。
        </p>
      </Card>
    );
  }

  const startForm = (base?: Partial<Actual>) =>
    setForm({
      ...blankActual(newId(), data.accounts[0].id, today),
      ...base,
    });

  const update = (patch: Partial<Actual>) =>
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, ...patch };
      if (patch.type) {
        next.costType = patch.type === "expense" ? (f.costType ?? "variable") : null;
        next.categoryCode = fitCategory(patch.type, f.categoryCode);
      }
      return next;
    });

  const submit = () => {
    if (!form || !form.name.trim() || form.amount === 0) return;
    setData((d) => addActual(d, { ...form, name: form.name.trim() }));
    setForm(null);
  };

  return (
    <div className="grid gap-12 wide:grid-cols-2">
      {/* ---------- 消し込み待ち（FR-06） ---------- */}
      <Card title={`消し込み待ちの予定（${pending.length}件）`}>
        {pending.length === 0 ? (
          <p className="text-object-base-mid py-24 text-center text-body-xs">
            消し込み待ちはありません。
          </p>
        ) : (
          <div className="max-h-[var(--layout-ledger-height)] overflow-auto">
            <table className="w-full border-collapse text-body-xs">
              <tbody>
                {pending.map((plan) => (
                  <tr key={plan.key} className={plan.origDate ? "bg-surface-caution-subtle" : ""}>
                    <td className="border-b-border-base-low num text-object-base-mid border-b px-8 py-8 whitespace-nowrap">
                      {formatMonthDay(plan.date)}
                      {plan.origDate && (
                        <span className="block text-body-xxs">
                          ←{formatMonthDay(plan.origDate)}
                        </span>
                      )}
                    </td>
                    <td className="border-b-border-base-low border-b px-8 py-8">
                      {plan.name}
                      <span className="text-object-base-mid block text-body-xxs">
                        {categoryOf(plan.categoryCode).name} ／{" "}
                        {accountName(plan.accountId)}
                      </span>
                    </td>
                    <td className="border-b-border-base-low num border-b px-8 py-8 text-right whitespace-nowrap">
                      {formatAmount(plan.amount)}
                    </td>
                    <td className="border-b-border-base-low border-b px-8 py-8 text-right">
                      <span className="flex flex-wrap justify-end gap-4">
                        <Button
                          size="sm"
                          color="black"
                          onClick={() =>
                            setData((d) =>
                              settleAsPlanned(d, plan, newId()),
                            )
                          }
                        >
                          予定どおり
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            startForm({
                              key: plan.key,
                              date: plan.date,
                              name: plan.name,
                              type: plan.type,
                              costType: plan.costType,
                              categoryCode: plan.categoryCode,
                              amount: plan.amount,
                              bizRatio: plan.bizRatio,
                              accountId: plan.accountId,
                              toAccountId: plan.toAccountId,
                            })
                          }
                        >
                          金額を直す
                        </Button>
                        <Button
                          size="sm"
                          color="line_gray"
                          onClick={() => setDeferring(plan)}
                        >
                          払えなかった
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          「予定どおり」で予定額のまま実績にします。「払えなかった」を押すと、
          その回だけ支払日や金額を動かせます。
        </p>
      </Card>

      {/* ---------- 実績入力（FR-05） ---------- */}
      <Card
        title={form?.key ? "実績を入力（予定を消し込み）" : "実績を入力"}
        right={
          form ? undefined : (
            <Button size="sm" color="black" onClick={() => startForm()}>
              ＋ 入力する
            </Button>
          )
        }
      >
        {!form ? (
          <p className="text-object-base-mid py-24 text-center text-body-xs">
            「入力する」を押すと、突発の入出金を手で登録できます。
          </p>
        ) : (
          <>
            <div className="grid gap-8 wide:grid-cols-2">
              <Field label="日付">
                {(id) => (
                  <DateInput
                    id={id}
                    value={form.date}
                    onChange={(e) => update({ date: e.target.value })}
                  />
                )}
              </Field>
              <Field label="内容">
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.name}
                    placeholder="スーパー"
                    onChange={(e) => update({ name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="金額">
                {(id) => (
                  <NumberInput
                    id={id}
                    value={form.amount}
                    onValueChange={(amount) => update({ amount })}
                  />
                )}
              </Field>
              <Field label="収支">
                {(id) => (
                  <Select
                    id={id}
                    value={form.type}
                    onChange={(e) => update({ type: e.target.value as EntryType })}
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
                    value={form.costType ?? ""}
                    disabled={form.type !== "expense"}
                    onChange={(e) =>
                      update({ costType: e.target.value === "fixed" ? "fixed" : "variable" })
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
                    type={form.type}
                    value={form.categoryCode}
                    onChange={(categoryCode) => update({ categoryCode })}
                  />
                )}
              </Field>
              <Field label="事業割合 %" hint="初期値は0。項目ごとに設定します">
                {(id) => (
                  <NumberInput
                    id={id}
                    value={form.bizRatio}
                    max={100}
                    onValueChange={(bizRatio) => update({ bizRatio })}
                  />
                )}
              </Field>
              <Field label="支払方法">
                {(id) => (
                  <Select
                    id={id}
                    value={form.accountId}
                    onChange={(e) => update({ accountId: e.target.value })}
                  >
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.kind === "card" ? "（カード）" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {form.type === "transfer" && (
                <Field label="振替先">
                  {(id) => (
                    <Select
                      id={id}
                      value={form.toAccountId ?? ""}
                      onChange={(e) => update({ toAccountId: e.target.value })}
                    >
                      <option value="">選んでください</option>
                      {data.accounts
                        .filter((a) => a.id !== form.accountId)
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
              <Button
                color="black"
                onClick={submit}
                disabled={!form.name.trim() || form.amount === 0}
              >
                登録
              </Button>
              <Button onClick={() => setForm(null)}>やめる</Button>
            </div>

            {form.key && (
              <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
                この予定に紐づけて登録します。予測からは自動で除かれます。
                年月別収支の「予定」列は変わりません。
              </p>
            )}
          </>
        )}
      </Card>

      {/* ---------- 繰延（FR-07） ---------- */}
      {deferring && (
        <div className="wide:col-span-2">
          <DeferralEditor
            plan={deferring}
            onClose={() => setDeferring(null)}
          />
        </div>
      )}

      {/* ---------- 最近の実績 ---------- */}
      <div className="wide:col-span-2">
        <Card title={`最近の実績（${data.actuals.length}件）`}>
          {recent.length === 0 ? (
            <p className="text-object-base-mid py-24 text-center text-body-xs">
              まだ実績がありません。
            </p>
          ) : (
            <div className="max-h-[var(--layout-ledger-height)] overflow-auto">
              <table className="w-full border-collapse text-body-xs">
                <tbody>
                  {recent.map((actual) => (
                    <tr key={actual.id}>
                      <td className="border-b-border-base-low num text-object-base-mid border-b px-8 py-8 whitespace-nowrap">
                        {formatMonthDay(actual.date)}
                      </td>
                      <td className="border-b-border-base-low border-b px-8 py-8">
                        {actual.name}
                      </td>
                      <td className="border-b-border-base-low border-b px-8 py-8">
                        <span className="flex gap-4">
                          <KindTag event={{ ...actual, src: "actual" }} />
                          <RatioTag bizRatio={actual.bizRatio} />
                        </span>
                      </td>
                      <td className="border-b-border-base-low text-object-base-mid border-b px-8 py-8 whitespace-nowrap">
                        {actual.key ? "消し込み済み" : "突発"}
                      </td>
                      <td
                        className={`border-b-border-base-low num border-b px-8 py-8 text-right whitespace-nowrap ${
                          actual.type === "income" ? "text-object-success-bright" : ""
                        }`}
                      >
                        {actual.type === "transfer"
                          ? "±"
                          : actual.type === "income"
                            ? "+"
                            : MINUS}
                        {formatAmount(actual.amount)}
                      </td>
                      <td className="border-b-border-base-low border-b px-8 py-8 text-right">
                        <Button
                          size="sm"
                          color="danger"
                          onClick={() => setData((d) => removeActual(d, actual.id))}
                        >
                          削除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
