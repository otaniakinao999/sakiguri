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
import { classificationChanges } from "@/core/classification";
import { addDays } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import { touchesAccount } from "@/core/types";
import { Select } from "@/components/ui/inputs";
import type { Actual, ForecastInstance } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import Link from "next/link";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/v06/button";
import { Modal } from "@/components/ui/Modal";
import { Callout } from "@/components/sakiguri/Callout";
import { Panel } from "@/components/sakiguri/Panel";
import { buildHeaderStats } from "@/lib/header-stats";
import { buildActualList, MONTH_PAGE_SIZE } from "@/lib/actual-list";
import { describeInheritance } from "@/lib/classification-notice";
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
import { EntryView } from "./EntryView";
import {
  buildEntryActualRows,
  buildEntryMonths,
  buildEntryTodoRows,
  formatActualListFooter,
  futureNoteOf,
} from "./entry-view-model";

/** 要対応に出す予定の範囲。今日から先1週間ぶんまで拾う */
const PENDING_LOOKAHEAD_DAYS = 7;

export function EntryScreen() {
  const { data, setData, today, session } = useAppData();

  /** 手入力・編集のモーダル。null なら閉じている */
  const [form, setForm] = useState<Actual | null>(null);
  /** 編集中の実績の id。新規入力なら null */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deferring, setDeferring] = useState<ForecastInstance | null>(null);
  /* 候補の確定で分類を引き継いだときの知らせ（AC-46） */
  const [inherited, setInherited] = useState<string | null>(null);

  /** 要対応リストを全件出すか（B-2） */
  const [showAllTodo, setShowAllTodo] = useState(false);
  /** ［ほかの操作］を開いている行。1度に1行だけ */
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  /* 実績一覧（FR-42） */
  const [listMonth, setListMonth] = useState<string | null>(null);
  const [listPage, setListPage] = useState(0);
  /** 一覧を絞る口座。`"all"` は絞らない */
  const [accountScope, setAccountScope] = useState<string>("all");

  const computed = useMemo(() => {
    if (!today || data.accounts.length === 0) {
      return { todo: [] as TodoRow[], candidateCount: 0, series: null };
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
      /* PageHeader の残高サマリー。ほかの画面と同じ数字を出す（AC-49） */
      series,
    };
  }, [data, today]);

  const list = useMemo(() => {
    /* **振替は2つの口座に関わる。** 出す側だけで絞ると、その口座へ
       入ってきた振替が一覧から落ちる。判定は core の1箇所（§2.8） */
    const actuals =
      accountScope === "all"
        ? data.actuals
        : data.actuals.filter((a) => touchesAccount(a, accountScope));
    return buildActualList({ actuals, yearMonth: listMonth, page: listPage });
  }, [data.actuals, listMonth, listPage, accountScope]);

  if (!today) return <Panel title="実績入力">読み込み中…</Panel>;

  if (data.accounts.length === 0) {
    return (
      <Panel title="実績入力">
        <p className="t-body text-foreground">まだ口座が登録されていません。</p>
        <p className="t-body-sm text-muted-foreground">
          先に「予定の設定」で口座を登録してください。
        </p>
      </Panel>
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
      const plan = row.plans.find((c) => c.plan.key === planKey)?.plan;
      if (!plan) return;

      setData((d) => reconciled(linkActualToPlan(d, row.actual.id, plan)));
      /* 分類を予定から引き継ぐので、変わったことを画面に出す（AC-46） */
      setInherited(
        describeInheritance(
          plan.name,
          plan,
          classificationChanges(row.actual, plan),
        ),
      );
      track(session?.user.id, "candidate_resolved", {
        confirmed: true,
        candidateCount: row.plans.length,
      });
    },
    markUnplanned: (row: TodoCandidateRow) => {
      setInherited(null);
      setData((d) => reconciled(setUnplanned(d, row.actual.id, true)));
      track(session?.user.id, "candidate_resolved", {
        confirmed: false,
        candidateCount: row.plans.length,
      });
    },
  };

  const todoById = new Map<string, TodoRow>(
    computed.todo.map((row) => [
      row.kind === "plan" ? row.plan.key : row.actual.id,
      row,
    ]),
  );
  const planRow = (id: string) => {
    const row = todoById.get(id);
    return row?.kind === "plan" ? row : null;
  };
  const candidateRow = (id: string) => {
    const row = todoById.get(id);
    return row?.kind === "candidate" ? row : null;
  };

  const visibleTodo = showAllTodo
    ? computed.todo
    : computed.todo.slice(0, TODO_PREVIEW_COUNT);

  return (
    <EntryView
      stats={computed.series ? buildHeaderStats(computed.series, data.accounts, today) : []}
      headerAction={
        <div className="flex flex-wrap items-center gap-12">
          <label className="flex shrink-0 items-center gap-8 whitespace-nowrap t-body-sm text-muted-foreground">
            口座
            <Select
              aria-label="絞り込む口座"
              value={accountScope}
              onChange={(e) => {
                setAccountScope(e.target.value);
                /* 件数が変わるので、見ているページを先頭に戻す */
                setListPage(0);
              }}
            >
              <option value="all">すべて</option>
              {/* **カードも出す。** 一覧の絞り込みなので、カード払いの
                  実績を抜き出したいことがある。残高を出す画面ではない */}
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
          <Link href="/import">
            <Button>
              <ArrowUpTrayIcon />
              CSVを取り込む
            </Button>
          </Link>
        </div>
      }
      todoCount={computed.todo.length}
      todos={buildEntryTodoRows(visibleTodo)}
      openRowId={openRowId}
      onSettleAsIs={(id) => {
        const row = planRow(id);
        if (row) actions.settleAsIs(row);
      }}
      onToggleOther={(id) => setOpenRowId((prev) => (prev === id ? null : id))}
      onSettleWithAmount={(id, amount) => {
        const row = planRow(id);
        if (row) actions.settleWithAmount(row, amount);
        setOpenRowId(null);
      }}
      onDefer={(id) => {
        const row = planRow(id);
        if (row) actions.defer(row);
        setOpenRowId(null);
      }}
      onLink={(rowId, candidateId) => {
        const row = candidateRow(rowId);
        if (row) actions.linkTo(row, candidateId);
      }}
      onUnplanned={(id) => {
        const row = candidateRow(id);
        if (row) actions.markUnplanned(row);
      }}
      months={buildEntryMonths(list, today)}
      onSelectMonth={(value) => {
        setListMonth(value);
        setListPage(0);
      }}
      futureNote={futureNoteOf(list, today) ?? undefined}
      actuals={buildEntryActualRows(list.rows).map((row) => ({
        ...row,
        /* FR-41。CSV取込で費目を誤って推測された分を、削除せずに直せるようにする */
        actions: (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const actual = list.rows.find((a) => a.id === row.id);
                if (actual) startEdit(actual);
              }}
            >
              編集
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setData((d) => removeActual(d, row.id))}
            >
              削除
            </Button>
          </>
        ),
      }))}
      /* ---- ここから下は v0.6.0 の Figma に無い（ADR-0023） ---- */
      notices={
        <>
          {computed.candidateCount > 0 && (
            <Callout tone="caution">
              同じ取引かもしれない実績と予定が{computed.candidateCount}組あります。
              両方が残高に乗っているため、残高が実際より低く出ています。
            </Callout>
          )}
          {/* 予定から分類を引き継いだことを黙って済ませない（AC-46） */}
          {inherited && <Callout tone="info">{inherited}</Callout>}
        </>
      }
      todoFooter={
        /* B-2。古いものから20件だけ出し、残りは開いて見せる */
        computed.todo.length > TODO_PREVIEW_COUNT ? (
          <div className="flex flex-wrap items-center gap-12">
            <span className="num t-body-sm text-muted-foreground">
              {showAllTodo
                ? `${computed.todo.length}件すべて`
                : `${TODO_PREVIEW_COUNT}件 ／ ${computed.todo.length}件`}
              を表示しています
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAllTodo(!showAllTodo)}
            >
              {showAllTodo ? "古い20件だけ表示" : "すべて表示"}
            </Button>
          </div>
        ) : undefined
      }
      listAction={
        <Button variant="outline" size="sm" onClick={startForm}>
          手入力する（例外のときだけ）
        </Button>
      }
      listFooter={
        <div className="flex flex-col gap-8">
          {/* 月内が上限を超えたときだけ出す。無限スクロールは採らない
              （§5.1「一覧の表示件数」）。狙った位置に到達できないため */}
          {list.pageCount > 1 && (
            <div className="flex flex-wrap items-center gap-12">
              <Button
                variant="outline"
                size="sm"
                disabled={list.page === 0}
                onClick={() => setListPage(list.page - 1)}
              >
                前の{MONTH_PAGE_SIZE}件
              </Button>
              <span className="num t-body-sm text-muted-foreground">
                {formatActualListFooter(list)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={list.page >= list.pageCount - 1}
                onClick={() => setListPage(list.page + 1)}
              >
                次の{MONTH_PAGE_SIZE}件
              </Button>
            </div>
          )}
          <p className="t-body-sm text-muted-foreground">
            月ごとに区切って全{list.total}件を出しています。
            月を切り替えるとすべての実績に辿り着けます（AC-28）。
          </p>
        </div>
      }
      dialog={
        <>
          {/* 繰延（FR-07） */}
          {deferring && (
            <DeferralEditor plan={deferring} onClose={() => setDeferring(null)} />
          )}
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
        </>
      }
    />
  );
}
