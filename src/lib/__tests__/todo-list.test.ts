import { describe, expect, it } from "vitest";

import type { Actual, ForecastInstance } from "@/core/types";

import type { DoubleCount } from "../reconcile";
import { buildTodoList } from "../todo-list";

/**
 * AC-37。
 *
 * 一次情報：docs/要件定義書.md §4.1.1 SC-05 実績入力の構成
 *   消し込み待ちの予定と照合候補のある実績が1つのリストに予定日の昇順で
 *   並ぶこと。2つが別々のリストに分かれていないこと。
 */

function plan(
  over: Partial<ForecastInstance> & Pick<ForecastInstance, "key" | "date">,
): ForecastInstance {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    srcId: "r1",
    ...over,
  };
}

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

const pair = (p: ForecastInstance, a: Actual, dayGap = 0): DoubleCount => ({
  plan: p,
  actual: a,
  dayGap,
});

const UNTIL = "2026-04-30";

/* ========================= 1つのリストに混ざる ========================= */

describe("AC-37 1つのリストに混在させる", () => {
  it("予定と候補が同じ配列に入り、予定日の昇順で並ぶ", () => {
    const p1 = plan({ key: "p1", date: "2026-04-10" });
    const p2 = plan({ key: "p2", date: "2026-04-05", name: "通信費" });
    const p3 = plan({ key: "p3", date: "2026-04-20", name: "保険料" });

    const got = buildTodoList({
      unmatchedForecast: [p1, p2, p3],
      doubleCounts: [pair(p2, actual({ id: "x1" }))],
      until: UNTIL,
    });

    expect(got.map((r) => [r.date, r.kind])).toEqual([
      ["2026-04-05", "candidate"],
      ["2026-04-10", "plan"],
      ["2026-04-20", "plan"],
    ]);
  });

  it("候補は予定日で並ぶ。実績日ではない", () => {
    /* 予定 4/5、実績 4/25。予定日の位置に並ぶ */
    const p1 = plan({ key: "p1", date: "2026-04-05" });
    const p2 = plan({ key: "p2", date: "2026-04-10", name: "通信費" });

    const got = buildTodoList({
      unmatchedForecast: [p1, p2],
      doubleCounts: [pair(p1, actual({ id: "x1", date: "2026-04-25" }), 20)],
      until: UNTIL,
    });

    expect(got.map((r) => r.kind)).toEqual(["candidate", "plan"]);
  });

  it("候補のある予定は plan 行として重複しない", () => {
    /* 1つの課題が2行に見えてはいけない */
    const p1 = plan({ key: "p1", date: "2026-04-10" });

    const got = buildTodoList({
      unmatchedForecast: [p1],
      doubleCounts: [pair(p1, actual({ id: "x1" }))],
      until: UNTIL,
    });

    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("candidate");
  });

  it("候補だけでもリストになる", () => {
    const p1 = plan({ key: "p1", date: "2026-04-10" });

    const got = buildTodoList({
      unmatchedForecast: [p1],
      doubleCounts: [pair(p1, actual({ id: "x1" }))],
      until: UNTIL,
    });

    expect(got.map((r) => r.kind)).toEqual(["candidate"]);
  });

  it("どちらも無ければ空", () => {
    expect(
      buildTodoList({ unmatchedForecast: [], doubleCounts: [], until: UNTIL }),
    ).toEqual([]);
  });
});

/* ========================= 期間の絞り込み ========================= */

describe("表示する範囲", () => {
  it("until より先の予定は出さない", () => {
    const got = buildTodoList({
      unmatchedForecast: [
        plan({ key: "near", date: "2026-04-10" }),
        plan({ key: "far", date: "2026-06-01", name: "先の予定" }),
      ],
      doubleCounts: [],
      until: UNTIL,
    });

    expect(got.map((r) => r.plan.key)).toEqual(["near"]);
  });

  it("until ちょうどは出す", () => {
    const got = buildTodoList({
      unmatchedForecast: [plan({ key: "edge", date: UNTIL })],
      doubleCounts: [],
      until: UNTIL,
    });

    expect(got).toHaveLength(1);
  });

  /**
   * 候補は日付で絞らない。
   *
   * 候補が見つかっている＝残高がいま間違っている状態なので、予定日が
   * 先でも片付ける対象である。
   */
  it("候補は until より先でも出す", () => {
    const far = plan({ key: "far", date: "2026-06-01", name: "先の予定" });

    const got = buildTodoList({
      unmatchedForecast: [far],
      doubleCounts: [pair(far, actual({ id: "x1", date: "2026-06-02" }))],
      until: UNTIL,
    });

    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("candidate");
  });
});

/* ========================= 並びの安定 ========================= */

describe("純関数であること", () => {
  it("同じ日付なら内容とキーで決まる", () => {
    const got = buildTodoList({
      unmatchedForecast: [
        plan({ key: "b", date: "2026-04-10", name: "通信費" }),
        plan({ key: "a", date: "2026-04-10", name: "家賃" }),
      ],
      doubleCounts: [],
      until: UNTIL,
    });

    expect(got.map((r) => r.plan.name)).toEqual(["家賃", "通信費"]);
  });

  it("同じ入力なら同じ出力", () => {
    const input = {
      unmatchedForecast: [plan({ key: "p1", date: "2026-04-10" })],
      doubleCounts: [],
      until: UNTIL,
    };

    expect(buildTodoList(input)).toEqual(buildTodoList(input));
  });
});
