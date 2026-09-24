import { describe, expect, it } from "vitest";

import type { ForecastInstance } from "@/core/types";

import {
  buildReconcileWarnings,
  STALLED_DAYS,
  STRANDED_DAYS,
} from "../reconcile-warnings";

/**
 * FR-43 / AC-29a・AC-29b。
 *
 * 一次情報：docs/要件定義書.md §3.1 FR-43、§3.2 Settings
 */

const ASOF = "2026-04-01";
const TODAY = "2026-09-01";

function plan(date: string, key = `p:${date}`): ForecastInstance {
  return {
    key,
    date,
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    srcId: "r1",
  };
}

const run = (over: Partial<Parameters<typeof buildReconcileWarnings>[0]> = {}) =>
  buildReconcileWarnings({
    lastReconciledAt: null,
    asOf: ASOF,
    unmatchedForecast: [],
    today: TODAY,
    ...over,
  });

/* ========================= 消し込みが止まっている ========================= */

describe("AC-29a 消し込みが止まっている", () => {
  it("閾値は45日", () => {
    /* 月次の周期は最大31日（1/5 → 2/5）。30日だと毎月1〜2日だけ鳴り、
       無視される警告になる。45日は31日を超え、1周期飛ばした62日より手前 */
    expect(STALLED_DAYS).toBe(45);
  });

  it("44日なら鳴らない", () => {
    expect(run({ lastReconciledAt: "2026-07-19", today: "2026-09-01" }).stalled)
      .toBeNull();
  });

  it("45日ちょうどで鳴る", () => {
    const got = run({ lastReconciledAt: "2026-07-18", today: "2026-09-01" });

    expect(got.stalled).toEqual({
      sinceDays: 45,
      from: "2026-07-18",
      neverReconciled: false,
    });
  });

  it("46日でも鳴る", () => {
    expect(run({ lastReconciledAt: "2026-07-17" }).stalled?.sinceDays).toBe(46);
  });

  /* ---------- null のときの起点（AC-29a） ---------- */

  it("null なら基準日を起点にする", () => {
    /* 基準日 4/1 から 9/1 は153日 */
    const got = run({ lastReconciledAt: null, asOf: ASOF, today: TODAY });

    expect(got.stalled).toEqual({
      sinceDays: 153,
      from: ASOF,
      neverReconciled: true,
    });
  });

  /**
   * ここが AC-29a の肝。
   *
   * null を「とても古い」と扱うと、登録したその日に警告が出る。
   * 起点を基準日にすると初日は0日経過になる。
   */
  it("新規利用者は初日に警告を受けない", () => {
    const got = run({ lastReconciledAt: null, asOf: TODAY, today: TODAY });

    expect(got.stalled).toBeNull();
  });

  it("基準日から44日でも鳴らない", () => {
    expect(run({ lastReconciledAt: null, asOf: "2026-07-19" }).stalled).toBeNull();
  });

  it("基準日から45日で鳴る", () => {
    expect(run({ lastReconciledAt: null, asOf: "2026-07-18" }).stalled).not.toBeNull();
  });

  it("基準日を未来に置いても鳴らない", () => {
    expect(run({ lastReconciledAt: null, asOf: "2026-12-01" }).stalled).toBeNull();
  });

  it("消し込むと止まる", () => {
    const before = run({ lastReconciledAt: null, asOf: ASOF });
    const after = run({ lastReconciledAt: TODAY });

    expect(before.stalled).not.toBeNull();
    expect(after.stalled).toBeNull();
  });
});

/* ========================= 取り残された予定 ========================= */

describe("AC-29b 取り残された予定がある", () => {
  it("閾値は60日", () => {
    expect(STRANDED_DAYS).toBe(60);
  });

  it("59日前の予定では鳴らない", () => {
    /* 9/1 の59日前は 7/4 */
    expect(run({ unmatchedForecast: [plan("2026-07-04")] }).stranded).toBeNull();
  });

  it("60日前ちょうどで鳴る", () => {
    const got = run({ unmatchedForecast: [plan("2026-07-03")] });

    expect(got.stranded).toEqual({ count: 1, oldest: "2026-07-03" });
  });

  it("件数と最も古い日付を出す", () => {
    const got = run({
      unmatchedForecast: [
        plan("2026-05-01"),
        plan("2026-06-01"),
        plan("2026-07-03"),
      ],
    });

    expect(got.stranded).toEqual({ count: 3, oldest: "2026-05-01" });
  });

  /* ---------- 未到来は数えない（AC-29b） ---------- */

  it("予定日が未到来の未消込は数えない", () => {
    expect(
      run({ unmatchedForecast: [plan("2026-12-01"), plan("2026-09-15")] }).stranded,
    ).toBeNull();
  });

  it("今日ちょうどの予定は数えない", () => {
    expect(run({ unmatchedForecast: [plan(TODAY)] }).stranded).toBeNull();
  });

  it("未到来と取り残しが混ざっていても、取り残しだけ数える", () => {
    const got = run({
      unmatchedForecast: [plan("2026-05-01"), plan("2026-12-01")],
    });

    expect(got.stranded?.count).toBe(1);
  });

  /**
   * `unplanned` は実績側のフラグで、予定インスタンスには現れない。
   * `unmatchedForecast` は CL-3 が返す予定だけなので、構造上数えられない。
   */
  it("unplanned の実績は予定ではないので数えられない", () => {
    /* 実績をいくら渡しても、この関数は予定しか見ない */
    expect(run({ unmatchedForecast: [] }).stranded).toBeNull();
  });

  it("予定が無ければ鳴らない", () => {
    expect(run({ unmatchedForecast: [] }).stranded).toBeNull();
  });
});

/* ========================= 2つは独立している ========================= */

describe("2つの警告は別々に出る", () => {
  it("片方だけ鳴ることがある", () => {
    /* 昨日消し込んだが、60日以上前の予定が残っている（バッチ運用者） */
    const got = run({
      lastReconciledAt: "2026-08-31",
      unmatchedForecast: [plan("2026-05-01")],
    });

    expect(got.stalled).toBeNull();
    expect(got.stranded).not.toBeNull();
  });

  it("両方鳴ることもある", () => {
    const got = run({
      lastReconciledAt: "2026-06-01",
      unmatchedForecast: [plan("2026-05-01")],
    });

    expect(got.stalled).not.toBeNull();
    expect(got.stranded).not.toBeNull();
  });

  it("どちらも鳴らないのが通常の状態", () => {
    const got = run({
      lastReconciledAt: "2026-08-25",
      unmatchedForecast: [plan("2026-09-15")],
    });

    expect(got).toEqual({ stalled: null, stranded: null });
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力", () => {
    const input = {
      lastReconciledAt: "2026-06-01",
      asOf: ASOF,
      unmatchedForecast: [plan("2026-05-01")],
      today: TODAY,
    };

    expect(buildReconcileWarnings(input)).toEqual(buildReconcileWarnings(input));
  });
});

/* ========================= 文面の出し分け（AC-29c） ========================= */

describe("AC-29c 一度も消し込んでいないケースを区別する", () => {
  /**
   * 「止まっている」は継続していたものが止まった言い方である。一度も
   * 消し込んでいない利用者に「115日止まっています」と出すのは誤りで、
   * 止まっているのではなく、まだ始まっていない。設定だけして放置した
   * 新規利用者がまさにこの状態になる。
   */
  it("null なら neverReconciled が立つ", () => {
    expect(run({ lastReconciledAt: null, asOf: ASOF }).stalled?.neverReconciled)
      .toBe(true);
  });

  it("一度でも消し込んでいれば立たない", () => {
    expect(
      run({ lastReconciledAt: "2026-06-01" }).stalled?.neverReconciled,
    ).toBe(false);
  });

  it("経過日数はどちらの場合も出す", () => {
    /* 文面は違っても、何日経ったかは両方に必要 */
    expect(run({ lastReconciledAt: null, asOf: ASOF }).stalled?.sinceDays).toBe(153);
    expect(run({ lastReconciledAt: "2026-06-01" }).stalled?.sinceDays).toBe(92);
  });
});
