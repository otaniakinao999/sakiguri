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
import type { Actual, ForecastInstance } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { KindTag, RatioTag } from "@/components/ui/Tag";
import { formatAmount, formatMonthDay, MINUS } from "@/lib/format";
import {
  addActual,
  blankActual,
  newId,
  removeActual,
  settleAsPlanned,
  updateActual,
} from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";

import { ActualForm, applyActualPatch, isSubmittable } from "./ActualForm";
import { DeferralEditor } from "./DeferralEditor";

/** 消し込み待ちに出す範囲。今日から先1週間ぶんまで拾う */
const PENDING_LOOKAHEAD_DAYS = 7;

export function EntryScreen() {
  const { data, setData, today, session } = useAppData();
  const [form, setForm] = useState<Actual | null>(null);
  /** 編集中の実績の id。新規入力なら null */
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const startForm = (base?: Partial<Actual>) => {
    setEditingId(null);
    setForm({ ...blankActual(newId(), data.accounts[0].id, today), ...base });
  };

  /** 既存の実績を編集する（FR-33）。 */
  const startEdit = (actual: Actual) => {
    setEditingId(actual.id);
    setForm({ ...actual });
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const update = (patch: Partial<Actual>) =>
    setForm((f) => (f ? applyActualPatch(f, patch) : f));

  const submit = () => {
    if (!form || !isSubmittable(form)) return;
    const name = form.name.trim();

    if (editingId) {
      /* FR-33 が編集を認めている項目だけを渡す。id と key は含めない。
         key は予定との紐づけで、これを触ると消し込みが外れる
         （AC-24・AC-25）。updateActual 側でも落としている */
      setData((d) =>
        updateActual(d, editingId, {
          date: form.date,
          name,
          type: form.type,
          costType: form.costType,
          categoryCode: form.categoryCode,
          amount: form.amount,
          bizRatio: form.bizRatio,
          accountId: form.accountId,
          toAccountId: form.toAccountId,
        }),
      );
    } else {
      setData((d) => addActual(d, { ...form, name }));
      track(session?.user.id, "actual_recorded", {
        settled: form.key !== null,
        fromCsv: false,
      });
    }
    closeForm();
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
                          onClick={() => {
                            setData((d) => settleAsPlanned(d, plan, newId()));
                            track(session?.user.id, "actual_recorded", {
                              settled: true,
                              fromCsv: false,
                            });
                          }}
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

      {/* ---------- 実績入力・編集（FR-05、FR-33） ---------- */}
      <Card
        title={
          editingId
            ? "実績を編集"
            : form?.key
              ? "実績を入力（予定を消し込み）"
              : "実績を入力"
        }
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
            登録済みの実績は下の一覧から編集できます。
          </p>
        ) : (
          <ActualForm
            value={form}
            accounts={data.accounts}
            mode={editingId ? "edit" : "create"}
            onChange={update}
            onSubmit={submit}
            onCancel={closeForm}
          />
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
                        <span className="flex justify-end gap-4">
                          {/* FR-33。CSV取込で費目を誤って推測された分を
                              削除せずに直せるようにする */}
                          <Button size="sm" onClick={() => startEdit(actual)}>
                            編集
                          </Button>
                          <Button
                            size="sm"
                            color="danger"
                            onClick={() => setData((d) => removeActual(d, actual.id))}
                          >
                            削除
                          </Button>
                        </span>
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
