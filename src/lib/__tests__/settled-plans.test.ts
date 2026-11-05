import { describe, expect, it } from "vitest";

import { oneoffKey, recurringKey } from "@/core/forecast";
import type { Actual } from "@/core/types";

import { settledOneoffIds } from "../settled-plans";

/**
 * 実績が付いた単発予定の判定。
 *
 * **予測に無いことでは判定しない。** 予測は期間で切ってあるので、基準日
 * より前の単発予定はそもそも展開されず、「済み」に倒れてしまう
 * （§9.1：測る側が通る方向に間違っている）。実績の `key` から引く。
 */

function actual(over: Partial<Actual> & Pick<Actual, "id">): Actual {
  return {
    key: null,
    date: "2026-04-05",
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    ...over,
  };
}

describe("settledOneoffIds", () => {
  it("単発予定のキーを持つ実績があれば、その id が入る", () => {
    const ids = settledOneoffIds([actual({ id: "act1", key: oneoffKey("o1") })]);

    expect([...ids]).toEqual(["o1"]);
  });

  it("キーが null の実績（突発の支出）は数えない", () => {
    const ids = settledOneoffIds([actual({ id: "act1", key: null })]);

    expect([...ids]).toEqual([]);
  });

  it("**定期項目のキーは数えない**", () => {
    /* 毎月くり返すので、1回ぶんの実績が付いても終わらない */
    const ids = settledOneoffIds([
      actual({ id: "act1", key: recurringKey("r1", "2026-04-25") }),
    ]);

    expect([...ids]).toEqual([]);
  });

  it("**基準日より前でも後でも、同じように拾える**", () => {
    /* ここが予測から引いたときに壊れるところ。この関数は日付を見ない */
    const ids = settledOneoffIds([
      actual({ id: "act1", key: oneoffKey("past"), date: "2020-01-01" }),
      actual({ id: "act2", key: oneoffKey("future"), date: "2099-12-31" }),
    ]);

    expect([...ids].sort()).toEqual(["future", "past"]);
  });

  it("同じ単発予定に実績が2件付いても id は1つ", () => {
    const ids = settledOneoffIds([
      actual({ id: "act1", key: oneoffKey("o1") }),
      actual({ id: "act2", key: oneoffKey("o1") }),
    ]);

    expect([...ids]).toEqual(["o1"]);
  });

  it("形が違うキーは落とす", () => {
    const ids = settledOneoffIds([
      actual({ id: "act1", key: "o:" }),
      actual({ id: "act2", key: "ほかの形" }),
    ]);

    expect([...ids]).toEqual([]);
  });

  it("実績が無ければ空", () => {
    expect([...settledOneoffIds([])]).toEqual([]);
  });
});
