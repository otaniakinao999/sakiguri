"use client";

/**
 * SC-05 実績入力（やること）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、§4.1.1 実績入力の構成
 * 対応する機能要件：FR-05（手入力）、FR-06（消し込み）、FR-07（繰延）、
 *                   FR-46（照合候補）、FR-54（ページを分ける）、
 *                   FR-55（編集の画面の出し方）
 * 対応する受入基準：AC-03、AC-27、AC-30、AC-37、AC-59、AC-60、AC-61
 *
 * **1カラム。** 高さが伸びる要対応リストと高さの固定された入力フォームを
 * 横に並べると、件数が増えた時点で必ず崩れる。
 *
 * **主従を分ける。** 想定フローは「CSV取込 → 自動照合 → 残りを消し込み」で、
 * 手入力は例外処理である。要対応リストを主とし、手入力はボタンから
 * モーダルで開く。
 *
 * **実績一覧は `/actuals` に分けた**（FR-54・AC-61）。照合の候補はこちらに
 * 残る ―― 未照合の実績を予定に結びつけるのは、やることを片付ける操作
 * である。編集は一覧側と入出金予定表にあり、どちらも同じ `Modal` を通る
 * （AC-60）。
 */

import { useMemo, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { classificationChanges } from "@/core/classification";
import { addDays } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import type { Actual, ForecastInstance, Yen } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import Link from "next/link";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/legacy/Modal";
import { Callout } from "@/components/sakiguri/Callout";
import { Panel } from "@/components/sakiguri/Panel";
import { buildHeaderStats } from "@/lib/header-stats";
import { describeInheritance } from "@/lib/classification-notice";
import {
  addActual,
  blankActual,
  linkActualToPlan,
  markReconciled,
  newId,
  setUnplanned,
  settleAsPlanned,
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
import { buildEntryTodoRows, entryAmountScope } from "./entry-view-model";

/** 要対応に出す予定の範囲。今日から先1週間ぶんまで拾う */
const PENDING_LOOKAHEAD_DAYS = 7;

export function EntryScreen() {
  const { data, setData, today, session } = useAppData();

  /* 金額の符号を見る範囲（AC-58b）。カードも入れる ―― この画面の行は
     その行の口座の動きを示す（`entryAmountScope`） */
  const amountScope = useMemo(() => entryAmountScope(data.accounts), [data.accounts]);

  /** 手入力のフォーム。null なら閉じている */
  const [form, setForm] = useState<Actual | null>(null);
  /**
   * 繰延（FR-07）。**打った額を一緒に持つ**（AC-59）。
   *
   * `plan` には混ぜない ―― `DeferralEditor` が「実際に変えたものだけを
   * 書く」判定を `plan.amount` との比較で行うため、混ぜると打った額が
   * 記録から落ちる。
   */
  const [deferring, setDeferring] = useState<{
    plan: ForecastInstance;
    amount?: Yen;
  } | null>(null);
  /* 候補の確定で分類を引き継いだときの知らせ（AC-46） */
  const [inherited, setInherited] = useState<string | null>(null);

  /** 要対応リストを全件出すか（B-2） */
  const [showAllTodo, setShowAllTodo] = useState(false);
  /** ［ほかの操作］を開いている行。1度に1行だけ */
  const [openRowId, setOpenRowId] = useState<string | null>(null);

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

  /* ---------- 手入力 ---------- */

  const startForm = () => setForm(blankActual(newId(), data.accounts[0].id, today));

  const submit = () => {
    if (!form || !isSubmittable(form)) return;
    setData((d) => addActual(d, { ...form, name: form.name.trim() }));
    track(session?.user.id, "actual_recorded", {
      settled: form.key !== null,
      fromCsv: false,
    });
    setForm(null);
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
    defer: (row: TodoPlanRow, amount?: Yen) =>
      setDeferring({ plan: row.plan, amount }),
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
        <Link href="/import">
          <Button>
            <ArrowUpTrayIcon />
            CSVを取り込む
          </Button>
        </Link>
      }
      todoCount={computed.todo.length}
      todos={buildEntryTodoRows(visibleTodo, amountScope)}
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
      onDefer={(id, amount) => {
        const row = planRow(id);
        if (row) actions.defer(row, amount);
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
      todoAction={
        <Button variant="outline" size="sm" onClick={startForm}>
          手入力する（例外のときだけ）
        </Button>
      }
      footer={
        /* 一覧は別のページ（FR-54）。**ここから辿れるようにする** ――
           記録済みの実績を直したいとき、やることの画面には出てこない */
        <p className="t-body-sm text-muted-foreground">
          記録済みの実績は
          <Link
            href="/actuals"
            className="mx-4 text-fg-primary underline underline-offset-2"
          >
            実績一覧
          </Link>
          で月ごとに見られます。費目や口座の間違いはそちらで直します。
        </p>
      }
      dialog={
        <>
          {/* 繰延（FR-07）。**手入力・編集と同じ出し方を通す**（AC-60）。
              以前はここに裸で置いていたので、ページの末尾に開いていた */}
          {deferring && (
            <Modal
              title={`この回だけ動かす — ${deferring.plan.name}`}
              onClose={() => setDeferring(null)}
            >
              <DeferralEditor
                plan={deferring.plan}
                initialAmount={deferring.amount}
                onClose={() => setDeferring(null)}
              />
            </Modal>
          )}
          {form && (
            <Modal title="実績を手入力" onClose={() => setForm(null)}>
              <ActualForm
                value={form}
                accounts={data.accounts}
                mode="create"
                onChange={(patch) => setForm((f) => (f ? applyActualPatch(f, patch) : f))}
                onSubmit={submit}
                onCancel={() => setForm(null)}
              />
            </Modal>
          )}
        </>
      }
    />
  );
}
