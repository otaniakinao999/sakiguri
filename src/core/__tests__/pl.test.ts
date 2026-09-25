import { describe, expect, it } from "vitest";

import {
  applyMode,
  buildPLMatrix,
  plGroupOf,
  type PLGroup,
  type PLInput,
  type PLMatrix,
  type PLSide,
} from "../pl";
import type { LedgerEvent } from "../types";

/* ========================= 素材 ========================= */

function ev(
  over: Partial<LedgerEvent> & Pick<LedgerEvent, "date" | "categoryCode">,
): LedgerEvent {
  return {
    key: `k:${over.date}:${over.categoryCode}`,
    name: "項目",
    type: "expense",
    costType: "variable",
    amount: 10_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    ...over,
  };
}

function input(over: Partial<PLInput> = {}): PLInput {
  return { forecast: [], actuals: [], year: 2026, scope: "all", ...over };
}

/** その面の (グループ, 費目) → 年計 */
const rowsOf = (side: PLSide) =>
  side.groups.flatMap((g) =>
    g.rows.map((r) => [g.group, r.categoryCode, r.yearTotal] as const),
  );

const block = (side: PLSide, group: PLGroup) =>
  side.groups.find((g) => g.group === group)!;

const month = (m: number) => m - 1;

/* ========================= グルーピング ========================= */

describe("plGroupOf", () => {
  it("収入は income", () => {
    expect(
      plGroupOf({ type: "income", costType: null, categoryCode: "INC-01" }),
    ).toBe("income");
  });

  it("費用は costType で固定費／変動費に分かれる", () => {
    expect(
      plGroupOf({ type: "expense", costType: "fixed", categoryCode: "EXP-03" }),
    ).toBe("fixed");
    expect(
      plGroupOf({ type: "expense", costType: "variable", categoryCode: "EXP-03" }),
    ).toBe("variable");
  });

  it("TRF グループは損益に出ない", () => {
    expect(
      plGroupOf({ type: "transfer", costType: null, categoryCode: "TRF-01" }),
    ).toBeNull();
    // 元金返済は type=expense だが TRF なので除外される
    expect(
      plGroupOf({ type: "expense", costType: "fixed", categoryCode: "TRF-06" }),
    ).toBeNull();
    // カード引落も同様
    expect(
      plGroupOf({ type: "expense", costType: null, categoryCode: "TRF-04" }),
    ).toBeNull();
  });

  it("マスタに無い費目コードは投げる", () => {
    expect(() =>
      plGroupOf({ type: "expense", costType: "fixed", categoryCode: "EXP-99" }),
    ).toThrow(RangeError);
  });
});

/* ========================= AC-18 ========================= */

describe("AC-18 同一費目を固定費と変動費の両方で登録する", () => {
  it("固定費グループと変動費グループの双方に同じ費目の行が現れる", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          // 定額制の電気契約を固定費として
          ev({
            key: "p1",
            date: "2026-04-25",
            categoryCode: "EXP-02",
            costType: "fixed",
            amount: 6_000,
          }),
          // 従量制を変動費として
          ev({
            key: "p2",
            date: "2026-04-25",
            categoryCode: "EXP-02",
            costType: "variable",
            amount: 12_000,
          }),
        ],
      }),
    );

    expect(rowsOf(got.plan)).toEqual([
      ["fixed", "EXP-02", 6_000],
      ["variable", "EXP-02", 12_000],
    ]);
  });

  it("片方だけを消し込んでも両方の行が残る", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-04-25", categoryCode: "EXP-02", costType: "fixed", amount: 6_000 }),
          ev({ key: "p2", date: "2026-04-25", categoryCode: "EXP-02", costType: "variable", amount: 12_000 }),
        ],
        actuals: [
          ev({
            key: "p1",
            date: "2026-04-25",
            categoryCode: "EXP-02",
            costType: "fixed",
            amount: 6_200,
            src: "actual",
          }),
        ],
      }),
    );

    // 行の並びは予定側と実績側で揃う
    expect(rowsOf(got.plan)).toEqual([
      ["fixed", "EXP-02", 6_000],
      ["variable", "EXP-02", 12_000],
    ]);
    expect(rowsOf(got.actual)).toEqual([
      ["fixed", "EXP-02", 6_200],
      ["variable", "EXP-02", 0],
    ]);
  });
});

/* ========================= AC-19 ========================= */

describe("AC-19 後半 借入返済の元金と利息（v1.0 で検証できる範囲）", () => {
  /*
   * AC-19 は（v2.0）。前半の「1回の返済を2件に分解する」は CL-8 の担当で、
   * PoC の範囲外（PoC開発計画 §4「PoC範囲外として明示するもの」）。
   * 要件定義書 §9 のとおり、v1.0 では**分解前の入力**（TRF-06 と EXP-15 を
   * 個別に登録した状態）で後半のみを検証する。
   *
   * 前半の skip テストは v2-acceptance.test.ts にある。
   *
   * なお PoC のモニターが借入を持つ場合は、毎月の返済額を定期項目1件として
   * 手入力する。元金と利息が分かれないため損益は過大になるが、資金繰りは
   * 実態と合う。PoC が測るのは後者。
   */
  const principal = ev({
    key: "l:loan1:2026-04-27#p",
    date: "2026-04-27",
    name: "公庫 運転資金 返済（元金）",
    categoryCode: "TRF-06",
    costType: null,
    type: "expense",
    amount: 82_000,
  });
  const interest = ev({
    key: "l:loan1:2026-04-27#i",
    date: "2026-04-27",
    name: "公庫 運転資金 返済（利息）",
    categoryCode: "EXP-15",
    costType: "fixed",
    type: "expense",
    amount: 8_300,
    bizRatio: 100,
  });

  it("年月別収支には利息だけが計上される", () => {
    const got = buildPLMatrix(input({ forecast: [principal, interest] }));

    expect(rowsOf(got.plan)).toEqual([["fixed", "EXP-15", 8_300]]);
  });

  it("元金は TRF-06 なのでどのグループにも現れない", () => {
    const got = buildPLMatrix(input({ forecast: [principal, interest] }));

    const codes = got.plan.groups.flatMap((g) => g.rows.map((r) => r.categoryCode));
    expect(codes).not.toContain("TRF-06");
  });

  it("固定費の合計に元金が混ざらない", () => {
    const got = buildPLMatrix(input({ forecast: [principal, interest] }));

    expect(block(got.plan, "fixed").monthly[month(4)]).toBe(8_300);
    expect(block(got.plan, "fixed").yearTotal).toBe(8_300);
  });
});

/* ========================= AC-20 ========================= */

describe("AC-20 前半 TRF グループは年月別収支に現れない（CL-5）", () => {
  /* AC-20 の後半「月次資金繰り表の出金に含まれること（CL-6）」は
     CL-6 の実装後（フェーズ1・タスク#5）に検証する。 */
  const trfEvents = [
    ev({ key: "t1", date: "2026-04-26", categoryCode: "TRF-01", type: "transfer", costType: null, amount: 380_000 }),
    ev({ key: "t2", date: "2026-04-26", categoryCode: "TRF-02", type: "transfer", costType: null, amount: 200_000 }),
    ev({ key: "t3", date: "2026-04-10", categoryCode: "TRF-04", type: "expense", costType: null, amount: 142_000 }),
    ev({ key: "t4", date: "2026-04-27", categoryCode: "TRF-06", type: "expense", costType: null, amount: 82_000 }),
    ev({ key: "t5", date: "2026-04-01", categoryCode: "TRF-05", type: "income", costType: null, amount: 5_000_000 }),
  ];

  it("TRF の費目が一切現れない", () => {
    const got = buildPLMatrix(input({ forecast: trfEvents }));

    expect(rowsOf(got.plan)).toEqual([]);
    expect(got.plan.netYearTotal).toBe(0);
  });

  it("借入実行（TRF-05）は収入にならない", () => {
    const got = buildPLMatrix(input({ forecast: trfEvents }));

    expect(block(got.plan, "income").yearTotal).toBe(0);
  });

  it("TRF に混ざっていても損益の費目は残る", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ...trfEvents,
          ev({ key: "e1", date: "2026-04-25", categoryCode: "EXP-01", costType: "fixed", amount: 120_000 }),
        ],
      }),
    );

    expect(rowsOf(got.plan)).toEqual([["fixed", "EXP-01", 120_000]]);
  });
});

/* ========================= AC-03 ========================= */

describe("AC-03 消し込みは年月別収支の予定列を変えない", () => {
  it("消し込み済みかどうかに関わらず予定側は全予定を集計する（CL-5 手順2）", () => {
    const planned = ev({
      key: "r:rh1:2026-04-27",
      date: "2026-04-27",
      categoryCode: "EXP-01",
      costType: "fixed",
      amount: 120_000,
    });

    const before = buildPLMatrix(input({ forecast: [planned] }));
    const after = buildPLMatrix(
      input({
        forecast: [planned],
        actuals: [{ ...planned, amount: 118_000, src: "actual" }],
      }),
    );

    // 予定列は変化しない
    expect(after.plan).toEqual(before.plan);
    expect(block(after.plan, "fixed").monthly[month(4)]).toBe(120_000);
    // 実績側には実額が出る
    expect(block(after.actual, "fixed").monthly[month(4)]).toBe(118_000);
  });
});

/* ========================= AC-05 通し ========================= */

describe("AC-05 家事按分をビューごとに適用する", () => {
  const tsushin = ev({
    key: "r:rh2:2026-04-25",
    date: "2026-04-25",
    name: "通信費（携帯・回線）",
    categoryCode: "EXP-03",
    costType: "fixed",
    amount: 9_800,
    bizRatio: 40,
  });

  it("合算・事業・家計で金額が変わる", () => {
    const all = buildPLMatrix(input({ forecast: [tsushin], scope: "all" }));
    const biz = buildPLMatrix(input({ forecast: [tsushin], scope: "business" }));
    const home = buildPLMatrix(input({ forecast: [tsushin], scope: "household" }));

    expect(block(all.plan, "fixed").yearTotal).toBe(9_800);
    expect(block(biz.plan, "fixed").yearTotal).toBe(3_920);
    expect(block(home.plan, "fixed").yearTotal).toBe(5_880);
  });

  it("按分後が0の項目はそのビューの明細に出さない（CL-4）", () => {
    const kakei = ev({
      key: "r:rh1:2026-04-27",
      date: "2026-04-27",
      categoryCode: "EXP-01",
      costType: "fixed",
      amount: 120_000,
      bizRatio: 0,
    });

    const biz = buildPLMatrix(input({ forecast: [tsushin, kakei], scope: "business" }));

    // 事業割合0の家賃は事業ビューに出ない
    expect(rowsOf(biz.plan)).toEqual([["fixed", "EXP-03", 3_920]]);
  });
});

/* ========================= 集計の基本 ========================= */

describe("CL-5 集計", () => {
  it("集計日は発生日。月ごとに振り分ける（手順4）", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-01-15", categoryCode: "EXP-21", amount: 60_000 }),
          ev({ key: "p2", date: "2026-06-15", categoryCode: "EXP-21", amount: 70_000 }),
          ev({ key: "p3", date: "2026-12-31", categoryCode: "EXP-21", amount: 80_000 }),
        ],
      }),
    );

    const row = block(got.plan, "variable").rows[0];
    expect(row.monthly[month(1)]).toBe(60_000);
    expect(row.monthly[month(6)]).toBe(70_000);
    expect(row.monthly[month(12)]).toBe(80_000);
    expect(row.yearTotal).toBe(210_000);
  });

  it("対象年以外のイベントは無視する", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2025-12-31", categoryCode: "EXP-21" }),
          ev({ key: "p2", date: "2026-01-01", categoryCode: "EXP-21" }),
          ev({ key: "p3", date: "2027-01-01", categoryCode: "EXP-21" }),
        ],
      }),
    );

    expect(block(got.plan, "variable").yearTotal).toBe(10_000);
  });

  it("同じ費目・同じ月は合算する", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-04-05", categoryCode: "EXP-21", amount: 3_000 }),
          ev({ key: "p2", date: "2026-04-20", categoryCode: "EXP-21", amount: 4_000 }),
        ],
      }),
    );

    expect(block(got.plan, "variable").rows[0].monthly[month(4)]).toBe(7_000);
  });

  it("行は グループ順 → 費目マスタの掲載順 に並ぶ（適用規則2・3）", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-04-01", categoryCode: "EXP-21", costType: "variable", amount: 1 }),
          ev({ key: "p2", date: "2026-04-01", categoryCode: "EXP-03", costType: "fixed", amount: 2 }),
          ev({ key: "p3", date: "2026-04-01", categoryCode: "INC-07", type: "income", costType: null, amount: 3 }),
          ev({ key: "p4", date: "2026-04-01", categoryCode: "EXP-01", costType: "fixed", amount: 4 }),
          ev({ key: "p5", date: "2026-04-01", categoryCode: "INC-01", type: "income", costType: null, amount: 5 }),
          ev({ key: "p6", date: "2026-04-01", categoryCode: "EXP-04", costType: "variable", amount: 6 }),
        ],
      }),
    );

    expect(rowsOf(got.plan).map(([g, c]) => `${g}/${c}`)).toEqual([
      "income/INC-01",
      "income/INC-07",
      "fixed/EXP-01",
      "fixed/EXP-03",
      "variable/EXP-04",
      "variable/EXP-21",
    ]);
  });

  it("金額の大小では並べ替えない", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-04-01", categoryCode: "EXP-32", amount: 999_999 }),
          ev({ key: "p2", date: "2026-04-01", categoryCode: "EXP-02", amount: 1 }),
        ],
      }),
    );

    expect(rowsOf(got.plan).map(([, c]) => c)).toEqual(["EXP-02", "EXP-32"]);
  });

  it("収支 = 収入 − 固定費 − 変動費", () => {
    const got = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-04-25", categoryCode: "INC-01", type: "income", costType: null, amount: 450_000 }),
          ev({ key: "p2", date: "2026-04-27", categoryCode: "EXP-01", costType: "fixed", amount: 120_000 }),
          ev({ key: "p3", date: "2026-04-15", categoryCode: "EXP-21", costType: "variable", amount: 68_000 }),
        ],
      }),
    );

    expect(got.plan.netMonthly[month(4)]).toBe(450_000 - 120_000 - 68_000);
    expect(got.plan.netYearTotal).toBe(262_000);
  });

  it("予定と実績で行の並びが揃う", () => {
    const got = buildPLMatrix(
      input({
        forecast: [ev({ key: "p1", date: "2026-04-01", categoryCode: "EXP-01", costType: "fixed" })],
        actuals: [ev({ key: "a1", date: "2026-04-01", categoryCode: "EXP-21", src: "actual" })],
      }),
    );

    const planKeys = rowsOf(got.plan).map(([g, c]) => `${g}/${c}`);
    const actualKeys = rowsOf(got.actual).map(([g, c]) => `${g}/${c}`);
    expect(planKeys).toEqual(["fixed/EXP-01", "variable/EXP-21"]);
    expect(actualKeys).toEqual(planKeys);
  });

  it("イベントが無ければ全グループが空", () => {
    const got = buildPLMatrix(input());

    expect(rowsOf(got.plan)).toEqual([]);
    expect(got.plan.netMonthly).toEqual(new Array(12).fill(0));
  });
});

/* ========================= 表示モード（手順6） ========================= */

describe("applyMode", () => {
  it("plan は予定を返す", () => {
    expect(applyMode("plan", "fixed", 100, 90, true)).toBe(100);
    expect(applyMode("plan", "fixed", 100, 0, false)).toBe(100);
  });

  /**
   * 手順3 は「実績側は実績のみを集計する」で、期間の限定がない。
   * 過去／未来の切り分けは手順6 の `実績+予定` の定義に属する。
   *
   * 未来日の実績は実在する。前払い、CSVの先日付行、そして最も多いのは
   * 日付の打ち間違い（2027年と打ってしまった実績）である。画面から消すと
   * 残高だけが合わない状態になり、原因が追えない。
   */
  it("actual は未来月でも実績を返す", () => {
    expect(applyMode("actual", "fixed", 100, 90, true)).toBe(90);
    expect(applyMode("actual", "fixed", 100, 90, false)).toBe(90);
  });

  it("actual は実績が無ければ未来月でも0を返す（null にしない）", () => {
    expect(applyMode("actual", "fixed", 100, 0, false)).toBe(0);
  });

  it("mixed は過去月が実績、未来月が予定", () => {
    expect(applyMode("mixed", "fixed", 100, 90, true)).toBe(90);
    expect(applyMode("mixed", "fixed", 100, 0, false)).toBe(100);
  });

  it("diff は正が良い方向。収入は 実績−予定、費用は 予定−実績", () => {
    // 収入が予定より多い → 良い
    expect(applyMode("diff", "income", 400_000, 450_000, true)).toBe(50_000);
    // 収入が予定より少ない → 悪い
    expect(applyMode("diff", "income", 450_000, 400_000, true)).toBe(-50_000);
    // 費用が予定より少ない → 良い
    expect(applyMode("diff", "fixed", 120_000, 118_000, true)).toBe(2_000);
    // 費用が予定より多い → 悪い
    expect(applyMode("diff", "variable", 68_000, 72_000, true)).toBe(-4_000);
  });

  it("diff は未来月では出さない", () => {
    expect(applyMode("diff", "income", 100, 0, false)).toBeNull();
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("入力を書き換えない", () => {
    const arg = input({
      forecast: [ev({ key: "p1", date: "2026-04-01", categoryCode: "EXP-01", costType: "fixed" })],
      actuals: [ev({ key: "a1", date: "2026-04-01", categoryCode: "EXP-21", src: "actual" })],
    });
    const snapshot = structuredClone(arg);

    buildPLMatrix(arg);

    expect(arg).toEqual(snapshot);
  });

  it("同じ入力なら同じ出力を返す", () => {
    const arg = input({
      forecast: [ev({ key: "p1", date: "2026-04-01", categoryCode: "EXP-01", costType: "fixed" })],
    });

    expect(buildPLMatrix(arg)).toEqual(buildPLMatrix(arg));
  });

  it("行ごとの monthly が共有されていない", () => {
    const got: PLMatrix = buildPLMatrix(
      input({
        forecast: [
          ev({ key: "p1", date: "2026-04-01", categoryCode: "EXP-01", costType: "fixed", amount: 1 }),
          ev({ key: "p2", date: "2026-05-01", categoryCode: "EXP-03", costType: "fixed", amount: 2 }),
        ],
      }),
    );

    const [a, b] = block(got.plan, "fixed").rows;
    expect(a.monthly).not.toBe(b.monthly);
    expect(a.monthly[month(4)]).toBe(1);
    expect(b.monthly[month(5)]).toBe(2);
  });
});
