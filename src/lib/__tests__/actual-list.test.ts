import { describe, expect, it } from "vitest";

import type { Actual } from "@/core/types";

import { buildActualList, MONTH_PAGE_SIZE } from "../actual-list";

/**
 * FR-42 / AC-28。
 *
 * 一次情報：docs/要件定義書.md §5.1「一覧の表示件数」
 *   総件数だけを表示して到達手段のない状態にしてはならない。
 */

function actual(over: Partial<Actual> & Pick<Actual, "id" | "date">): Actual {
  return {
    key: null,
    name: "スーパー",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 3_000,
    bizRatio: 0,
    accountId: "a1",
    ...over,
  };
}

/** `count` 件を同じ月に作る */
function inMonth(yearMonth: string, count: number, prefix = "x"): Actual[] {
  return Array.from({ length: count }, (_, i) =>
    actual({
      id: `${prefix}${String(i).padStart(6, "0")}`,
      /* 1〜28日に散らす。月末日の差を気にしなくて済む */
      date: `${yearMonth}-${String((i % 28) + 1).padStart(2, "0")}`,
    }),
  );
}

/* ========================= 月で区切る ========================= */

describe("AC-28 月で区切る", () => {
  it("月の一覧を新しい順で出す", () => {
    const got = buildActualList({
      actuals: [
        ...inMonth("2026-07", 3, "a"),
        ...inMonth("2026-09", 5, "b"),
        ...inMonth("2026-08", 1, "c"),
      ],
      yearMonth: null,
    });

    expect(got.months).toEqual([
      { yearMonth: "2026-09", count: 5 },
      { yearMonth: "2026-08", count: 1 },
      { yearMonth: "2026-07", count: 3 },
    ]);
  });

  it("指定が無ければ最も新しい月を出す", () => {
    const got = buildActualList({
      actuals: [...inMonth("2026-07", 3, "a"), ...inMonth("2026-09", 5, "b")],
      yearMonth: null,
    });

    expect(got.yearMonth).toBe("2026-09");
    expect(got.rows).toHaveLength(5);
  });

  it("指定した月だけを出す", () => {
    const got = buildActualList({
      actuals: [...inMonth("2026-07", 3, "a"), ...inMonth("2026-09", 5, "b")],
      yearMonth: "2026-07",
    });

    expect(got.yearMonth).toBe("2026-07");
    expect(got.monthCount).toBe(3);
    expect(got.rows.every((r) => r.date.startsWith("2026-07"))).toBe(true);
  });

  it("実績が消えて存在しなくなった月を指していたら、最も新しい月に寄せる", () => {
    const got = buildActualList({
      actuals: inMonth("2026-09", 2),
      yearMonth: "2026-01",
    });

    expect(got.yearMonth).toBe("2026-09");
    expect(got.rows).toHaveLength(2);
  });

  it("1件も無ければ空で返る", () => {
    const got = buildActualList({ actuals: [], yearMonth: null });

    expect(got).toMatchObject({
      months: [],
      yearMonth: null,
      monthCount: 0,
      rows: [],
      pageCount: 1,
      total: 0,
    });
  });
});

/* ========================= その月は全件 ========================= */

describe("AC-28 その月は全件を出す", () => {
  it("40件でも全件出る（従来は40件で頭打ちだった）", () => {
    const got = buildActualList({ actuals: inMonth("2026-09", 40), yearMonth: null });

    expect(got.rows).toHaveLength(40);
    expect(got.pageCount).toBe(1);
  });

  it("上限ちょうどまでは1ページ", () => {
    const got = buildActualList({
      actuals: inMonth("2026-09", MONTH_PAGE_SIZE),
      yearMonth: null,
    });

    expect(got.rows).toHaveLength(MONTH_PAGE_SIZE);
    expect(got.pageCount).toBe(1);
  });

  it("日付の降順。同日は後から入れたものが上", () => {
    const got = buildActualList({
      actuals: [
        actual({ id: "a", date: "2026-09-01" }),
        actual({ id: "c", date: "2026-09-10" }),
        actual({ id: "b", date: "2026-09-10" }),
      ],
      yearMonth: null,
    });

    expect(got.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

/* ========================= 上限超過のページング ========================= */

describe("AC-28 月内が上限を超えたときだけページングする", () => {
  const many = inMonth("2026-09", 450);

  it("ページ数を出す", () => {
    const got = buildActualList({ actuals: many, yearMonth: null });

    expect(got.monthCount).toBe(450);
    expect(got.pageCount).toBe(3);
    expect(got.rows).toHaveLength(MONTH_PAGE_SIZE);
  });

  it("最終ページは残りだけ", () => {
    const got = buildActualList({ actuals: many, yearMonth: null, page: 2 });

    expect(got.page).toBe(2);
    expect(got.rows).toHaveLength(50);
  });

  /** ここが AC-28 の本体。見出しの件数に到達できること */
  it("ページを順に辿ると、その月の全件に重複なく到達できる", () => {
    const seen: string[] = [];
    for (let page = 0; page < 3; page++) {
      seen.push(
        ...buildActualList({ actuals: many, yearMonth: null, page }).rows.map(
          (r) => r.id,
        ),
      );
    }

    expect(seen).toHaveLength(450);
    expect(new Set(seen).size).toBe(450);
  });

  it("月を辿ると総件数のすべてに到達できる", () => {
    const actuals = [
      ...inMonth("2026-07", 250, "a"),
      ...inMonth("2026-08", 30, "b"),
      ...inMonth("2026-09", 450, "c"),
    ];
    const head = buildActualList({ actuals, yearMonth: null });

    let reached = 0;
    for (const month of head.months) {
      const first = buildActualList({ actuals, yearMonth: month.yearMonth });
      for (let page = 0; page < first.pageCount; page++) {
        reached += buildActualList({
          actuals,
          yearMonth: month.yearMonth,
          page,
        }).rows.length;
      }
    }

    /* 見出しに出す総件数と、辿って到達できる件数が一致する */
    expect(head.total).toBe(730);
    expect(reached).toBe(head.total);
  });

  it("範囲外のページを指定しても空にならない", () => {
    const got = buildActualList({ actuals: many, yearMonth: null, page: 99 });

    expect(got.page).toBe(2);
    expect(got.rows).toHaveLength(50);
  });

  it("負のページも丸める", () => {
    expect(buildActualList({ actuals: many, yearMonth: null, page: -1 }).page).toBe(0);
  });
});

/* ========================= 件数の規模 ========================= */

describe("AC-28 10万件", () => {
  /* 24ヶ月に散らして10万件。1ヶ月あたり約4,200件 */
  const huge = Array.from({ length: 100_000 }, (_, i) =>
    actual({
      id: String(i).padStart(7, "0"),
      date: `20${26 + Math.floor(i / 50_000)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
    }),
  );

  it("描画するのは1ページぶんだけ", () => {
    const got = buildActualList({ actuals: huge, yearMonth: null });

    expect(got.total).toBe(100_000);
    expect(got.rows).toHaveLength(MONTH_PAGE_SIZE);
  });

  it("総件数は月の件数の合計と一致する", () => {
    const got = buildActualList({ actuals: huge, yearMonth: null });
    const sum = got.months.reduce((n, m) => n + m.count, 0);

    expect(sum).toBe(got.total);
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力", () => {
    const actuals = inMonth("2026-09", 30);

    expect(buildActualList({ actuals, yearMonth: null })).toEqual(
      buildActualList({ actuals, yearMonth: null }),
    );
  });

  it("入力を並べ替えない", () => {
    const actuals = inMonth("2026-09", 5);
    const snapshot = actuals.map((a) => a.id);

    buildActualList({ actuals, yearMonth: null });

    expect(actuals.map((a) => a.id)).toEqual(snapshot);
  });
});
