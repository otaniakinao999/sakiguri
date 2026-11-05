import { describe, expect, it } from "vitest";

import type { OneoffItem, RecurringItem } from "@/core/types";

import {
  applyOrder,
  comparePlans,
  freshOrder,
  nextSort,
  type PlanSort,
} from "../plan-order";

/**
 * 予定の表の並べ替え。
 *
 * **ここで守るのは「値を打ち替えても行が動かない」こと。**
 * 設定の表は常時編集できるグリッドで、並べ替えの基準になる列も編集
 * できる。素朴に毎描画で並べ直すと、1打鍵ごとに行が動く。
 */

function oneoff(over: Partial<OneoffItem> & Pick<OneoffItem, "id">): OneoffItem {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    date: "2026-04-05",
    ...over,
  };
}

function recurring(
  over: Partial<RecurringItem> & Pick<RecurringItem, "id">,
): RecurringItem {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    day: 25,
    months: null,
    active: true,
    ...over,
  };
}

const ACCOUNTS = ["a1", "a2", "a3"];
const BY_AMOUNT: PlanSort = { column: "amount", direction: "asc" };
const byOneoffDate = (sort: PlanSort) =>
  comparePlans<OneoffItem>(sort, ACCOUNTS, (item) => item.date);
const byRecurringDay = (sort: PlanSort) =>
  comparePlans<RecurringItem>(sort, ACCOUNTS, (item) => item.day);

describe("comparePlans", () => {
  it("金額の昇順に並ぶ", () => {
    const rows = [
      oneoff({ id: "x", amount: 300 }),
      oneoff({ id: "y", amount: 100 }),
      oneoff({ id: "z", amount: 200 }),
    ];

    expect(freshOrder(rows, byOneoffDate(BY_AMOUNT))).toEqual(["y", "z", "x"]);
  });

  it("発生日は**数として**比べる（10 が 2 より後に来る）", () => {
    /* 文字列で比べると "10" < "2" になり、月初と月末が入れ替わる */
    const rows = [
      recurring({ id: "x", day: 10 }),
      recurring({ id: "y", day: 2 }),
      recurring({ id: "z", day: 31 }),
    ];

    const sort: PlanSort = { column: "when", direction: "asc" };

    expect(freshOrder(rows, byRecurringDay(sort))).toEqual(["y", "x", "z"]);
  });

  it("日付は日付として比べる", () => {
    const rows = [
      oneoff({ id: "x", date: "2026-04-10" }),
      oneoff({ id: "y", date: "2026-04-02" }),
      oneoff({ id: "z", date: "2026-12-01" }),
    ];

    const sort: PlanSort = { column: "when", direction: "asc" };

    expect(freshOrder(rows, byOneoffDate(sort))).toEqual(["y", "x", "z"]);
  });

  it("口座は**表示順**で並ぶ（名前順ではない）", () => {
    /* プルダウンの順と食い違うと、同じ口座が表と選択肢で違う位置に出る */
    const rows = [
      oneoff({ id: "x", accountId: "a3" }),
      oneoff({ id: "y", accountId: "a1" }),
      oneoff({ id: "z", accountId: "a2" }),
    ];

    const sort: PlanSort = { column: "account", direction: "asc" };

    expect(freshOrder(rows, byOneoffDate(sort))).toEqual(["y", "z", "x"]);
  });

  it("収支はプルダウンと同じ順（収入・支出・振替）", () => {
    const rows = [
      oneoff({ id: "x", type: "transfer", costType: null }),
      oneoff({ id: "y", type: "income", costType: null }),
      oneoff({ id: "z", type: "expense" }),
    ];

    const sort: PlanSort = { column: "type", direction: "asc" };

    expect(freshOrder(rows, byOneoffDate(sort))).toEqual(["y", "z", "x"]);
  });

  it("固定/変動が無い行（収入・振替）は後ろ", () => {
    const rows = [
      oneoff({ id: "x", type: "income", costType: null }),
      oneoff({ id: "y", costType: "variable" }),
      oneoff({ id: "z", costType: "fixed" }),
    ];

    const sort: PlanSort = { column: "costType", direction: "asc" };

    expect(freshOrder(rows, byOneoffDate(sort))).toEqual(["z", "y", "x"]);
  });

  it("費目は**コード**の昇順（表示名で並べない）", () => {
    const rows = [
      oneoff({ id: "x", categoryCode: "EXP-10" }),
      oneoff({ id: "y", categoryCode: "EXP-02" }),
    ];

    const sort: PlanSort = { column: "category", direction: "asc" };

    expect(freshOrder(rows, byOneoffDate(sort))).toEqual(["y", "x"]);
  });

  it("同値は id で割れて、向きを変えても同値どうしは入れ替わらない", () => {
    /* 割らないと `sort` の実装次第になり、同じ操作で違う並びが出る */
    const rows = [
      oneoff({ id: "b", amount: 100 }),
      oneoff({ id: "a", amount: 100 }),
    ];

    expect(freshOrder(rows, byOneoffDate(BY_AMOUNT))).toEqual(["a", "b"]);
    expect(
      freshOrder(rows, byOneoffDate({ column: "amount", direction: "desc" })),
    ).toEqual(["a", "b"]);
  });

  it("降順は昇順の逆", () => {
    const rows = [
      oneoff({ id: "x", amount: 300 }),
      oneoff({ id: "y", amount: 100 }),
      oneoff({ id: "z", amount: 200 }),
    ];

    expect(
      freshOrder(rows, byOneoffDate({ column: "amount", direction: "desc" })),
    ).toEqual(["x", "z", "y"]);
  });
});

describe("nextSort", () => {
  it("同じ列を押すと向きが反転する", () => {
    expect(nextSort(BY_AMOUNT, "amount")).toEqual({
      column: "amount",
      direction: "desc",
    });
  });

  it("違う列を押すと昇順から始まる", () => {
    expect(nextSort({ column: "amount", direction: "desc" }, "name")).toEqual({
      column: "name",
      direction: "asc",
    });
  });
});

describe("applyOrder", () => {
  const rows = [
    oneoff({ id: "x", amount: 300 }),
    oneoff({ id: "y", amount: 100 }),
    oneoff({ id: "z", amount: 200 }),
  ];

  it("覚えている順序が空（初回）なら完全に並ぶ", () => {
    expect(applyOrder([], rows, byOneoffDate(BY_AMOUNT)).map((r) => r.id)).toEqual([
      "y",
      "z",
      "x",
    ]);
  });

  it("**値を打ち替えても行は動かない**", () => {
    const order = freshOrder(rows, byOneoffDate(BY_AMOUNT));
    expect(order).toEqual(["y", "z", "x"]);

    /* y の金額を、いちばん大きい 999 に打ち替える */
    const edited = rows.map((row) => (row.id === "y" ? { ...row, amount: 999 } : row));

    expect(applyOrder(order, edited, byOneoffDate(BY_AMOUNT)).map((r) => r.id)).toEqual(
      ["y", "z", "x"],
    );
  });

  it("毎描画で並べ直すと動くことを、同じデータで示す", () => {
    /* **これが直したい挙動。** 比較のためにここで素朴な実装を書く。
       `applyOrder` を使わずに並べると、打鍵のたびに行が末尾へ移る */
    const edited = rows.map((row) => (row.id === "y" ? { ...row, amount: 999 } : row));

    const naive = [...edited].sort(byOneoffDate(BY_AMOUNT)).map((r) => r.id);

    expect(naive).toEqual(["z", "x", "y"]);
    expect(naive).not.toEqual(["y", "z", "x"]);
  });

  it("増えた行は末尾に付く（表の真ん中に入らない）", () => {
    const order = freshOrder(rows, byOneoffDate(BY_AMOUNT));

    /* 金額 1 なら本来いちばん前。それでも末尾に出す */
    const added = [...rows, oneoff({ id: "new", amount: 1 })];

    expect(applyOrder(order, added, byOneoffDate(BY_AMOUNT)).map((r) => r.id)).toEqual([
      "y",
      "z",
      "x",
      "new",
    ]);
  });

  it("増えた行が複数なら、互いは並べて末尾に付く", () => {
    const order = freshOrder(rows, byOneoffDate(BY_AMOUNT));
    const added = [
      ...rows,
      oneoff({ id: "n2", amount: 50 }),
      oneoff({ id: "n1", amount: 10 }),
    ];

    expect(applyOrder(order, added, byOneoffDate(BY_AMOUNT)).map((r) => r.id)).toEqual([
      "y",
      "z",
      "x",
      "n1",
      "n2",
    ]);
  });

  it("消した行は落ち、残りの順序は保たれる", () => {
    const order = freshOrder(rows, byOneoffDate(BY_AMOUNT));
    const left = rows.filter((row) => row.id !== "z");

    expect(applyOrder(order, left, byOneoffDate(BY_AMOUNT)).map((r) => r.id)).toEqual([
      "y",
      "x",
    ]);
  });

  it("**同じ順序をもう一度当てても変わらない（冪等）**", () => {
    /* 画面側は描画のあとに、算出した順序を覚え直す。**当てるたびに
       変われば、その覚え直しが止まらない。** ここが冪等であることに
       依っているので、留め具として置く */
    const once = applyOrder([], rows, byOneoffDate(BY_AMOUNT)).map((r) => r.id);
    const twice = applyOrder(once, rows, byOneoffDate(BY_AMOUNT)).map((r) => r.id);
    const thrice = applyOrder(twice, rows, byOneoffDate(BY_AMOUNT)).map((r) => r.id);

    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  it("見出しを押せば並び直る", () => {
    const order = freshOrder(rows, byOneoffDate(BY_AMOUNT));
    const edited = rows.map((row) => (row.id === "y" ? { ...row, amount: 999 } : row));

    /* 値を変えても動かないが、押せば今の値で並ぶ */
    const pressed = freshOrder(edited, byOneoffDate(BY_AMOUNT));

    expect(applyOrder(pressed, edited, byOneoffDate(BY_AMOUNT)).map((r) => r.id)).toEqual(
      ["z", "x", "y"],
    );
    expect(order).toEqual(["y", "z", "x"]);
  });
});
