"use client";

/**
 * 実績一覧（FR-42・FR-54）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、§3.1 FR-41・FR-42
 * 対応する受入基準：AC-28、AC-28a、AC-61
 *
 * **やること（`EntryScreen`）と別のページ。** 照合の候補はあちらにある。
 * ここは記録済みの実績を月ごとに辿り、費目や口座の間違いを直す場所である。
 *
 * **未照合の実績もこの一覧に出る**（AC-61）。照合の導線をやること側に
 * 寄せたので、ここで選り分けてしまうと**どちらからも直せない実績**が
 * できる。一覧は実績を絞らず、月と口座だけで区切る。
 *
 * **残高サマリーの計算の並べ方は他の画面と同じ。** CL-1 → CL-3 →
 * `buildHeaderStats` の順で、6つの画面が同じ形を持っている（この画面で
 * 7つめ）。ここだけ別の経路で出すと、同じ「現預金 見込み」が画面ごとに
 * 違う計算から出ることになる（CLAUDE.md §2.12）。
 */

import { useMemo, useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { touchesAccount } from "@/core/types";
import type { Actual } from "@/core/types";
import { Select } from "@/components/ui/inputs";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/legacy/Modal";
import { Panel } from "@/components/sakiguri/Panel";
import { buildHeaderStats } from "@/lib/header-stats";
import { buildActualList, MONTH_PAGE_SIZE } from "@/lib/actual-list";
import { editableActualFields, removeActual, updateActual } from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";

import { ActualForm, applyActualPatch, isSubmittable } from "./ActualForm";
import { ActualsView } from "./ActualsView";
import {
  buildEntryActualRows,
  buildEntryMonths,
  entryAmountScope,
  formatActualListFooter,
  futureNoteOf,
} from "./entry-view-model";

export function ActualsScreen() {
  const { data, setData, today } = useAppData();

  /* 金額の符号を見る範囲（AC-58b）。カードも入れる ―― この画面の行は
     その行の口座の動きを示す（`entryAmountScope`） */
  const amountScope = useMemo(() => entryAmountScope(data.accounts), [data.accounts]);

  /** 編集中の実績（FR-41）。null なら閉じている */
  const [form, setForm] = useState<Actual | null>(null);
  const [listMonth, setListMonth] = useState<string | null>(null);
  const [listPage, setListPage] = useState(0);
  /** 一覧を絞る口座。`"all"` は絞らない */
  const [accountScope, setAccountScope] = useState<string>("all");

  const stats = useMemo(() => {
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
    return buildHeaderStats(series, data.accounts, today);
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

  if (!today) return <Panel title="実績一覧">読み込み中…</Panel>;

  if (data.accounts.length === 0) {
    return (
      <Panel title="実績一覧">
        <p className="t-body text-foreground">まだ口座が登録されていません。</p>
        <p className="t-body-sm text-muted-foreground">
          先に「予定の設定」で口座を登録してください。
        </p>
      </Panel>
    );
  }

  const submit = () => {
    if (!form || !isSubmittable(form)) return;
    /* 編集できる項目は1箇所で決める（§2.8）。id と key は保持される */
    setData((d) => updateActual(d, form.id, editableActualFields(form)));
    setForm(null);
  };

  return (
    <ActualsView
      stats={stats}
      headerAction={
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
      }
      months={buildEntryMonths(list, today)}
      onSelectMonth={(value) => {
        setListMonth(value);
        setListPage(0);
      }}
      futureNote={futureNoteOf(list, today) ?? undefined}
      actuals={buildEntryActualRows(list.rows, amountScope).map((row) => ({
        ...row,
        /* FR-41。CSV取込で費目を誤って推測された分を、削除せずに直せるようにする */
        actions: (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const actual = list.rows.find((a) => a.id === row.id);
                if (actual) setForm({ ...actual });
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
            予定との照合は「実績入力」のやることで行います。
          </p>
        </div>
      }
      dialog={
        form && (
          /* 出し方は手入力・繰延・明細の編集と同じ（FR-55・AC-60） */
          <Modal title="実績を編集" onClose={() => setForm(null)}>
            <ActualForm
              value={form}
              accounts={data.accounts}
              mode="edit"
              onChange={(patch) => setForm((f) => (f ? applyActualPatch(f, patch) : f))}
              onSubmit={submit}
              onCancel={() => setForm(null)}
            />
          </Modal>
        )
      }
    />
  );
}
