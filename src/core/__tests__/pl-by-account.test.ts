import { describe, expect, it } from "vitest";

import { buildPLMatrix } from "../pl";
import { touchesAccount } from "../types";
import type { LedgerEvent } from "../types";

/**
 * 年月別 収支を口座で絞る（要望2）
 *
 * **残高の話ではない。** 「その口座から払った費用／その口座に入った
 * 収入」という意味で、残高系列の範囲（`buildBalanceSeries` の scope）
 * とは別の仕組み。按分の `scope`（家計／事業）とも別物。
 *
 * **振替は二重に数えられない。** `touchesAccount` は振替を両方の口座で
 * 拾うが、`plGroupOf` が `type === "transfer"` を無条件で外すため
 * 損益には入らない。だから口座ごとの合計は元の合計に一致する。
 */

const ev = (over: Partial<LedgerEvent>): LedgerEvent => ({
  key: null,
  date: "2026-05-10",
  name: "x",
  type: "expense",
  costType: "variable",
  categoryCode: "EXP-20",
  amount: 10_000,
  bizRatio: 100,
  accountId: "bank",
  src: "oneoff",
  ...over,
}) as LedgerEvent;

const events: LedgerEvent[] = [
  ev({ accountId: "bank", amount: 10_000 }),
  ev({ accountId: "cash", amount: 3_000 }),
  ev({ accountId: "bank", amount: 50_000, type: "income", costType: null, categoryCode: "INC-01" }),
  /* 振替。両方の口座で拾われるが損益には入らない */
  ev({ accountId: "bank", toAccountId: "cash", amount: 20_000, type: "transfer",
       costType: null, categoryCode: "TRF-01" }),
];

const build = (accountId: string | null) =>
  buildPLMatrix({
    forecast: [],
    actuals: accountId === null ? events : events.filter((e) => touchesAccount(e, accountId)),
    year: 2026,
    scope: "all",
    today: "2026-12-31",
  });

/** 収支＝収入 − 固定費 − 変動費（PLSide.netYearTotal） */
const netOf = (accountId: string | null) => build(accountId).actual.netYearTotal;

describe("口座で絞った年月別 収支", () => {
  it("絞ると、その口座のぶんだけになる", () => {
    /* 銀行：収入 50,000 − 変動費 10,000 */
    expect(netOf("bank")).toBe(40_000);
    /* 現金：変動費 3,000 のみ */
    expect(netOf("cash")).toBe(-3_000);
  });

  /** 振替が両方の口座で拾われても、損益に入らないので二重にならない */
  it("口座ごとの収支を足すと、絞らないときの収支になる", () => {
    expect(netOf("bank") + netOf("cash")).toBe(netOf(null));
  });

  it("振替は、どの口座で見ても損益に出ない", () => {
    for (const id of [null, "bank", "cash"]) {
      expect(JSON.stringify(build(id).actual)).not.toContain("TRF-01");
    }
  });
});
