import { describe, expect, it } from "vitest";

import {
  accountDelta,
  buildBalanceSeries,
  type BalanceInput,
  type BalanceRow,
  type BalanceSeries,
} from "../balance";
import type {
  Account,
  Actual,
  CardAccount,
  CashEvent,
  DepositAccount,
  ForecastInstance,
} from "../types";

/* ========================= 素材 ========================= */

const seikatsu: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 380_000,
};

const jigyou: DepositAccount = {
  id: "a2",
  name: "事業口座",
  kind: "bank",
  balance: 1_150_000,
};

/** 締日15日・翌月・支払日10日 */
function card(over: Partial<CardAccount> = {}): CardAccount {
  return {
    id: "c1",
    name: "メインカード",
    kind: "card",
    balance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 10,
    settleAccountId: "a1",
    ...over,
  };
}

function plan(
  over: Partial<ForecastInstance> & Pick<ForecastInstance, "key" | "date">,
): ForecastInstance {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    category: "住居費",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    srcId: "rh1",
    ...over,
  };
}

function actual(
  over: Partial<Actual> & Pick<Actual, "id" | "date">,
): Actual {
  return {
    key: null,
    name: "家賃",
    type: "expense",
    costType: "fixed",
    category: "住居費",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    ...over,
  };
}

function input(over: Partial<BalanceInput> = {}): BalanceInput {
  return {
    accounts: [seikatsu],
    asOf: "2026-04-01",
    forecast: [],
    actuals: [],
    ...over,
  };
}

const at = (series: BalanceSeries, date: string): BalanceRow => {
  const row = series.rows.find((r) => r.date === date);
  if (!row) throw new Error(`その日の行がありません: ${date}`);
  return row;
};

/* ========================= CL-3 手順1 ========================= */

describe("CL-3 開始残高", () => {
  it("現金・銀行口座の基準日残高の合計が開始残高になる", () => {
    const got = buildBalanceSeries(
      input({ accounts: [seikatsu, jigyou] }),
      "2026-04-01",
      "2026-04-01",
    );

    expect(got.rows[0]).toMatchObject({
      date: "2026-04-01",
      proj: 1_530_000,
      act: 1_530_000,
    });
  });

  it("カードの未払残高は開始残高に含めない", () => {
    const got = buildBalanceSeries(
      input({ accounts: [seikatsu, card({ balance: 142_000 })] }),
      "2026-04-01",
      "2026-04-01",
    );

    expect(got.rows[0].proj).toBe(380_000);
    expect(got.rows[0].byCard).toEqual({ c1: 142_000 });
  });

  it("基準日から to まで1日ずつ行を作る", () => {
    const got = buildBalanceSeries(input(), "2026-04-05", "2026-04-01");

    expect(got.rows.map((r) => r.date)).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
    ]);
  });

  it("月と年をまたいで1日ずつ進む", () => {
    const got = buildBalanceSeries(input({ asOf: "2026-12-30" }), "2027-01-02", "2026-12-30");

    expect(got.rows.map((r) => r.date)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("閏日をまたぐ", () => {
    const got = buildBalanceSeries(input({ asOf: "2028-02-27" }), "2028-03-01", "2028-02-27");

    expect(got.rows.map((r) => r.date)).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });
});

/* ========================= CL-3 手順2 消し込み ========================= */

describe("CL-3 消し込み", () => {
  it("実績が持つキーの予定は予測から外れる", () => {
    const got = buildBalanceSeries(
      input({
        forecast: [plan({ key: "r:rh1:2026-04-27", date: "2026-04-27" })],
        actuals: [
          actual({ id: "x", date: "2026-04-27", key: "r:rh1:2026-04-27", amount: 118_000 }),
        ],
      }),
      "2026-04-30",
      "2026-04-30",
    );

    expect(got.unmatchedForecast).toEqual([]);
    // 予定の120,000ではなく実績の118,000だけが引かれる
    expect(at(got, "2026-04-30").proj).toBe(380_000 - 118_000);
  });

  it("キーの無い実績は何も消し込まない", () => {
    const got = buildBalanceSeries(
      input({
        forecast: [plan({ key: "r:rh1:2026-04-27", date: "2026-04-27" })],
        actuals: [actual({ id: "x", date: "2026-04-10", amount: 5_000, key: null })],
      }),
      "2026-04-30",
      "2026-04-30",
    );

    expect(got.unmatchedForecast).toHaveLength(1);
    expect(at(got, "2026-04-30").proj).toBe(380_000 - 5_000 - 120_000);
  });

  it("未消込の過去予定は予定額のまま予測に残る", () => {
    // 「除外すると残高を楽観視することになるため」（CL-3 の注記）
    const got = buildBalanceSeries(
      input({ forecast: [plan({ key: "r:rh1:2026-04-05", date: "2026-04-05" })] }),
      "2026-04-30",
      "2026-04-20", // 4/5 はすでに過去
    );

    expect(got.unmatchedForecast).toHaveLength(1);
    expect(at(got, "2026-04-30").proj).toBe(380_000 - 120_000);
  });
});

/* ========================= CL-3 手順3・4 系列 ========================= */

describe("CL-3 予測系列と実績系列", () => {
  it("予測は実績と未消込の予定を足す。実績系列は実績だけ", () => {
    const got = buildBalanceSeries(
      input({
        forecast: [plan({ key: "p1", date: "2026-04-20", amount: 100_000 })],
        actuals: [actual({ id: "x", date: "2026-04-10", amount: 30_000 })],
      }),
      "2026-04-30",
      "2026-04-30",
    );

    expect(at(got, "2026-04-09")).toMatchObject({ proj: 380_000, act: 380_000 });
    expect(at(got, "2026-04-10")).toMatchObject({ proj: 350_000, act: 350_000 });
    // 4/20 の予定は予測だけを動かす
    expect(at(got, "2026-04-20")).toMatchObject({ proj: 250_000, act: 350_000 });
  });

  it("実績系列は actualEnd より後を null にする", () => {
    const got = buildBalanceSeries(
      input({ actuals: [actual({ id: "x", date: "2026-04-10", amount: 30_000 })] }),
      "2026-04-30",
      "2026-04-15",
    );

    expect(got.actualEnd).toBe("2026-04-15");
    expect(at(got, "2026-04-15").act).toBe(350_000);
    expect(at(got, "2026-04-16").act).toBeNull();
    expect(at(got, "2026-04-30").act).toBeNull();
    // 予測側は切れない
    expect(at(got, "2026-04-30").proj).toBe(350_000);
  });

  it("最終実績日が今日より後ならそちらまで実績系列を伸ばす", () => {
    const got = buildBalanceSeries(
      input({ actuals: [actual({ id: "x", date: "2026-04-25", amount: 30_000 })] }),
      "2026-04-30",
      "2026-04-15",
    );

    expect(got.actualEnd).toBe("2026-04-25");
    expect(at(got, "2026-04-25").act).toBe(350_000);
    expect(at(got, "2026-04-26").act).toBeNull();
  });

  it("実績が無ければ actualEnd は今日", () => {
    const got = buildBalanceSeries(input(), "2026-04-30", "2026-04-15");

    expect(got.actualEnd).toBe("2026-04-15");
  });
});

/* ========================= CL-3 手順5 口座別とカード ========================= */

describe("CL-3 口座別の残高", () => {
  it("口座ごとに別々に累積する", () => {
    const got = buildBalanceSeries(
      input({
        accounts: [seikatsu, jigyou],
        forecast: [
          plan({ key: "p1", date: "2026-04-10", amount: 50_000, accountId: "a1" }),
          plan({
            key: "p2",
            date: "2026-04-25",
            amount: 450_000,
            accountId: "a2",
            type: "income",
          }),
        ],
      }),
      "2026-04-30",
      "2026-04-30",
    );

    expect(at(got, "2026-04-30").byAccount).toEqual({
      a1: 380_000 - 50_000,
      a2: 1_150_000 + 450_000,
    });
    expect(at(got, "2026-04-30").proj).toBe(1_530_000 - 50_000 + 450_000);
  });
});

describe("CL-3 カードの未払残高", () => {
  const accounts: Account[] = [seikatsu, card({ balance: 142_000 })];

  it("利用日に未払が増え、引落日に減る", () => {
    const got = buildBalanceSeries(
      input({
        accounts,
        forecast: [
          plan({ key: "p1", date: "2026-04-05", amount: 8_000, accountId: "c1" }),
        ],
      }),
      "2026-05-31",
      "2026-04-01",
    );

    // 基準日は未払142,000
    expect(at(got, "2026-04-01").byCard.c1).toBe(142_000);
    // 4/5 に8,000使って150,000
    expect(at(got, "2026-04-05").byCard.c1).toBe(150_000);
    // 4/10 は繰越の142,000だけが落ちる。
    // 4/5 の利用は 5 <= 15 で4月締め、その翌月払いなので 5/10 になる
    expect(at(got, "2026-04-10").byCard.c1).toBe(8_000);
    // 5/10 に残る8,000が落ちて0
    expect(at(got, "2026-05-10").byCard.c1).toBe(0);
  });

  it("引落は現預金の残高を動かす", () => {
    const got = buildBalanceSeries(
      input({
        accounts,
        forecast: [
          plan({ key: "p1", date: "2026-04-05", amount: 8_000, accountId: "c1" }),
        ],
      }),
      "2026-05-31",
      "2026-04-01",
    );

    // 4/5 の利用では現預金は動かない
    expect(at(got, "2026-04-05").proj).toBe(380_000);
    // 4/10 に繰越の142,000が引き落ちる
    expect(at(got, "2026-04-10").proj).toBe(380_000 - 142_000);
    // 5/10 に4月締めの8,000が引き落ちる
    expect(at(got, "2026-05-10").proj).toBe(380_000 - 142_000 - 8_000);
  });

  it("返金が締め期間の合計を上回ると未払はマイナスになる", () => {
    const got = buildBalanceSeries(
      input({
        accounts: [seikatsu, card()],
        forecast: [
          plan({ key: "p1", date: "2026-04-05", amount: 3_000, accountId: "c1" }),
          plan({
            key: "p2",
            date: "2026-04-06",
            amount: 10_000,
            accountId: "c1",
            type: "income",
          }),
        ],
      }),
      "2026-05-31",
      "2026-04-01",
    );

    // 利用3,000 → 返金10,000 で 未払 −7,000
    expect(at(got, "2026-04-06").byCard.c1).toBe(-7_000);
    // 5/10 に7,000が戻ってきて、未払は0に戻る
    expect(at(got, "2026-05-10").byCard.c1).toBe(0);
    expect(at(got, "2026-05-10").proj).toBe(380_000 + 7_000);
  });
});

/* ========================= CL-3 手順6 振替 ========================= */

describe("CL-3 振替", () => {
  it("合計残高は動かず、口座別だけが付け替わる", () => {
    const got = buildBalanceSeries(
      input({
        accounts: [seikatsu, jigyou],
        forecast: [
          plan({
            key: "t1",
            date: "2026-04-26",
            amount: 380_000,
            type: "transfer",
            costType: null,
            category: null,
            accountId: "a2",
            toAccountId: "a1",
          }),
        ],
      }),
      "2026-04-30",
      "2026-04-30",
    );

    expect(at(got, "2026-04-30").proj).toBe(1_530_000);
    expect(at(got, "2026-04-30").byAccount).toEqual({
      a1: 380_000 + 380_000,
      a2: 1_150_000 - 380_000,
    });
  });
});

describe("accountDelta", () => {
  const base: CashEvent = {
    key: "k",
    date: "2026-04-10",
    name: "x",
    type: "expense",
    costType: null,
    category: null,
    amount: 1_000,
    bizRatio: 0,
    accountId: "a1",
    src: "oneoff",
  };

  it("expense はその口座を減らす", () => {
    expect(accountDelta(base, "a1")).toBe(-1_000);
    expect(accountDelta(base, "a2")).toBe(0);
  });

  it("income はその口座を増やす", () => {
    expect(accountDelta({ ...base, type: "income" }, "a1")).toBe(1_000);
  });

  it("transfer は送金元を減らし送金先を増やす", () => {
    const t: CashEvent = { ...base, type: "transfer", toAccountId: "a2" };
    expect(accountDelta(t, "a1")).toBe(-1_000);
    expect(accountDelta(t, "a2")).toBe(1_000);
    expect(accountDelta(t, "a3")).toBe(0);
  });
});

/* ========================= AC-01 通し ========================= */

describe("AC-01 通しの確認", () => {
  it("締日15日・翌月10日払いのカードで 8/20 に10,000円を利用した場合", () => {
    const got = buildBalanceSeries(
      {
        accounts: [seikatsu, card()],
        asOf: "2026-08-01",
        forecast: [
          plan({
            key: "o:o1",
            date: "2026-08-20",
            name: "買い物",
            amount: 10_000,
            accountId: "c1",
            src: "oneoff",
            srcId: "o1",
          }),
        ],
        actuals: [],
      },
      "2026-10-31",
      "2026-08-01",
    );

    // 8/20 の口座残高は変化しない
    expect(at(got, "2026-08-19").proj).toBe(380_000);
    expect(at(got, "2026-08-20").proj).toBe(380_000);
    expect(at(got, "2026-08-21").proj).toBe(380_000);

    // 10/10 に10,000円が引き落とされる
    expect(at(got, "2026-10-09").proj).toBe(380_000);
    expect(at(got, "2026-10-10").proj).toBe(380_000 - 10_000);

    // 引落イベントが1件だけ立っている
    const settlements = got.projectedCash.filter((e) => e.src === "settle");
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      date: "2026-10-10",
      amount: 10_000,
      accountId: "a1",
      cardId: "c1",
    });
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("入力を書き換えない", () => {
    const arg = input({
      accounts: [seikatsu, card({ balance: 142_000 })],
      forecast: [plan({ key: "p1", date: "2026-04-05", accountId: "c1" })],
      actuals: [actual({ id: "x", date: "2026-04-02" })],
    });
    const snapshot = structuredClone(arg);

    buildBalanceSeries(arg, "2026-05-31", "2026-04-15");

    expect(arg).toEqual(snapshot);
  });

  it("行ごとの byAccount が共有されていない", () => {
    const got = buildBalanceSeries(
      input({ forecast: [plan({ key: "p1", date: "2026-04-03", amount: 1_000 })] }),
      "2026-04-05",
      "2026-04-05",
    );

    expect(got.rows[0].byAccount.a1).toBe(380_000);
    expect(got.rows[4].byAccount.a1).toBe(379_000);
    expect(got.rows[0].byAccount).not.toBe(got.rows[4].byAccount);
  });

  it("同じ入力なら同じ出力を返す", () => {
    const arg = input({
      accounts: [seikatsu, card({ balance: 142_000 })],
      forecast: [plan({ key: "p1", date: "2026-04-05", accountId: "c1" })],
    });

    expect(buildBalanceSeries(arg, "2026-05-31", "2026-04-15")).toEqual(
      buildBalanceSeries(arg, "2026-05-31", "2026-04-15"),
    );
  });
});
