import { describe, expect, it } from "vitest";

import { buildBalanceSeries, type BalanceInput } from "../balance";
import { buildMonthlyCashflow, type MonthlyCashflowRow } from "../monthly";
import type {
  Actual,
  CardAccount,
  DepositAccount,
  ForecastInstance,
} from "../types";

/* ========================= 素材 ========================= */

const seikatsu: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 1_000_000,
};

const jigyou: DepositAccount = {
  id: "a2",
  name: "事業口座",
  kind: "bank",
  balance: 0,
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
    name: "支出",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 100_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    srcId: "r1",
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

/** CL-3 → CL-6 を通す */
function monthly(
  balanceInput: BalanceInput,
  to: string,
  reserveLine = 0,
  today = "2026-04-01",
): MonthlyCashflowRow[] {
  return buildMonthlyCashflow(
    buildBalanceSeries(balanceInput, to, today),
    reserveLine,
  );
}

const at = (rows: MonthlyCashflowRow[], ym: string): MonthlyCashflowRow => {
  const row = rows.find((r) => r.yearMonth === ym);
  if (!row) throw new Error(`その月の行がありません: ${ym}`);
  return row;
};

/* ========================= 列の算出 ========================= */

describe("CL-6 各列の算出", () => {
  it("入金・出金・収支・月末残高", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({ key: "p1", date: "2026-04-10", type: "income", categoryCode: "INC-01", costType: null, amount: 450_000 }),
          plan({ key: "p2", date: "2026-04-20", amount: 120_000 }),
          plan({ key: "p3", date: "2026-04-25", amount: 80_000 }),
        ],
      }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04")).toMatchObject({
      opening: 1_000_000,
      inflow: 450_000,
      outflow: 200_000,
      net: 250_000,
      closing: 1_250_000,
    });
  });

  it("前月繰越は前月の月末残高", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({ key: "p1", date: "2026-04-20", amount: 100_000 }),
          plan({ key: "p2", date: "2026-05-20", amount: 200_000 }),
          plan({ key: "p3", date: "2026-06-20", amount: 300_000 }),
        ],
      }),
      "2026-06-30",
    );

    expect(rows.map((r) => [r.yearMonth, r.opening, r.closing])).toEqual([
      ["2026-04", 1_000_000, 900_000],
      ["2026-05", 900_000, 700_000],
      ["2026-06", 700_000, 400_000],
    ]);
  });

  it("初月の前月繰越は 月末残高 − 当月入金 + 当月出金", () => {
    // 基準日が月の途中でも、繰越は基準日時点の残高になる
    const rows = monthly(
      input({
        asOf: "2026-04-15",
        forecast: [plan({ key: "p1", date: "2026-04-20", amount: 100_000 })],
      }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04")).toMatchObject({
      opening: 1_000_000,
      outflow: 100_000,
      closing: 900_000,
    });
  });

  it("前月繰越 + 収支 = 月末残高 が全月で成り立つ", () => {
    const rows = monthly(
      input({
        accounts: [seikatsu, jigyou, card({ balance: 142_000 })],
        forecast: [
          plan({ key: "p1", date: "2026-04-10", type: "income", categoryCode: "INC-01", costType: null, amount: 450_000, accountId: "a2" }),
          plan({ key: "p2", date: "2026-04-20", amount: 60_000, accountId: "c1" }),
          plan({ key: "p3", date: "2026-05-05", amount: 80_000 }),
          plan({ key: "p4", date: "2026-06-26", type: "transfer", categoryCode: "TRF-02", costType: null, amount: 300_000, accountId: "a2", toAccountId: "a1" }),
        ],
      }),
      "2026-07-31",
    );

    for (const row of rows) {
      expect(row.opening + row.net).toBe(row.closing);
    }
  });

  it("月中最低とその日付", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({ key: "p1", date: "2026-04-10", amount: 900_000 }),
          plan({ key: "p2", date: "2026-04-25", type: "income", categoryCode: "INC-01", costType: null, amount: 800_000 }),
        ],
      }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04")).toMatchObject({
      lowest: 100_000,
      lowestDate: "2026-04-10",
      closing: 900_000,
    });
  });

  it("月中最低は最初に到達した日を返す", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({ key: "p1", date: "2026-04-10", amount: 500_000 }),
          plan({ key: "p2", date: "2026-04-20", type: "income", categoryCode: "INC-01", costType: null, amount: 0 }),
        ],
      }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04").lowestDate).toBe("2026-04-10");
  });

  it("振替は入金にも出金にも数えない", () => {
    const rows = monthly(
      input({
        accounts: [seikatsu, jigyou],
        forecast: [
          plan({
            key: "t1",
            date: "2026-04-26",
            type: "transfer",
            categoryCode: "TRF-02",
            costType: null,
            amount: 380_000,
            accountId: "a1",
            toAccountId: "a2",
          }),
        ],
      }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04")).toMatchObject({
      inflow: 0,
      outflow: 0,
      net: 0,
      closing: 1_000_000,
    });
  });

  it("行が無ければ空", () => {
    expect(buildMonthlyCashflow({ rows: [], unmatchedForecast: [], actualEnd: "2026-04-01", projectedCash: [], actualCash: [] }, 0)).toEqual([]);
  });
});

/* ========================= カード引落 ========================= */

describe("CL-6 カード引落は引落日で出金に計上する", () => {
  it("利用日ではなく引落日の月に出金が立つ", () => {
    const rows = monthly(
      input({
        accounts: [seikatsu, card()],
        // 4/20 利用 → 20 > 15 なので5月締め → 6/10 引落
        forecast: [plan({ key: "p1", date: "2026-04-20", amount: 60_000, accountId: "c1" })],
      }),
      "2026-06-30",
    );

    expect(at(rows, "2026-04").outflow).toBe(0);
    expect(at(rows, "2026-05").outflow).toBe(0);
    expect(at(rows, "2026-06").outflow).toBe(60_000);
  });

  it("基準日の未払残高は最初の引落日の月に立つ", () => {
    const rows = monthly(
      input({ accounts: [seikatsu, card({ balance: 142_000 })] }),
      "2026-05-31",
    );

    expect(at(rows, "2026-04").outflow).toBe(142_000);
    expect(at(rows, "2026-05").outflow).toBe(0);
  });
});

/* ========================= AC-20 後半 ========================= */

describe("AC-20 後半 TRF グループは月次資金繰り表の出金に含まれる", () => {
  it("借入返済の元金（TRF-06）が出金に入る", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({
            key: "l:loan1:2026-04-27#p",
            date: "2026-04-27",
            name: "公庫 運転資金 返済（元金）",
            categoryCode: "TRF-06",
            costType: null,
            amount: 82_000,
          }),
          plan({
            key: "l:loan1:2026-04-27#i",
            date: "2026-04-27",
            name: "公庫 運転資金 返済（利息）",
            categoryCode: "EXP-15",
            costType: "fixed",
            amount: 8_300,
          }),
        ],
      }),
      "2026-04-30",
    );

    // 元金と利息の両方が出金に含まれる
    expect(at(rows, "2026-04").outflow).toBe(90_300);
    expect(at(rows, "2026-04").closing).toBe(1_000_000 - 90_300);
  });

  it("カード引落（TRF-04）が出金に入る", () => {
    const rows = monthly(
      input({ accounts: [seikatsu, card({ balance: 50_000 })] }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04").outflow).toBe(50_000);
  });

  it("借入実行（TRF-05）が入金に入る", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({
            key: "o:loan-in",
            date: "2026-04-01",
            name: "公庫 運転資金 実行",
            type: "income",
            categoryCode: "TRF-05",
            costType: null,
            amount: 5_000_000,
          }),
        ],
      }),
      "2026-04-30",
    );

    expect(at(rows, "2026-04").inflow).toBe(5_000_000);
  });
});

/* ========================= AC-06 ========================= */

describe("AC-06 月中に防衛ラインを下回る月の警告", () => {
  /* 4月：10日に90万円出て残高10万円まで落ち、25日に80万円入って月末は90万円。
     月末残高は防衛ライン60万円を上回るが、月中は下回る。 */
  const dipping = input({
    forecast: [
      plan({ key: "p1", date: "2026-04-10", amount: 900_000 }),
      plan({ key: "p2", date: "2026-04-25", type: "income", categoryCode: "INC-01", costType: null, amount: 800_000 }),
    ],
  });

  it("月末残高がプラスでも月中に下回れば警告が出る", () => {
    const rows = monthly(dipping, "2026-04-30", 600_000);
    const april = at(rows, "2026-04");

    expect(april.closing).toBe(900_000);
    expect(april.closing).toBeGreaterThan(600_000);
    expect(april.warning).toEqual({
      kind: "reserveBreach",
      date: "2026-04-10",
      balance: 100_000,
    });
  });

  it("残高がマイナスになる月は資金ショートとして区別する", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({ key: "p1", date: "2026-04-10", amount: 1_200_000 }),
          plan({ key: "p2", date: "2026-04-25", type: "income", categoryCode: "INC-01", costType: null, amount: 1_500_000 }),
        ],
      }),
      "2026-04-30",
      600_000,
    );

    expect(at(rows, "2026-04").warning).toEqual({
      kind: "shortfall",
      date: "2026-04-10",
      balance: -200_000,
    });
  });

  it("防衛ラインを下回らなければ警告は出ない", () => {
    const rows = monthly(dipping, "2026-04-30", 50_000);

    expect(at(rows, "2026-04").warning).toBeNull();
  });

  it("ちょうど防衛ラインの残高は警告にしない", () => {
    const rows = monthly(
      input({ forecast: [plan({ key: "p1", date: "2026-04-10", amount: 400_000 })] }),
      "2026-04-30",
      600_000,
    );

    expect(at(rows, "2026-04").lowest).toBe(600_000);
    expect(at(rows, "2026-04").warning).toBeNull();
  });

  it("1円下回れば警告になる", () => {
    const rows = monthly(
      input({ forecast: [plan({ key: "p1", date: "2026-04-10", amount: 400_001 })] }),
      "2026-04-30",
      600_000,
    );

    expect(at(rows, "2026-04").warning?.kind).toBe("reserveBreach");
  });

  it("警告の出る月と出ない月が混在する", () => {
    const rows = monthly(
      input({
        forecast: [
          plan({ key: "p1", date: "2026-05-10", amount: 900_000 }),
          plan({ key: "p2", date: "2026-05-25", type: "income", categoryCode: "INC-01", costType: null, amount: 800_000 }),
        ],
      }),
      "2026-06-30",
      600_000,
    );

    expect(at(rows, "2026-04").warning).toBeNull();
    expect(at(rows, "2026-05").warning?.kind).toBe("reserveBreach");
    expect(at(rows, "2026-06").warning).toBeNull();
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力を返す", () => {
    const series = buildBalanceSeries(
      input({ forecast: [plan({ key: "p1", date: "2026-04-10" })] }),
      "2026-06-30",
      "2026-04-01",
    );

    expect(buildMonthlyCashflow(series, 600_000)).toEqual(
      buildMonthlyCashflow(series, 600_000),
    );
  });

  it("入力を書き換えない", () => {
    const series = buildBalanceSeries(
      input({ forecast: [plan({ key: "p1", date: "2026-04-10" })] }),
      "2026-06-30",
      "2026-04-01",
    );
    const snapshot = structuredClone(series);

    buildMonthlyCashflow(series, 600_000);

    expect(series).toEqual(snapshot);
  });

  it("基準日より前の実績は数えない", () => {
    /* CL-3 は基準日から累積するので、基準日より前の実績は残高に効かない。
       CL-6 も同じ範囲だけを数える。数えると繰越がずれる。 */
    const actuals: Actual[] = [
      {
        id: "old",
        key: null,
        date: "2026-03-20",
        name: "先月の支出",
        type: "expense",
        costType: "variable",
        categoryCode: "EXP-21",
        amount: 500_000,
        bizRatio: 0,
        accountId: "a1",
      },
    ];

    const rows = monthly(input({ asOf: "2026-04-01", actuals }), "2026-04-30");

    expect(at(rows, "2026-04")).toMatchObject({
      opening: 1_000_000,
      outflow: 0,
      closing: 1_000_000,
    });
  });
});
