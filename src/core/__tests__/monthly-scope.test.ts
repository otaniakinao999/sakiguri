import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "../balance";
import { buildMonthlyCashflow } from "../monthly";
import type { Account, Actual } from "../types";

/**
 * 口座別の月次資金繰り表（要望2・10）
 *
 * **数え方を2つに分けない。** 入金・出金は「その範囲の残高が動いた額」で
 * 数える。合計で見れば振替は相殺して0なので入金にも出金にも入らず、
 * 口座別で見れば振替はその口座の入金か出金になる。1本の規則で両方出る。
 *
 * 金額で数えると、月末残高だけ口座別になって
 * **「前月繰越 ＋ 収支 ＝ 月末残高」が合わなくなる。**
 * 表の行が足し算にならないので、利用者はどの数字も信じられなくなる。
 */

const accounts: Account[] = [
  { id: "bank", name: "銀行", kind: "bank", balance: 1_000_000 },
  { id: "cash", name: "現金", kind: "cash", balance: 100_000 },
];

const actuals: Actual[] = [
  {
    id: "i1", date: "2026-10-05", name: "売上入金", amount: 300_000,
    type: "income", costType: null, categoryCode: "INC-01",
    accountId: "bank", key: null, unplanned: false, bizRatio: 0,
  },
  {
    id: "t1", date: "2026-10-10", name: "ＡＴＭ", amount: 50_000,
    type: "transfer", costType: null, categoryCode: "TRF-01",
    accountId: "bank", toAccountId: "cash", key: null, unplanned: false, bizRatio: 0,
  },
  {
    id: "e1", date: "2026-11-05", name: "家賃", amount: 95_000,
    type: "expense", costType: "fixed", categoryCode: "EXP-01",
    accountId: "bank", key: null, unplanned: false, bizRatio: 0,
  },
];

const series = buildBalanceSeries(
  { accounts, asOf: "2026-10-01", forecast: [], actuals },
  "2026-11-30",
  "2026-11-30",
);

const all = buildMonthlyCashflow(series, 0);
const bank = buildMonthlyCashflow(series, 0, new Set(["bank"]));
const cash = buildMonthlyCashflow(series, 0, new Set(["cash"]));

describe("合計で見るとき（従来の挙動）", () => {
  it("振替は入金にも出金にも入らない", () => {
    const oct = all.find((m) => m.yearMonth === "2026-10")!;
    expect(oct.inflow).toBe(300_000);
    expect(oct.outflow).toBe(0);
  });
});

describe("口座別で見るとき", () => {
  it("振替は、出す口座では出金になる", () => {
    const oct = bank.find((m) => m.yearMonth === "2026-10")!;
    expect(oct.inflow).toBe(300_000);
    expect(oct.outflow).toBe(50_000);
  });

  it("振替は、受ける口座では入金になる", () => {
    const oct = cash.find((m) => m.yearMonth === "2026-10")!;
    expect(oct.inflow).toBe(50_000);
    expect(oct.outflow).toBe(0);
  });
});

describe("崩してはいけない辻褄", () => {
  /** これが崩れると、表の行が足し算にならない */
  it.each([
    ["合計", all],
    ["銀行", bank],
    ["現金", cash],
  ])("%s：前月繰越 ＋ 収支 ＝ 月末残高", (_label, rows) => {
    for (const m of rows) {
      expect(m.opening + m.net).toBe(m.closing);
    }
  });

  it("月をまたいで繰り越す（前月の月末＝当月の前月繰越）", () => {
    for (const rows of [all, bank, cash]) {
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i].opening).toBe(rows[i - 1].closing);
      }
    }
  });

  it("口座別の月末残高を足すと、合計の月末残高になる", () => {
    for (let i = 0; i < all.length; i += 1) {
      expect(bank[i].closing + cash[i].closing).toBe(all[i].closing);
    }
  });

  /**
   * **月中の最低は足し算にならない。** 口座ごとに底を打つ日が違うので、
   * 口座別の最低を足しても合計の最低にはならない。足せると思って
   * 検査を書かないこと。
   */
  it("月中の最低は、口座別の和にはならなくてよい", () => {
    const oct = all.find((m) => m.yearMonth === "2026-10")!;
    expect(oct.lowest).toBeLessThanOrEqual(oct.closing);
  });
});
