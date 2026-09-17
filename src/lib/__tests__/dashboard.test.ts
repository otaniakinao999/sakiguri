import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import type {
  CardAccount,
  DepositAccount,
  OneoffItem,
  RecurringItem,
} from "@/core/types";

import { buildDashboard, DASHBOARD_HORIZON_DAYS } from "../dashboard";

const ASOF = "2026-04-01";
const TODAY = "2026-04-15";
const TO = "2027-06-30";

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
  balance: 500_000,
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

function recurring(
  over: Partial<RecurringItem> & Pick<RecurringItem, "id" | "day">,
): RecurringItem {
  return {
    name: "支出",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 100_000,
    bizRatio: 0,
    accountId: "a1",
    months: null,
    active: true,
    ...over,
  };
}

function run({
  accounts = [seikatsu],
  recurring: items = [],
  oneoffs = [],
  actuals = [],
  reserveLine = 0,
  today = TODAY,
}: {
  accounts?: (DepositAccount | CardAccount)[];
  recurring?: RecurringItem[];
  oneoffs?: OneoffItem[];
  actuals?: Parameters<typeof buildBalanceSeries>[0]["actuals"];
  reserveLine?: number;
  today?: string;
} = {}) {
  const forecast = buildForecast({ recurring: items, oneoffs }, ASOF, TO);
  const series = buildBalanceSeries(
    { accounts, asOf: ASOF, forecast, actuals },
    TO,
    today,
  );
  return buildDashboard({ series, accounts, reserveLine, today });
}

/* ========================= 今後90日の資金繰り ========================= */

describe("今後90日の最低残高と警告", () => {
  it("予定が無ければ最低残高は現在の残高", () => {
    const got = run();

    expect(got.current).toBe(1_000_000);
    expect(got.lowest.balance).toBe(1_000_000);
    expect(got.warning).toBeNull();
  });

  it("90日以内の落ち込みを拾う", () => {
    // 5/10 に 900,000 出る → 残高 100,000
    const got = run({
      oneoffs: [
        {
          id: "o1",
          date: "2026-05-10",
          name: "設備投資",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 900_000,
          bizRatio: 100,
          accountId: "a1",
        },
      ],
    });

    expect(got.lowest).toEqual({ balance: 100_000, date: "2026-05-10" });
  });

  it("90日より先の落ち込みは拾わない", () => {
    // 今日は 4/15。90日後は 7/14。7/20 は範囲外
    const got = run({
      oneoffs: [
        {
          id: "o1",
          date: "2026-07-20",
          name: "先の支出",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 900_000,
          bizRatio: 0,
          accountId: "a1",
        },
      ],
    });

    expect(got.lowest.balance).toBe(1_000_000);
    expect(got.warning).toBeNull();
  });

  it("今日より前は見ない", () => {
    // 4/5 は今日（4/15）より前。実績が無いので予測には残るが、
    // ダッシュボードの最低残高の窓には入らない
    const got = run({ recurring: [recurring({ id: "r1", day: 5, amount: 400_000 })] });

    expect(got.lowest.date >= TODAY).toBe(true);
  });

  it("防衛ラインを下回ると reserveBreach", () => {
    const got = run({
      oneoffs: [
        {
          id: "o1",
          date: "2026-04-20",
          name: "支出",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 500_000,
          bizRatio: 0,
          accountId: "a1",
        },
      ],
      reserveLine: 600_000,
    });

    expect(got.warning).toEqual({
      kind: "reserveBreach",
      date: "2026-04-20",
      balance: 500_000,
    });
  });

  it("マイナスになると shortfall", () => {
    const got = run({
      oneoffs: [
        {
          id: "o1",
          date: "2026-04-20",
          name: "支出",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 1_200_000,
          bizRatio: 0,
          accountId: "a1",
        },
      ],
      reserveLine: 600_000,
    });

    expect(got.warning?.kind).toBe("shortfall");
    expect(got.warning?.balance).toBe(-200_000);
  });

  it("ちょうど防衛ラインなら警告しない", () => {
    const got = run({
      oneoffs: [
        {
          id: "o1",
          date: "2026-04-20",
          name: "支出",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 400_000,
          bizRatio: 0,
          accountId: "a1",
        },
      ],
      reserveLine: 600_000,
    });

    expect(got.lowest.balance).toBe(600_000);
    expect(got.warning).toBeNull();
  });

  it("防衛ライン0なら、マイナスになるまで警告しない", () => {
    const got = run({
      oneoffs: [
        {
          id: "o1",
          date: "2026-04-20",
          name: "支出",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 900_000,
          bizRatio: 0,
          accountId: "a1",
        },
      ],
      reserveLine: 0,
    });

    expect(got.warning).toBeNull();
  });

  it("見る範囲は90日", () => {
    expect(DASHBOARD_HORIZON_DAYS).toBe(90);
  });
});

/* ========================= 実績が未入力の予定 ========================= */

describe("実績が未入力の予定（CL-3 の注記）", () => {
  it("今日より前の未消込の予定を拾う", () => {
    const got = run({ recurring: [recurring({ id: "r1", day: 5 })] });

    // 4/5 は過去。4/15 以降の回は入らない
    expect(got.unfilled.map((p) => p.date)).toEqual(["2026-04-05"]);
  });

  it("未来の予定は入らない", () => {
    const got = run({ recurring: [recurring({ id: "r1", day: 25 })] });

    expect(got.unfilled).toEqual([]);
  });

  it("消し込み済みは入らない", () => {
    const got = run({
      recurring: [recurring({ id: "r1", day: 5 })],
      actuals: [
        {
          id: "x1",
          key: "r:r1:2026-04-05",
          date: "2026-04-05",
          name: "支出",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-21",
          amount: 100_000,
          bizRatio: 0,
          accountId: "a1",
        },
      ],
    });

    expect(got.unfilled).toEqual([]);
  });

  it("新しい順に並ぶ", () => {
    const got = run({
      recurring: [
        recurring({ id: "r1", day: 3 }),
        recurring({ id: "r2", day: 10 }),
      ],
    });

    expect(got.unfilled.map((p) => p.date)).toEqual([
      "2026-04-10",
      "2026-04-03",
    ]);
  });
});

/* ========================= 口座・カード ========================= */

describe("口座・カードの残高", () => {
  it("口座ごとの残高と合計を出す", () => {
    const got = run({ accounts: [seikatsu, jigyou] });

    expect(got.accounts.map((a) => [a.account.name, a.balance])).toEqual([
      ["生活口座", 1_000_000],
      ["事業口座", 500_000],
    ]);
    expect(got.total).toBe(1_500_000);
  });

  it("カードは現預金の合計に含めない", () => {
    const got = run({ accounts: [seikatsu, card] });

    // 基準日の未払142,000は4/10に引き落ちている（今日は4/15）
    expect(got.total).toBe(1_000_000 - 142_000);
    expect(got.accounts).toHaveLength(1);
    expect(got.cards).toHaveLength(1);
  });

  it("カードの未払残高と次回引落を出す", () => {
    const got = run({ accounts: [seikatsu, card] });
    const [c] = got.cards;

    // 基準日 4/1 の未払 142,000 は 4/10 に落ちる。今日は 4/15 なので落ちた後
    expect(c.due).toBe(0);
    expect(c.next).toBeNull();
  });

  it("引落前ならその予定を出す", () => {
    const got = run({ accounts: [seikatsu, card], today: "2026-04-05" });
    const [c] = got.cards;

    expect(c.due).toBe(142_000);
    expect(c.next).toEqual({ date: "2026-04-10", amount: 142_000 });
  });

  it("口座別の残高は予定を織り込む", () => {
    const got = run({
      accounts: [seikatsu, jigyou],
      recurring: [recurring({ id: "r1", day: 5, amount: 200_000, accountId: "a1" })],
    });

    // 4/5 の支出は今日（4/15）より前なので反映されている
    expect(got.accounts[0].balance).toBe(800_000);
    expect(got.accounts[1].balance).toBe(500_000);
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力", () => {
    expect(run({ accounts: [seikatsu, card] })).toEqual(
      run({ accounts: [seikatsu, card] }),
    );
  });

  it("口座が無ければ空で返る", () => {
    const got = run({ accounts: [] });

    expect(got.accounts).toEqual([]);
    expect(got.cards).toEqual([]);
    expect(got.total).toBe(0);
  });
});
