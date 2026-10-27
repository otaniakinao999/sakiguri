import { describe, expect, it } from "vitest";

import { touchesAccount } from "../types";

/**
 * 口座に関わる行の判定（要望2）
 *
 * **振替は2つの口座に関わる。** 出す側だけで判定すると、その口座へ
 * 入ってきた振替が落ちる。一覧から消えるだけなので、**画面を見ても
 * 「もともと無い」としか分からない。**
 *
 * 同じ判定を口座の削除（`removeAccount` の道連れの範囲）も使う。
 * 片方にだけ条件が増えると「一覧には出ないのに、口座を消すと
 * 道連れになる」行ができる（CLAUDE.md §2.8）。
 */
describe("touchesAccount", () => {
  it("出す側で拾う", () => {
    expect(touchesAccount({ accountId: "bank" }, "bank")).toBe(true);
  });

  it("受ける側でも拾う（ここが落ちやすい）", () => {
    expect(touchesAccount({ accountId: "bank", toAccountId: "cash" }, "cash")).toBe(true);
  });

  it("無関係な口座は拾わない", () => {
    expect(touchesAccount({ accountId: "bank", toAccountId: "cash" }, "shinkin")).toBe(false);
  });

  it("振替先が無い行でも落ちない", () => {
    expect(touchesAccount({ accountId: "bank", toAccountId: undefined }, "bank")).toBe(true);
    expect(touchesAccount({ accountId: "bank", toAccountId: undefined }, "cash")).toBe(false);
  });
});
