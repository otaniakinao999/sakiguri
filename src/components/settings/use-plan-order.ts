"use client";

import { useEffect, useMemo, useState } from "react";

import {
  applyOrder,
  comparePlans,
  freshOrder,
  nextSort,
  type PlanSort,
  type PlanSortColumn,
  type PlanSortable,
  type WhenValue,
} from "@/lib/plan-order";

/**
 * 予定の表の並び順を持つ。
 *
 * **定期項目と単発の予定で同じ仕掛けなので、1箇所に置く**（CLAUDE.md
 * §2.12：同じ値を2通りに計算しない）。違うのは日付列の取り出し方
 * （発生日 / 日付）と既定の列だけで、それは引数で渡す。
 *
 * 肝は**覚えている順序を実体化すること。** 算出しただけで覚えずにいると、
 * `applyOrder` の「覚えている順序が空なら全部並べる」が毎描画で働いて、
 * 結果として毎描画で並べ直す（＝直したかった挙動に戻る）。だから描画の
 * あとに覚え直す。`applyOrder` は冪等なので1回で落ち着く。
 */
export function usePlanOrder<T extends PlanSortable>(
  rows: readonly T[],
  accountIds: readonly string[],
  when: (item: T) => WhenValue,
  initial: PlanSort,
): {
  sort: PlanSort;
  onSort: (column: PlanSortColumn) => void;
  visible: T[];
} {
  const [sort, setSort] = useState<PlanSort>(initial);

  const compare = useMemo(
    () => comparePlans<T>(sort, accountIds, when),
    [sort, accountIds, when],
  );

  /* 覚えている順序。**ここに入っている行は、値が変わっても動かない** */
  const [order, setOrder] = useState<string[]>([]);
  const visible = useMemo(() => applyOrder(order, rows, compare), [order, rows, compare]);

  useEffect(() => {
    const ids = visible.map((item) => item.id);
    const same = ids.length === order.length && ids.every((id, at) => id === order[at]);
    if (!same) setOrder(ids);
  }, [visible, order]);

  const onSort = (column: PlanSortColumn) => {
    const next = nextSort(sort, column);
    setSort(next);
    /* **押したときだけ、いまの値で並べ直す。** */
    setOrder(freshOrder(rows, comparePlans<T>(next, accountIds, when)));
  };

  return { sort, onSort, visible };
}
