import { describe, expect, it } from "vitest";

import { buildPLMatrix } from "@/core/pl";
import type { LedgerEvent } from "@/core/types";

import { buildPLDisplay, diffTone, selectableYears } from "../pl-view";

/* ========================= 素材 ========================= */

const NOW = "2026-06"; // 今月。1〜6月が過去、7〜12月が未来

function ev(
  over: Partial<LedgerEvent> & Pick<LedgerEvent, "date" | "categoryCode">,
): LedgerEvent {
  return {
    key: `k:${over.date}:${over.categoryCode}`,
    name: "項目",
    type: "expense",
    costType: "fixed",
    amount: 100_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    ...over,
  };
}

/** 4月：予定120,000／実績118,000の家賃。収入は予定450,000／実績470,000 */
const FORECAST: LedgerEvent[] = [
  ev({ key: "p1", date: "2026-04-27", categoryCode: "EXP-01", amount: 120_000 }),
  ev({
    key: "p2",
    date: "2026-04-25",
    categoryCode: "INC-01",
    type: "income",
    costType: null,
    amount: 450_000,
  }),
  ev({ key: "p3", date: "2026-09-27", categoryCode: "EXP-01", amount: 120_000 }),
];

const ACTUALS: LedgerEvent[] = [
  ev({
    key: "p1",
    date: "2026-04-27",
    categoryCode: "EXP-01",
    amount: 118_000,
    src: "actual",
  }),
  ev({
    key: "p2",
    date: "2026-04-25",
    categoryCode: "INC-01",
    type: "income",
    costType: null,
    amount: 470_000,
    src: "actual",
  }),
];

function display(mode: "mixed" | "plan" | "actual" | "diff") {
  const matrix = buildPLMatrix({
    forecast: FORECAST,
    actuals: ACTUALS,
    year: 2026,
    scope: "all",
  });
  return buildPLDisplay(matrix, mode, NOW);
}

const row = (d: ReturnType<typeof display>, key: string) =>
  d.rows.find((r) => r.key === key)!;

/** 1始まりの月 */
const m = (n: number) => n - 1;

/* ========================= 4つの表示モード（CL-5 手順6） ========================= */

describe("表示モード：予定", () => {
  it("消し込み済みかどうかに関わらず予定額を出す", () => {
    const d = display("plan");
    const rent = row(d, "category:fixed:EXP-01");

    expect(rent.monthly[m(4)]).toBe(120_000);
    expect(rent.monthly[m(9)]).toBe(120_000);
    expect(rent.yearTotal).toBe(240_000);
  });

  it("未来月も出す", () => {
    const d = display("plan");
    expect(row(d, "category:fixed:EXP-01").monthly[m(9)]).toBe(120_000);
  });
});

describe("表示モード：実績", () => {
  it("過去月は実績を出す", () => {
    const d = display("actual");
    expect(row(d, "category:fixed:EXP-01").monthly[m(4)]).toBe(118_000);
  });

  it("未来月は出さない", () => {
    const d = display("actual");
    expect(row(d, "category:fixed:EXP-01").monthly[m(9)]).toBeNull();
  });

  it("年計は見えている値だけを足す", () => {
    const d = display("actual");
    // 9月の予定120,000は入らない
    expect(row(d, "category:fixed:EXP-01").yearTotal).toBe(118_000);
  });
});

describe("表示モード：実績+予定", () => {
  it("過去月は実績、未来月は予定", () => {
    const d = display("mixed");
    const rent = row(d, "category:fixed:EXP-01");

    expect(rent.monthly[m(4)]).toBe(118_000);
    expect(rent.monthly[m(9)]).toBe(120_000);
    expect(rent.yearTotal).toBe(238_000);
  });

  it("過去月に添える予定額を持つ", () => {
    const d = display("mixed");
    expect(row(d, "category:fixed:EXP-01").planMonthly?.[m(4)]).toBe(120_000);
  });

  it("他のモードでは予定額を添えない", () => {
    for (const mode of ["plan", "actual", "diff"] as const) {
      expect(row(display(mode), "category:fixed:EXP-01").planMonthly).toBeUndefined();
    }
  });
});

describe("表示モード：差異", () => {
  it("収入は 実績 − 予定", () => {
    const d = display("diff");
    // 470,000 − 450,000 = +20,000（予定より多い＝良い）
    expect(row(d, "category:income:INC-01").monthly[m(4)]).toBe(20_000);
  });

  it("費用は 予定 − 実績", () => {
    const d = display("diff");
    // 120,000 − 118,000 = +2,000（予定より少ない＝良い）
    expect(row(d, "category:fixed:EXP-01").monthly[m(4)]).toBe(2_000);
  });

  it("正の値が良い方向になる", () => {
    const d = display("diff");
    expect(diffTone(row(d, "category:income:INC-01").monthly[m(4)])).toBe("good");
    expect(diffTone(row(d, "category:fixed:EXP-01").monthly[m(4)])).toBe("good");
  });

  it("費用が予定より多ければ悪い方向", () => {
    const matrix = buildPLMatrix({
      forecast: [ev({ key: "p", date: "2026-04-27", categoryCode: "EXP-01", amount: 100_000 })],
      actuals: [
        ev({ key: "p", date: "2026-04-27", categoryCode: "EXP-01", amount: 130_000, src: "actual" }),
      ],
      year: 2026,
      scope: "all",
    });
    const d = buildPLDisplay(matrix, "diff", NOW);

    expect(row(d, "category:fixed:EXP-01").monthly[m(4)]).toBe(-30_000);
    expect(diffTone(-30_000)).toBe("bad");
  });

  it("未来月は出さない", () => {
    const d = display("diff");
    expect(row(d, "category:fixed:EXP-01").monthly[m(9)]).toBeNull();
  });

  it("差が無い月は良し悪しを付けない", () => {
    expect(diffTone(0)).toBeNull();
    expect(diffTone(null)).toBeNull();
  });
});

/* ========================= 行の並び ========================= */

describe("行の並び（CL-5 手順5）", () => {
  it("グループ計のすぐ下にその費目が並ぶ", () => {
    const d = display("plan");

    expect(d.rows.map((r) => r.key)).toEqual([
      "group:income",
      "category:income:INC-01",
      "group:fixed",
      "category:fixed:EXP-01",
      "group:variable",
      "net",
    ]);
  });

  it("グループ計は費目の合計になる", () => {
    const d = display("plan");

    expect(row(d, "group:fixed").monthly[m(4)]).toBe(120_000);
    expect(row(d, "group:income").monthly[m(4)]).toBe(450_000);
  });

  it("費目の無いグループも行として残る", () => {
    const d = display("plan");
    const variable = row(d, "group:variable");

    expect(variable.yearTotal).toBe(0);
  });

  it("収支 = 収入 − 固定費 − 変動費", () => {
    const d = display("plan");
    expect(row(d, "net").monthly[m(4)]).toBe(450_000 - 120_000);
  });

  it("事業ビューでは収支の行が事業所得になる", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: ACTUALS,
      year: 2026,
      scope: "business",
    });
    const d = buildPLDisplay(matrix, "plan", NOW);

    expect(d.netLabel).toBe("事業所得");
    expect(row(d, "net").label).toBe("事業所得");
  });

  it("合算・家計では収支のまま", () => {
    for (const scope of ["all", "household"] as const) {
      const matrix = buildPLMatrix({ forecast: FORECAST, actuals: ACTUALS, year: 2026, scope });
      expect(buildPLDisplay(matrix, "plan", NOW).netLabel).toBe("収支");
    }
  });
});

/* ========================= 列 ========================= */

describe("列（CL-5 手順5）", () => {
  it("1月から12月まで", () => {
    const d = display("plan");

    expect(d.months).toHaveLength(12);
    expect(d.months[0]).toBe("2026-01");
    expect(d.months[11]).toBe("2026-12");
  });

  it("今月以前を過去として扱う", () => {
    const d = display("plan");

    expect(d.isPast.slice(0, 6)).toEqual([true, true, true, true, true, true]);
    expect(d.isPast.slice(6)).toEqual([false, false, false, false, false, false]);
  });

  it("すべての行が12ヶ月ぶんの値を持つ", () => {
    const d = display("mixed");
    for (const r of d.rows) {
      expect(r.monthly).toHaveLength(12);
    }
  });
});

/* ========================= 年の選択 ========================= */

describe("selectableYears", () => {
  it("日付に現れる年と今年を返す", () => {
    expect(selectableYears(["2026-04-01", "2027-03-31"], 2026)).toEqual([2026, 2027]);
  });

  it("重複を除いて昇順にする", () => {
    expect(
      selectableYears(["2027-01-01", "2026-12-31", "2026-01-01"], 2026),
    ).toEqual([2026, 2027]);
  });

  it("何も無ければ今年だけ", () => {
    expect(selectableYears([], 2026)).toEqual([2026]);
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力を返す", () => {
    expect(display("mixed")).toEqual(display("mixed"));
  });

  it("入力を書き換えない", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: ACTUALS,
      year: 2026,
      scope: "all",
    });
    const snapshot = structuredClone(matrix);

    buildPLDisplay(matrix, "mixed", NOW);

    expect(matrix).toEqual(snapshot);
  });
});
