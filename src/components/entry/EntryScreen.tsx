"use client";

/**
 * SC-05 実績入力
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、§4.1.1 実績入力の構成
 * 対応する機能要件：FR-05（手入力）、FR-06（消し込み）、FR-07（繰延）、
 *                   FR-41（実績の編集）、FR-42（一覧）、FR-46（照合候補）
 * 対応する受入基準：AC-03、AC-27、AC-28a、AC-30、AC-37
 *
 * **1カラム。** 高さが伸びる要対応リストと高さの固定された入力フォームを
 * 横に並べると、件数が増えた時点で必ず崩れる。
 *
 * **主従を分ける。** 想定フローは「CSV取込 → 自動照合 → 残りを消し込み」で、
 * 手入力は例外処理である。要対応リストを主とし、手入力はボタンから
 * モーダルで開く。
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
import { Modal } from "@/components/ui/Modal";
import { Notification } from "@/components/ui/Notification";
import { KindTag, RatioTag } from "@/components/ui/Tag";
import { buildActualList, MONTH_PAGE_SIZE } from "@/lib/actual-list";
import {
  formatAmount,
  formatMonthDay,
  formatYearMonthLabel,
  MINUS,
} from "@/lib/format";
import {
  addActual,
  blankActual,
  linkActualToPlan,
  markReconciled,
  newId,
  setUnplanned,
  removeActual,
  settleAsPlanned,
  updateActual,
} from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";
import { findCandidates } from "@/lib/reconcile";
import {
  buildTodoList,
  TODO_PREVIEW_COUNT,
  type TodoCandidateRow,
  type TodoPlanRow,
  type TodoRow,
} from "@/lib/todo-list";

import { ActualForm, applyActualPatch, isSubmittable } from "./ActualForm";
import { DeferralEditor } from "./DeferralEditor";
import { TodoTable } from "./TodoTable";

/** 要対応に出す予定の範囲。今日から先1週間ぶんまで拾う */
const PENDING_LOOKAHEAD_DAYS = 7;

export function EntryScreen() {
  const { data, setData, today, session } = useAppData();

  /** 手入力・編集のモーダル。null なら閉じている */
  const [form, setForm] = useState<Actual | null>(null);
  /** 編集中の実績の id。新規入力なら null */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deferring, setDeferring] = useState<ForecastInstance | null>(null);

  /** 要対応リストを全件出すか（B-2） */
  const [showAllTodo, setShowAllTodo] = useState(false);

  /* 実績一覧（FR-42） */
  const [listMonth, setListMonth] = useState<string | null>(null);
  const [listPage, setListPage] = useState(0);

  const computed = useMemo(() => {
    if (!today || data.accounts.length === 0) {
      return { todo: [] as TodoRow[], candidateCount: 0 };
    }
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

    /* unplanned の実績は候補から除かれる（AC-38） */
    const candidates = findCandidates({
      actuals: data.actuals,
      unmatchedForecast: series.unmatchedForecast,
    });

    return {
      todo: buildTodoList({
        unmatchedForecast: series.unmatchedForecast,
        candidates,
        until: addDays(today, PENDING_LOOKAHEAD_DAYS),
      }),
      candidateCount: candidates.length,
    };
  }, [data, today]);

  const list = useMemo(
    () =>
      buildActualList({ actuals: data.actuals, yearMonth: listMonth, page: listPage }),
    [data.actuals, listMonth, listPage],
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

  /* ---------- 手入力・編集 ---------- */

  const startForm = () => {
    setEditingId(null);
    setForm(blankActual(newId(), data.accounts[0].id, today));
  };

  const startEdit = (actual: Actual) => {
    setEditingId(actual.id);
    setForm({ ...actual });
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const submit = () => {
    if (!form || !isSubmittable(form)) return;
    const name = form.name.trim();

    if (editingId) {
      /* FR-41 が編集を認めている項目だけを渡す。id と key は含めない */
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
          /* 「予定にない支出」の取り消し（AC-38）。編集の対象に含める */
          unplanned: form.unplanned ?? false,
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

  /* ---------- 要対応リストの操作 ---------- */

  /**
   * 消し込み操作を記録する（FR-43、AC-29a）。
   *
   * best-effort。保存は差分保存に乗るので、失敗しても消し込みそのものは
   * 巻き戻らない。警告のための補助情報が実際の記録より優先されてはならない。
   */
  const reconciled = (d: ReturnType<typeof markReconciled>) =>
    markReconciled(d, today);

  const recordActual = (plan: ForecastInstance, amount: number) => {
    setData((d) => reconciled(settleAsPlanned(d, { ...plan, amount }, newId())));
    track(session?.user.id, "actual_recorded", { settled: true, fromCsv: false });
  };

  const actions = {
    settleAsIs: (row: TodoPlanRow) => recordActual(row.plan, row.plan.amount),
    settleWithAmount: (row: TodoPlanRow, amount: number) =>
      recordActual(row.plan, amount),
    defer: (row: TodoPlanRow) => setDeferring(row.plan),
    /* どちらも既存の実績を更新する操作であって、実績を記録していない。
       actual_recorded は使わない（実績入力の件数が水増しされるため） */
    linkTo: (row: TodoCandidateRow, planKey: string) => {
      setData((d) => reconciled(linkActualToPlan(d, row.actual.id, planKey)));
      track(session?.user.id, "candidate_resolved", {
        confirmed: true,
        candidateCount: row.plans.length,
      });
    },
    markUnplanned: (row: TodoCandidateRow) => {
      setData((d) => reconciled(setUnplanned(d, row.actual.id, true)));
      track(session?.user.id, "candidate_resolved", {
        confirmed: false,
        candidateCount: row.plans.length,
      });
    },
  };

  return (
    <div className="flex flex-col gap-12">
      {/* ---------- 要対応（主）---------- */}
      <Card
        title={`要対応（${computed.todo.length}件）`}
        right={
          <Button size="sm" onClick={startForm}>
            ＋ 実績を手入力
          </Button>
        }
      >
        {computed.candidateCount > 0 && (
          <div className="mb-12">
            <Notification variant="caution">
              同じ取引かもしれない実績と予定が{computed.candidateCount}組あります。
              両方が残高に乗っているため、残高が実際より低く出ています。
              同じ取引なら「同じ取引」を押してください。
            </Notification>
          </div>
        )}

        <TodoTable
          rows={
            showAllTodo
              ? computed.todo
              : computed.todo.slice(0, TODO_PREVIEW_COUNT)
          }
          accounts={data.accounts}
          actions={actions}
        />

        {/* B-2。古いものから20件だけ出し、残りは開いて見せる */}
        {computed.todo.length > TODO_PREVIEW_COUNT && (
          <div className="mt-12 flex flex-wrap items-center gap-8">
            <span className="text-object-base-mid num text-body-xxs">
              {showAllTodo
                ? `${computed.todo.length}件すべて`
                : `${TODO_PREVIEW_COUNT}件 ／ ${computed.todo.length}件`}
              を表示しています
            </span>
            <Button size="sm" onClick={() => setShowAllTodo(!showAllTodo)}>
              {showAllTodo ? "古い20件だけ表示" : "すべて表示"}
            </Button>
          </div>
        )}

        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          「予定どおり」で予定額のまま実績にします。金額が違うときや払えな
          かったときは「ほかの操作」を開いてください。CSV取込を使うと、
          ここの多くは自動で消し込まれます。
        </p>
      </Card>

      {/* ---------- 繰延（FR-07）---------- */}
      {deferring && (
        <DeferralEditor plan={deferring} onClose={() => setDeferring(null)} />
      )}

      {/* ---------- 実績（FR-42）---------- */}
      <Card
        title={`実績（${list.total}件）`}
        right={
          list.months.length > 0 ? (
            <span className="flex items-center gap-8">
              <label className="sr-only" htmlFor="actual-month">
                表示する月
              </label>
              <select
                id="actual-month"
                value={list.yearMonth ?? ""}
                onChange={(e) => {
                  setListMonth(e.target.value);
                  setListPage(0);
                }}
                className="border-border-base-high bg-surface-base-primary rounded-base border px-8 py-4 text-body-xs"
              >
                {list.months.map((m) => (
                  <option key={m.yearMonth} value={m.yearMonth}>
                    {formatYearMonthLabel(m.yearMonth)}（{m.count}件）
                  </option>
                ))}
              </select>
            </span>
          ) : undefined
        }
      >
        {list.rows.length === 0 ? (
          <p className="text-object-base-mid py-24 text-center text-body-xs">
            まだ実績がありません。
          </p>
        ) : (
          <div className="max-h-[var(--layout-ledger-height)] overflow-auto">
            <table className="w-full border-collapse text-body-xs">
              <tbody>
                {list.rows.map((actual) => (
                  <tr key={actual.id}>
                    <td className="border-b-border-base-low num text-object-base-mid border-b px-8 py-8 whitespace-nowrap">
                      {formatMonthDay(actual.date)}
                    </td>
                    <td className="border-b-border-base-low border-b px-8 py-8">
                      {actual.name}
                      <span className="text-object-base-mid block text-body-xxs">
                        {categoryOf(actual.categoryCode).name} ／{" "}
                        {accountName(actual.accountId)}
                      </span>
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
                        {/* FR-41。CSV取込で費目を誤って推測された分を
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

        {/* 月内が上限を超えたときだけ出す。無限スクロールは採らない
            （§5.1「一覧の表示件数」）。狙った位置に到達できないため */}
        {list.pageCount > 1 && (
          <div className="mt-12 flex flex-wrap items-center gap-8">
            <Button
              size="sm"
              disabled={list.page === 0}
              onClick={() => setListPage(list.page - 1)}
            >
              前の200件
            </Button>
            <span className="text-object-base-mid num text-body-xxs">
              {list.page * MONTH_PAGE_SIZE + 1}〜
              {list.page * MONTH_PAGE_SIZE + list.rows.length} 件目 ／{" "}
              {list.monthCount}件（{list.page + 1}/{list.pageCount}ページ）
            </span>
            <Button
              size="sm"
              disabled={list.page >= list.pageCount - 1}
              onClick={() => setListPage(list.page + 1)}
            >
              次の200件
            </Button>
          </div>
        )}

        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          月ごとに区切って全件を出しています。見出しの件数は全期間の合計で、
          月を切り替えるとすべての実績に辿り着けます。
        </p>
      </Card>

      {/* ---------- 手入力・編集（従）---------- */}
      {form && (
        <Modal
          title={editingId ? "実績を編集" : "実績を手入力"}
          onClose={closeForm}
        >
          <ActualForm
            value={form}
            accounts={data.accounts}
            mode={editingId ? "edit" : "create"}
            onChange={(patch) => setForm((f) => (f ? applyActualPatch(f, patch) : f))}
            onSubmit={submit}
            onCancel={closeForm}
          />
        </Modal>
      )}
    </div>
  );
}
