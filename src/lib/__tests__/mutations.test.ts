import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { buildPLMatrix } from "@/core/pl";
import { actualToEvent } from "@/core/cash";
import type { CardAccount, DepositAccount, RecurringItem } from "@/core/types";

import { emptyAppData, type AppData } from "../app-data";
import {
  addAccount,
  addActual,
  addOneoff,
  addRecurring,
  blankActual,
  blankOneoff,
  blankRecurring,
  clearOverride,
  removeAccount,
  removeActual,
  removeOneoff,
  removeRecurring,
  setAsOf,
  setOverride,
  setReserveLine,
  settleAsPlanned,
  toggleRecurringActive,
  updateAccount,
  updateOneoff,
  updateRecurring,
} from "../mutations";

const ASOF = "2026-04-01";
const TODAY = "2026-04-30";

const bank: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 1_000_000,
};

const card: CardAccount = {
  id: "c1",
  name: "メインカード",
  kind: "card",
  balance: 0,
  closingDay: 15,
  payMonthOffset: 1,
  payDay: 10,
  settleAccountId: "a1",
};

const rent: RecurringItem = {
  id: "rent",
  name: "家賃",
  type: "expense",
  costType: "fixed",
  categoryCode: "EXP-01",
  amount: 120_000,
  bizRatio: 0,
  accountId: "a1",
  day: 27,
  months: null,
  active: true,
};

function base(): AppData {
  return {
    ...emptyAppData(ASOF),
    accounts: [bank, card],
    recurring: [rent],
  };
}

/* ========================= 不変であること ========================= */

describe("すべての更新が元のデータを書き換えない", () => {
  it("代表的な操作で入力が変わらない", () => {
    const data = base();
    const snapshot = structuredClone(data);

    setAsOf(data, "2026-05-01");
    setReserveLine(data, 600_000);
    addAccount(data, bank);
    updateAccount(data, "a1", { name: "変更" });
    removeAccount(data, "a1");
    addRecurring(data, rent);
    updateRecurring(data, "rent", { amount: 1 });
    toggleRecurringActive(data, "rent");
    removeRecurring(data, "rent");
    addOneoff(data, blankOneoff("o1", "a1", ASOF));
    addActual(data, blankActual("x1", "a1", ASOF));
    setOverride(data, "r:rent:2026-04-27", { skipped: true });

    expect(data).toEqual(snapshot);
  });
});

/* ========================= 設定 ========================= */

describe("基準日と防衛ライン", () => {
  it("差し替える", () => {
    expect(setAsOf(base(), "2026-05-01").asOf).toBe("2026-05-01");
    expect(setReserveLine(base(), 600_000).reserveLine).toBe(600_000);
  });
});

/* ========================= 口座（FR-01） ========================= */

describe("口座・カード", () => {
  it("追加と更新", () => {
    const added = addAccount(emptyAppData(ASOF), bank);
    expect(added.accounts).toHaveLength(1);
    expect(updateAccount(added, "a1", { name: "新しい名前" }).accounts[0].name).toBe(
      "新しい名前",
    );
  });

  it("削除すると、その口座を使う予定と実績も消える", () => {
    const data = {
      ...base(),
      oneoffs: [blankOneoff("o1", "a1", ASOF)],
      actuals: [blankActual("x1", "a1", ASOF)],
    };

    const after = removeAccount(data, "a1");

    expect(after.accounts.map((a) => a.id)).toEqual(["c1"]);
    expect(after.recurring).toEqual([]);
    expect(after.oneoffs).toEqual([]);
    expect(after.actuals).toEqual([]);
  });

  it("振替先に指定されている口座も消える対象になる", () => {
    const data = addRecurring(base(), {
      ...rent,
      id: "tr",
      type: "transfer",
      categoryCode: "TRF-01",
      costType: null,
      accountId: "c1",
      toAccountId: "a1",
    });

    expect(removeAccount(data, "a1").recurring).toEqual([]);
  });

  it("引落元だった口座を消すと、カードの設定から外れる", () => {
    const after = removeAccount(base(), "a1");
    const remaining = after.accounts[0];

    expect(remaining.kind).toBe("card");
    expect(remaining.kind === "card" && remaining.settleAccountId).toBe("");
  });

  it("残った口座と実績が壊れないこと（CL-2 が落ちない）", () => {
    const data = {
      ...base(),
      actuals: [{ ...blankActual("x1", "a1", "2026-04-10"), amount: 5_000 }],
    };
    const after = removeAccount(data, "a1");

    expect(() =>
      buildBalanceSeries(
        {
          accounts: after.accounts,
          asOf: after.asOf,
          forecast: [],
          actuals: after.actuals,
        },
        "2026-04-30",
        TODAY,
      ),
    ).not.toThrow();
  });
});

/* ========================= 定期項目（FR-02） ========================= */

describe("定期項目", () => {
  it("停止しても項目は残る", () => {
    const after = toggleRecurringActive(base(), "rent");

    expect(after.recurring).toHaveLength(1);
    expect(after.recurring[0].active).toBe(false);
    expect(toggleRecurringActive(after, "rent").recurring[0].active).toBe(true);
  });

  it("停止すると予定が展開されなくなる", () => {
    const after = toggleRecurringActive(base(), "rent");
    const forecast = buildForecast(
      { recurring: after.recurring, oneoffs: [], overrides: after.overrides },
      ASOF,
      "2026-12-31",
    );

    expect(forecast).toEqual([]);
  });

  it("削除すると、その項目のオーバーライドも消える", () => {
    const data = setOverride(base(), "r:rent:2026-04-27", { skipped: true });
    const after = removeRecurring(data, "rent");

    expect(after.recurring).toEqual([]);
    expect(after.overrides).toEqual({});
  });

  it("他の項目のオーバーライドは残る", () => {
    const data = setOverride(
      addRecurring(base(), { ...rent, id: "other" }),
      "r:other:2026-04-27",
      { skipped: true },
    );

    expect(removeRecurring(data, "rent").overrides).toEqual({
      "r:other:2026-04-27": { skipped: true },
    });
  });

  it("新規の初期値は事業割合0で、費目の推奨する固定変動になる", () => {
    const item = blankRecurring("new", "a1");

    expect(item.bizRatio).toBe(0);
    expect(item.categoryCode).toBe("EXP-20");
    expect(item.costType).toBe("variable"); // EXP-20 雑費の推奨値
    expect(item.active).toBe(true);
    expect(item.months).toBeNull();
  });

  it("金額と費目を変えられる", () => {
    const after = updateRecurring(base(), "rent", {
      amount: 130_000,
      categoryCode: "EXP-02",
    });

    expect(after.recurring[0]).toMatchObject({
      amount: 130_000,
      categoryCode: "EXP-02",
    });
  });
});

/* ========================= 単発予定（FR-03） ========================= */

describe("単発予定", () => {
  it("追加・更新・削除", () => {
    const added = addOneoff(base(), blankOneoff("o1", "a1", "2026-06-10"));
    expect(added.oneoffs).toHaveLength(1);

    const updated = updateOneoff(added, "o1", { amount: 185_000 });
    expect(updated.oneoffs[0].amount).toBe(185_000);

    expect(removeOneoff(updated, "o1").oneoffs).toEqual([]);
  });

  it("削除すると、そのオーバーライドも消える", () => {
    const data = setOverride(
      addOneoff(base(), blankOneoff("o1", "a1", "2026-06-10")),
      "o:o1",
      { date: "2026-07-01" },
    );

    expect(removeOneoff(data, "o1").overrides).toEqual({});
  });
});

/* ========================= 消し込み（FR-06、AC-03） ========================= */

describe("AC-03 予定を実績で消し込む", () => {
  const KEY = "r:rent:2026-04-27";

  function scenario(withActual: boolean) {
    let data = base();
    const forecast = buildForecast(
      { recurring: data.recurring, oneoffs: [], overrides: data.overrides },
      ASOF,
      "2026-04-30",
    );
    const plan = forecast.find((f) => f.key === KEY)!;

    if (withActual) {
      data = settleAsPlanned(data, { ...plan, amount: 118_000 }, "act1");
    }

    const series = buildBalanceSeries(
      { accounts: data.accounts, asOf: ASOF, forecast, actuals: data.actuals },
      "2026-04-30",
      TODAY,
    );
    const pl = buildPLMatrix({
      forecast,
      actuals: data.actuals.map(actualToEvent),
      year: 2026,
      scope: "all",
    });
    return { data, series, pl };
  }

  it("消し込むとその予定が予測から消える", () => {
    const before = scenario(false);
    const after = scenario(true);

    expect(before.series.unmatchedForecast.map((f) => f.key)).toContain(KEY);
    expect(after.series.unmatchedForecast.map((f) => f.key)).not.toContain(KEY);
  });

  it("実績残高に反映される", () => {
    const after = scenario(true);
    const row = after.series.rows.find((r) => r.date === "2026-04-30")!;

    // 予定の120,000ではなく実績の118,000が引かれる
    expect(row.proj).toBe(1_000_000 - 118_000);
    expect(row.act).toBe(1_000_000 - 118_000);
  });

  it("年月別収支の「予定」列は変化しない", () => {
    const before = scenario(false);
    const after = scenario(true);

    expect(after.pl.plan).toEqual(before.pl.plan);

    const fixed = after.pl.plan.groups.find((g) => g.group === "fixed")!;
    expect(fixed.monthly[3]).toBe(120_000); // 4月
  });

  it("年月別収支の「実績」側には実額が出る", () => {
    const after = scenario(true);
    const fixed = after.pl.actual.groups.find((g) => g.group === "fixed")!;

    expect(fixed.monthly[3]).toBe(118_000);
  });

  it("消し込みを取り消すと予定が戻る", () => {
    const after = scenario(true);
    const reverted = removeActual(after.data, "act1");

    const forecast = buildForecast(
      { recurring: reverted.recurring, oneoffs: [], overrides: reverted.overrides },
      ASOF,
      "2026-04-30",
    );
    const series = buildBalanceSeries(
      { accounts: reverted.accounts, asOf: ASOF, forecast, actuals: reverted.actuals },
      "2026-04-30",
      TODAY,
    );

    expect(series.unmatchedForecast.map((f) => f.key)).toContain(KEY);
    expect(series.rows.at(-1)!.proj).toBe(1_000_000 - 120_000);
  });

  it("キーの無い実績は何も消し込まない", () => {
    const data = addActual(base(), {
      ...blankActual("x1", "a1", "2026-04-10"),
      name: "突発",
      amount: 5_000,
    });

    expect(data.actuals[0].key).toBeNull();
  });
});

/* ========================= オーバーライド（FR-07） ========================= */

describe("オーバーライド", () => {
  const KEY = "r:rent:2026-04-27";

  it("重ねて設定できる", () => {
    const data = setOverride(setOverride(base(), KEY, { date: "2026-05-08" }), KEY, {
      note: "延期",
    });

    expect(data.overrides[KEY]).toEqual({ date: "2026-05-08", note: "延期" });
  });

  it("解除すると消える", () => {
    const data = setOverride(base(), KEY, { skipped: true });

    expect(clearOverride(data, KEY).overrides).toEqual({});
  });

  it("スキップすると予定が展開されない", () => {
    const data = setOverride(base(), KEY, { skipped: true });
    const forecast = buildForecast(
      { recurring: data.recurring, oneoffs: [], overrides: data.overrides },
      ASOF,
      "2026-04-30",
    );

    expect(forecast).toEqual([]);
  });
});
