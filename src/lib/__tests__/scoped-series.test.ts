import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildMonthlyCashflow } from "@/core/monthly";
import type { Account, Actual } from "@/core/types";
import { buildHeaderStats } from "@/lib/header-stats";
import { buildLedgerView } from "@/lib/ledger";

/**
 * 口座別に見たときの辻褄（要望2・10）
 *
 * **範囲は2箇所で別々に決めない。** 系列（`proj`）と明細（行ごとの残高）が
 * 違う範囲で積むと、行の残高がその日の終値に着地しない。1件ずつずれる
 * ので、合計だけ見ていると気づけない。
 *
 * **振替の判定に範囲を使わない。** 銀行→現金の振替を銀行だけで見ると、
 * 現金は範囲外になる。そこで「閉じていない」と判定すると、
 * `accountDelta`（283e234 の留め具）が0を返し、銀行から出ていったことが
 * 消える。判定は常に全口座で行う。
 */

const accounts: Account[] = [
  { id: "bank", name: "銀行", kind: "bank", balance: 1_000_000 },
  { id: "cash", name: "現金", kind: "cash", balance: 100_000 },
];

const actuals: Actual[] = [
  { id: "i1", date: "2026-10-05", name: "売上入金", amount: 300_000,
    type: "income", costType: null, categoryCode: "INC-01",
    accountId: "bank", key: null, unplanned: false, bizRatio: 0 },
  { id: "t1", date: "2026-10-10", name: "ＡＴＭ", amount: 50_000,
    type: "transfer", costType: null, categoryCode: "TRF-01",
    accountId: "bank", toAccountId: "cash", key: null, unplanned: false, bizRatio: 0 },
  { id: "e1", date: "2026-10-20", name: "家賃", amount: 95_000,
    type: "expense", costType: "fixed", categoryCode: "EXP-01",
    accountId: "bank", key: null, unplanned: false, bizRatio: 0 },
];

const input = { accounts, asOf: "2026-10-01", forecast: [], actuals };
const all = buildBalanceSeries(input, "2026-10-31", "2026-10-31");
const bankOnly = new Set(["bank"]);
const bank = buildBalanceSeries(input, "2026-10-31", "2026-10-31", bankOnly);

describe("範囲を絞った系列", () => {
  it("proj はその口座の残高になる", () => {
    for (let i = 0; i < all.rows.length; i += 1) {
      expect(bank.rows[i].proj).toBe(all.rows[i].byAccount.bank);
    }
  });

  it("byAccount は範囲に関わらず全口座ぶん持つ（振替の判定に要る）", () => {
    expect(Object.keys(bank.rows[0].byAccount).sort()).toEqual(["bank", "cash"]);
  });

  /**
   * **ここが肝。** 範囲で振替の判定をすると、現金が範囲外になるため
   * 「閉じていない」と見なされ、銀行から出ていった50,000が消える。
   */
  it("範囲をまたぐ振替は、出す側からは出ていったままになる", () => {
    const before = bank.rows.find((r) => r.date === "2026-10-09")!.proj;
    const after = bank.rows.find((r) => r.date === "2026-10-10")!.proj;
    expect(after).toBe(before - 50_000);
  });

  it("口座別の proj を足すと合計の proj になる", () => {
    const cash = buildBalanceSeries(input, "2026-10-31", "2026-10-31", new Set(["cash"]));
    for (let i = 0; i < all.rows.length; i += 1) {
      expect(bank.rows[i].proj + cash.rows[i].proj).toBe(all.rows[i].proj);
    }
  });
});

describe("系列と明細が同じ範囲で積まれている", () => {
  const monthly = buildMonthlyCashflow(bank, 0, bankOnly);
  const view = buildLedgerView({
    series: bank, monthly, from: "2026-10", to: "2026-10",
    kind: "all", status: "all", today: "2026-10-31", scope: bankOnly,
  });

  it("その日の最後の行の残高が、その日の終値に着地する", () => {
    const entries = view.groups.flatMap((g) => g.entries);
    const byDate = new Map<string, number>();
    for (const e of entries) byDate.set(e.date, e.balance);
    for (const [date, balance] of byDate) {
      const closing = bank.rows.find((r) => r.date === date)!.proj;
      expect({ date, balance }).toEqual({ date, balance: closing });
    }
  });

  it("月末残高も揃う", () => {
    const oct = monthly.find((m) => m.yearMonth === "2026-10")!;
    expect(oct.closing).toBe(bank.rows.at(-1)!.proj);
  });
});

describe("ヘッダーの残高も範囲に従う", () => {
  it("今日の残高がその口座の値になる", () => {
    const stats = buildHeaderStats(bank, accounts, "2026-10-31");
    const today = bank.rows.find((r) => r.date === "2026-10-31")!;
    expect(stats[0].value).toBe(today.proj);
  });
});
