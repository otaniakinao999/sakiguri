import { describe, expect, it } from "vitest";

import type { CardAccount, DepositAccount, RecurringItem } from "@/core/types";

import { emptyAppData, isEmpty, type AppData } from "../app-data";
import { computeBalanceSummary } from "../summary";

const TODAY = "2026-09-14";

const bank: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 1_000_000,
};

const card: CardAccount = {
  id: "c1",
  name: "メインカード",
  kind: "card",
  balance: 142_000,
  closingDay: 15,
  payMonthOffset: 1,
  payDay: 10,
  settleAccountId: "a1",
};

function data(over: Partial<AppData> = {}): AppData {
  return { ...emptyAppData(TODAY), ...over };
}

function recurring(
  over: Partial<RecurringItem> & Pick<RecurringItem, "id" | "day">,
): RecurringItem {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    months: null,
    active: true,
    ...over,
  };
}

describe("emptyAppData / isEmpty", () => {
  it("初期状態にサンプルデータを入れない", () => {
    const initial = emptyAppData(TODAY);

    expect(initial.accounts).toEqual([]);
    expect(initial.recurring).toEqual([]);
    expect(initial.oneoffs).toEqual([]);
    expect(initial.actuals).toEqual([]);
    expect(initial.overrides).toEqual({});
    expect(initial.reserveLine).toBe(0);
    expect(initial.asOf).toBe(TODAY);
    expect(isEmpty(initial)).toBe(true);
  });

  it("口座を1つでも登録すると空ではない", () => {
    expect(isEmpty(data({ accounts: [bank] }))).toBe(false);
  });
});

describe("残高ヘッダーの数字（SC-01）", () => {
  it("口座が無ければすべて0", () => {
    expect(computeBalanceSummary(emptyAppData(TODAY), TODAY)).toEqual({
      current: 0,
      in30: 0,
      in90: 0,
      cardDue: 0,
    });
  });

  it("予定が無ければ今日も30日後も90日後も同じ", () => {
    const got = computeBalanceSummary(data({ accounts: [bank] }), TODAY);

    expect(got).toEqual({
      current: 1_000_000,
      in30: 1_000_000,
      in90: 1_000_000,
      cardDue: 0,
    });
  });

  it("30日後・90日後に予定を織り込む", () => {
    const got = computeBalanceSummary(
      data({
        accounts: [bank],
        // 毎月27日に120,000円。9/27, 10/27, 11/27, 12/13までに3回
        recurring: [recurring({ id: "r1", day: 27 })],
      }),
      TODAY,
    );

    expect(got.current).toBe(1_000_000);
    // 30日後は 2026-10-14。9/27 の1回ぶん
    expect(got.in30).toBe(1_000_000 - 120_000);
    // 90日後は 2026-12-13。9/27, 10/27, 11/27 の3回ぶん
    expect(got.in90).toBe(1_000_000 - 360_000);
  });

  it("カードの未払残高を合計する", () => {
    const got = computeBalanceSummary(data({ accounts: [bank, card] }), TODAY);

    expect(got.cardDue).toBe(142_000);
    // 未払残高は現預金には含めない
    expect(got.current).toBe(1_000_000);
  });

  it("カード利用は今日の残高を動かさず、引落日の後に効く", () => {
    const got = computeBalanceSummary(
      data({
        accounts: [bank, { ...card, balance: 0 }],
        // 9/14 に 50,000円。14 <= 15 で9月締め → 10/10 引落
        oneoffs: [
          {
            id: "o1",
            date: TODAY,
            name: "備品",
            type: "expense",
            costType: "variable",
            categoryCode: "EXP-07",
            amount: 50_000,
            bizRatio: 100,
            accountId: "c1",
          },
        ],
      }),
      TODAY,
    );

    expect(got.current).toBe(1_000_000);
    expect(got.cardDue).toBe(50_000);
    // 30日後（10/14）は引落済み
    expect(got.in30).toBe(1_000_000 - 50_000);
  });

  it("入力を書き換えない", () => {
    const arg = data({ accounts: [bank, card], recurring: [recurring({ id: "r1", day: 27 })] });
    const snapshot = structuredClone(arg);

    computeBalanceSummary(arg, TODAY);

    expect(arg).toEqual(snapshot);
  });

  it("同じ入力なら同じ出力を返す", () => {
    const arg = data({ accounts: [bank, card] });

    expect(computeBalanceSummary(arg, TODAY)).toEqual(
      computeBalanceSummary(arg, TODAY),
    );
  });
});
