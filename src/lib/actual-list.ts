/**
 * 実績一覧の月単位表示（FR-42）
 *
 * 一次情報：docs/要件定義書.md §5.1「一覧の表示件数」
 * 対応する受入基準：AC-28
 *
 * > 件数の多い一覧は全件を描画しない。**ただし総件数だけを表示して到達手段の
 * > ない状態にしてはならない。** 実績一覧は月単位で区切り、月内200件を超えた
 * > 場合のみ件数ページングを併用する。無限スクロールは採用しない。
 *
 * 従来は日付降順の先頭40件だけを描画しながら、見出しには総件数を出していた。
 * 120件あると「最近の実績（120件）」と表示されて40行しか出ず、**残り80件へ
 * 到達する手段が画面上に無い**状態だった。
 *
 * 月で区切るのは、この画面の目的が「特定の1件を探して直す」ことだからである。
 * 利用者は「先月のあの支払い」という形で覚えている。無限スクロールは狙った
 * 位置に到達できないため採らない。
 */

import { toYearMonth } from "@/core/date";
import type { Actual, YearMonth } from "@/core/types";

/**
 * 1ヶ月ぶんを一度に描画する上限。
 *
 * これを超えた月だけページングに切り替える。個人事業主の実績は月100件前後を
 * 想定しており（§5.1 の CSV取込1,000行／回とは桁が違う）、通常の月は
 * 1ページに収まる。
 */
export const MONTH_PAGE_SIZE = 200;

/** 月の見出し1つぶん。 */
export interface ActualMonth {
  yearMonth: YearMonth;
  count: number;
}

export interface ActualListInput {
  actuals: Actual[];
  /** 表示する月。null なら最も新しい月 */
  yearMonth: YearMonth | null;
  /** 0 始まり。月内が MONTH_PAGE_SIZE を超えるときだけ意味を持つ */
  page?: number;
}

export interface ActualListView {
  /** 選べる月。新しい順 */
  months: ActualMonth[];
  /** 実際に表示している月。実績が1件も無ければ null */
  yearMonth: YearMonth | null;
  /** その月の総件数 */
  monthCount: number;
  /** 描画する行。日付の降順、同日は id の降順（新しく入れたものが上） */
  rows: Actual[];
  /** ページ数。1 ならページングを出さない */
  pageCount: number;
  /** 実際に表示しているページ（0 始まり） */
  page: number;
  /** 全期間の総件数。見出しに出す */
  total: number;
}

/**
 * 実績一覧を組み立てる。
 *
 * **見出しに出した件数のすべてに到達できること**が要件（AC-28）。
 * 総件数 = 各月の件数の合計 になっており、月の切替とページングだけで
 * すべての行に到達できる。
 */
export function buildActualList({
  actuals,
  yearMonth,
  page = 0,
}: ActualListInput): ActualListView {
  /* 月ごとの件数。1パスで数える */
  const counts = new Map<YearMonth, number>();
  for (const actual of actuals) {
    const ym = toYearMonth(actual.date);
    counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }

  const months: ActualMonth[] = [...counts.entries()]
    .map(([ym, count]) => ({ yearMonth: ym, count }))
    .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1));

  const total = actuals.length;

  if (months.length === 0) {
    return {
      months,
      yearMonth: null,
      monthCount: 0,
      rows: [],
      pageCount: 1,
      page: 0,
      total,
    };
  }

  /* 指定が無い、または消えた月を指している場合は最も新しい月に寄せる */
  const active =
    yearMonth !== null && counts.has(yearMonth) ? yearMonth : months[0].yearMonth;

  const inMonth = actuals
    .filter((a) => toYearMonth(a.date) === active)
    .sort((a, b) =>
      a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1,
    );

  const pageCount = Math.max(1, Math.ceil(inMonth.length / MONTH_PAGE_SIZE));
  /* 月を切り替えるとページが範囲外になりうる。丸めて空表示を避ける */
  const activePage = Math.min(Math.max(0, page), pageCount - 1);

  return {
    months,
    yearMonth: active,
    monthCount: inMonth.length,
    rows: inMonth.slice(
      activePage * MONTH_PAGE_SIZE,
      (activePage + 1) * MONTH_PAGE_SIZE,
    ),
    pageCount,
    page: activePage,
    total,
  };
}
