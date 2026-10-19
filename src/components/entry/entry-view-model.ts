/**
 * 実績入力の行を EntryView の形に移す（SC-05）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、docs/design/screens.md 04
 *
 * **純関数にしてある。** 本番の画面は Supabase に繋がないと開けないので、
 * ここに出していないと配線を目視でしか確かめられない。
 * ダッシュボード・キャッシュフロー・年月別 収支と同じ形。
 */

import type { Actual, DateStr, EntryType, ForecastInstance } from "@/core/types";
import type { AmountType } from "@/components/sakiguri/Amount";
import { categoryTagFor, type Category } from "@/components/sakiguri/CategoryTag";
import type { ActualListView } from "@/lib/actual-list";
import { formatMonthDay, formatYearMonthLabel } from "@/lib/format";
import type { TodoRow } from "@/lib/todo-list";

import type {
  EntryActualRow,
  EntryMonth,
  EntryTodoRow,
} from "./EntryView";

/**
 * 金額の向き。
 *
 * **振替は neutral。** 口座の間を動くだけで合計は変わらないので、
 * 収入にも支出にも色を付けない（キャッシュフローと同じ扱い）。
 */
export function amountTypeOf(type: EntryType, category: Category | null): AmountType {
  if (category === "振替" || type === "transfer") return "neutral";
  return type === "income" ? "income" : "expense";
}

function planToRow(plan: ForecastInstance) {
  const category = categoryTagFor(plan.categoryCode, plan.costType);
  return {
    id: plan.key,
    date: formatMonthDay(plan.date),
    title: plan.name,
    amount: plan.amount,
    amountType: amountTypeOf(plan.type, category),
    category,
  };
}

function actualToRow(actual: Actual) {
  const category = categoryTagFor(actual.categoryCode, actual.costType);
  return {
    id: actual.id,
    date: formatMonthDay(actual.date),
    title: actual.name,
    amount: actual.amount,
    amountType: amountTypeOf(actual.type, category),
    category,
  };
}

/**
 * 要対応リスト。
 *
 * **行の id は操作の宛先になる。** 予定の行は予定インスタンスのキー、
 * 実績の行は実績の id。照合（linkTo）は行の id と候補の id の両方を使う
 * ので、候補の id には予定のキーを入れる。
 */
export function buildEntryTodoRows(rows: readonly TodoRow[]): EntryTodoRow[] {
  return rows.map((row) =>
    row.kind === "plan"
      ? { kind: "plan" as const, ...planToRow(row.plan) }
      : {
          kind: "candidate" as const,
          ...actualToRow(row.actual),
          candidates: row.plans.map((c) => planToRow(c.plan)),
        },
  );
}

export function buildEntryActualRows(rows: readonly Actual[]): EntryActualRow[] {
  return rows.map(actualToRow);
}

/**
 * 月のタブ（components.md MonthTab）。
 *
 * **基準日より後の月は `future`。** 実績が揃っていないのが普通の状態で、
 * 件数が少ないことを異常と読まれないようにする。
 */
export function buildEntryMonths(
  list: ActualListView,
  today: DateStr,
): EntryMonth[] {
  const thisMonth = today.slice(0, 7);
  return list.months.map((m) => ({
    value: m.yearMonth,
    label: formatYearMonthLabel(m.yearMonth),
    state:
      m.yearMonth === list.yearMonth
        ? ("active" as const)
        : m.yearMonth > thisMonth
          ? ("future" as const)
          : ("inactive" as const),
  }));
}

/**
 * 未来の月を見ているときの注記（screens.md 04）。
 *
 * 見ていない月については出さない。今月以前なら null。
 */
export function futureNoteOf(list: ActualListView, today: DateStr): string | null {
  if (list.yearMonth === null) return null;
  return list.yearMonth > today.slice(0, 7)
    ? "未来の月にある実績は、前払いでなければ日付の打ち間違いかもしれません。"
    : null;
}

/** 一覧の下の件数表示（AC-28）。 */
export function formatActualListFooter(list: ActualListView): string {
  if (list.pageCount <= 1) return "";
  const from = list.page * list.rows.length + 1;
  return `${from}〜${from + list.rows.length - 1} 件目 ／ ${list.monthCount}件（${list.page + 1}/${list.pageCount}ページ）`;
}

