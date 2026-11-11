/**
 * 実績入力の行を EntryView の形に移す（SC-05）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、docs/design/screens.md 04
 *
 * **純関数にしてある。** 本番の画面は Supabase に繋がないと開けないので、
 * ここに出していないと配線を目視でしか確かめられない。
 * ダッシュボード・キャッシュフロー・年月別 収支と同じ形。
 */

import { viewDelta } from "@/core/balance";
import type { Account, Actual, DateStr, ForecastInstance } from "@/core/types";
import { isCard } from "@/core/types";
import { amountView } from "@/components/sakiguri/amount-view";
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
 * 符号を見る範囲（AC-58b）。
 *
 * **カードも範囲に入れる。** この画面の行は「その行の口座がどちらに
 * 動いたか」を示すので、カードの利用も減ったと出す。現預金だけで足すと
 * **カード払いの予定が符号を失う**（合計の残高が動くのは引落日なので0）。
 *
 * `deposits` は振替が合計の中で閉じるかの判定だけに使う。**範囲とは別物**
 * ―― 範囲で判定すると、銀行→現金の振替が「閉じていない」と誤判定される
 * （`core/balance` の `viewDelta`）。
 */
export interface EntryAmountScope {
  viewed: readonly string[];
  deposits: ReadonlySet<string>;
}

export function entryAmountScope(accounts: readonly Account[]): EntryAmountScope {
  return {
    viewed: accounts.map((a) => a.id),
    deposits: new Set(accounts.filter((a) => !isCard(a)).map((a) => a.id)),
  };
}

/** 画面に出す金額。**符号は残高の動きから、色は費目から**（`amountView`） */
function displayOf(
  item: Pick<Actual, "type" | "amount" | "accountId" | "toAccountId">,
  category: Category | null,
  scope: EntryAmountScope,
) {
  return amountView({
    amount: item.amount,
    delta: viewDelta(item, scope.viewed, scope.deposits),
    category,
    type: item.type,
  });
}

function planToRow(plan: ForecastInstance, scope: EntryAmountScope) {
  const category = categoryTagFor(plan.categoryCode, plan.costType);
  return {
    id: plan.key,
    date: formatMonthDay(plan.date),
    title: plan.name,
    amount: plan.amount,
    display: displayOf(plan, category, scope),
    category,
  };
}

function actualToRow(actual: Actual, scope: EntryAmountScope) {
  const category = categoryTagFor(actual.categoryCode, actual.costType);
  return {
    id: actual.id,
    date: formatMonthDay(actual.date),
    title: actual.name,
    amount: actual.amount,
    display: displayOf(actual, category, scope),
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
export function buildEntryTodoRows(
  rows: readonly TodoRow[],
  scope: EntryAmountScope,
): EntryTodoRow[] {
  return rows.map((row) =>
    row.kind === "plan"
      ? { kind: "plan" as const, ...planToRow(row.plan, scope) }
      : {
          kind: "candidate" as const,
          ...actualToRow(row.actual, scope),
          candidates: row.plans.map((c) => planToRow(c.plan, scope)),
        },
  );
}

export function buildEntryActualRows(
  rows: readonly Actual[],
  scope: EntryAmountScope,
): EntryActualRow[] {
  return rows.map((row) => actualToRow(row, scope));
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

