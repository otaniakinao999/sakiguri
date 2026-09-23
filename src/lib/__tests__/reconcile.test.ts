import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import type { Actual, DepositAccount, RecurringItem } from "@/core/types";

import { emptyAppData, type AppData } from "../app-data";
import { linkActualToPlan } from "../mutations";
import { findDoubleCounts, isDoubleCountCandidate } from "../reconcile";

/**
 * FR-46 / AC-30。
 *
 * `key` を持たない実績は CL-3 の消し込み（手順2）に掛からないため、同じ取引が
 * 予定と実績の両方で残高に乗る。残高が低く出ると防衛ラインの警告が誤って鳴り、
 * PoC の指標「残高警告からの操作率」が測れなくなる。
 */

/* ========================= 素材 ========================= */

const ASOF = "2026-04-01";
const TODAY = "2026-04-20";
const TO = "2026-04-30";

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

const rent: RecurringItem = {
  id: "rent",
  name: "家賃",
  type: "expense",
  costType: "fixed",
  categoryCode: "EXP-01",
  amount: 120_000,
  bizRatio: 0,
  accountId: "a1",
  day: 5,
  months: null,
  active: true,
};

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

function base(actuals: Actual[], recurring: RecurringItem[] = [rent]): AppData {
  return {
    ...emptyAppData(ASOF),
    accounts: [seikatsu, jigyou],
    recurring,
    actuals,
  };
}

function series(data: AppData) {
  const forecast = buildForecast(
    { recurring: data.recurring, oneoffs: data.oneoffs, overrides: data.overrides },
    ASOF,
    TO,
  );
  return buildBalanceSeries(
    { accounts: data.accounts, asOf: ASOF, forecast, actuals: data.actuals },
    TO,
    TODAY,
  );
}

/** 開始残高。生活口座 1,000,000 ＋ 事業口座 500,000 */
const OPENING = 1_500_000;

const closing = (data: AppData) => series(data).rows.at(-1)!.proj;

const found = (data: AppData) =>
  findDoubleCounts({
    actuals: data.actuals,
    unmatchedForecast: series(data).unmatchedForecast,
  });

/* ========================= 二重計上そのもの ========================= */

describe("AC-30 二重計上が起きること自体", () => {
  it("key が無いと予定と実績の両方が残高に乗る", () => {
    const data = base([actual({ id: "x1", amount: 118_000 })]);

    /* 開始 1,500,000 − 120,000（予定）− 118,000（実績）= 1,262,000 */
    expect(closing(data)).toBe(OPENING - 120_000 - 118_000);
  });

  it("key があれば実績だけが乗る", () => {
    const data = base([
      actual({ id: "x1", amount: 118_000, key: "r:rent:2026-04-05" }),
    ]);

    /* 予定は消え、実績だけが乗る */
    expect(closing(data)).toBe(OPENING - 118_000);
  });
});

/* ========================= 候補の抽出 ========================= */

describe("AC-30 候補の抽出", () => {
  it("金額・向き・口座が一致し、日付が12日以内なら候補になる", () => {
    const got = found(base([actual({ id: "x1", date: "2026-04-10" })]));

    expect(got).toHaveLength(1);
    expect(got[0].actual.id).toBe("x1");
    expect(got[0].plan.key).toBe("r:rent:2026-04-05");
    expect(got[0].dayGap).toBe(5);
  });

  it("日付がちょうど12日差なら候補になる", () => {
    expect(found(base([actual({ id: "x1", date: "2026-04-17" })]))).toHaveLength(1);
  });

  it("13日差なら候補にしない", () => {
    expect(found(base([actual({ id: "x1", date: "2026-04-18" })]))).toHaveLength(0);
  });

  it("金額が1円でも違えば候補にしない", () => {
    /* 金額の近さで当てると、利用者が気づけない誤りが残高に混ざる */
    expect(found(base([actual({ id: "x1", amount: 119_999 })]))).toHaveLength(0);
  });

  it("口座が違えば候補にしない", () => {
    /* CL-7 には無い条件。同額の取引が別口座で入れ替わって当たるのを防ぐ */
    expect(found(base([actual({ id: "x1", accountId: "a2" })]))).toHaveLength(0);
  });

  it("収支の向きが違えば候補にしない", () => {
    const got = found(
      base([actual({ id: "x1", type: "income", categoryCode: "INC-01", costType: null })]),
    );

    expect(got).toHaveLength(0);
  });

  it("既に key を持つ実績は対象にしない", () => {
    const got = found(base([actual({ id: "x1", key: "r:rent:2026-04-05" })]));

    expect(got).toHaveLength(0);
  });

  it("1つの予定に当たる実績は1件だけ", () => {
    const got = found(
      base([
        actual({ id: "x1", date: "2026-04-05" }),
        actual({ id: "x2", date: "2026-04-06" }),
      ]),
    );

    expect(got).toHaveLength(1);
  });

  it("候補が無ければ空", () => {
    expect(found(base([], []))).toEqual([]);
    expect(found(base([actual({ id: "x1", amount: 3_000 })]))).toEqual([]);
  });
});

/* ========================= 自動では消し込まない ========================= */

describe("AC-30 自動では消し込まない", () => {
  it("候補を見つけても残高は変わらない", () => {
    const data = base([actual({ id: "x1", amount: 120_000 })]);

    expect(found(data)).toHaveLength(1);
    /* 候補があっても二重計上のまま。確定するまで勝手に消さない */
    expect(closing(data)).toBe(OPENING - 120_000 - 120_000);
  });

  it("確定すると二重計上が解消する", () => {
    const before = base([actual({ id: "x1", amount: 120_000 })]);
    const [candidate] = found(before);

    const after = linkActualToPlan(before, candidate.actual.id, candidate.plan.key);

    expect(after.actuals[0].key).toBe("r:rent:2026-04-05");
    expect(closing(after)).toBe(OPENING - 120_000);
    expect(found(after)).toEqual([]);
  });

  it("確定しても実績の中身は変わらない", () => {
    const before = base([actual({ id: "x1", amount: 120_000, name: "四月家賃" })]);
    const after = linkActualToPlan(before, "x1", "r:rent:2026-04-05");

    expect(after.actuals[0]).toEqual({
      ...before.actuals[0],
      key: "r:rent:2026-04-05",
    });
  });

  it("他の実績には触らない", () => {
    const before = base([
      actual({ id: "x1", amount: 120_000 }),
      actual({ id: "x2", amount: 3_000, date: "2026-04-11", name: "スーパー" }),
    ]);
    const after = linkActualToPlan(before, "x1", "r:rent:2026-04-05");

    expect(after.actuals[1]).toEqual(before.actuals[1]);
  });

  it("元のデータを書き換えない", () => {
    const data = base([actual({ id: "x1" })]);
    const snapshot = structuredClone(data);

    linkActualToPlan(data, "x1", "r:rent:2026-04-05");

    expect(data).toEqual(snapshot);
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ順序で返る", () => {
    const data = base([
      actual({ id: "x2", date: "2026-04-06" }),
      actual({ id: "x1", date: "2026-04-05", amount: 3_000 }),
    ]);

    expect(found(data)).toEqual(found(data));
  });

  it("述語は単体でも使える", () => {
    const plan = series(base([])).unmatchedForecast[0];

    expect(isDoubleCountCandidate(actual({ id: "x1" }), plan)).toBe(true);
    expect(
      isDoubleCountCandidate(actual({ id: "x1", key: "k" }), plan),
    ).toBe(false);
  });
});
