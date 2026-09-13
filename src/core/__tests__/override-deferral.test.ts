/**
 * オーバーライド（支払繰延）の通し検証
 *
 * 対応する機能要件：FR-07（日付変更・金額変更・当回スキップ）
 * 対応する受入基準：AC-04
 *
 * オーバーライドの適用そのものは CL-1（forecast.ts）で実装済みで、
 * 単体の挙動は forecast.test.ts で検証してある。
 * ここで確かめるのは、繰延がモジュールをまたいで一貫していること。
 *
 * 要点は **資金繰りと損益で日付の意味が違う**こと。
 *   CL-3 / CL-6（資金繰り）は現金が動く日で数える
 *   CL-5（年月別収支）は発生日で数える
 * 繰延は発生日そのものを動かすので、両方が動く。ただし動き方が違う。
 */

import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "../balance";
import { buildForecast, type ForecastInput } from "../forecast";
import { buildMonthlyCashflow } from "../monthly";
import { buildPLMatrix, type PLGroup, type PLSide } from "../pl";
import type { DepositAccount, Overrides } from "../types";

const seikatsu: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 1_000_000,
};

/** 毎月27日に120,000円の家賃。2026年ぶん */
const rentInput: ForecastInput = {
  recurring: [
    {
      id: "rh1",
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
    },
  ],
  oneoffs: [],
};

const FROM = "2026-01-01";
const TO = "2026-12-31";

/** 繰延あり・なしで CL-1 → CL-3 → CL-5 → CL-6 を通す */
function run(overrides?: Overrides) {
  const forecast = buildForecast({ ...rentInput, overrides }, FROM, TO);
  const series = buildBalanceSeries(
    { accounts: [seikatsu], asOf: FROM, forecast, actuals: [] },
    TO,
    FROM,
  );
  return {
    forecast,
    series,
    monthly: buildMonthlyCashflow(series, 0),
    pl: buildPLMatrix({ forecast, actuals: [], year: 2026, scope: "all" }),
  };
}

/** 年月別収支の、あるグループの月別（1月〜12月） */
const monthlyOf = (side: PLSide, group: PLGroup) =>
  side.groups.find((g) => g.group === group)!.monthly;

const balanceAt = (
  series: ReturnType<typeof buildBalanceSeries>,
  date: string,
) => series.rows.find((r) => r.date === date)!.proj;

const closingOf = (rows: ReturnType<typeof buildMonthlyCashflow>, ym: string) =>
  rows.find((r) => r.yearMonth === ym)!.closing;

/* ========================= AC-04 ========================= */

describe("AC-04 予定の日付を翌月にずらす", () => {
  /* 4/27 の家賃を 5/8 に繰り延べる */
  const deferred: Overrides = {
    "r:rh1:2026-04-27": { date: "2026-05-08", note: "資金繰りの都合で延期" },
  };

  it("資金繰りの残高推移が変わる", () => {
    const before = run();
    const after = run(deferred);

    // 4/27 時点：繰延前は引かれているが、繰延後はまだ引かれていない
    expect(balanceAt(before.series, "2026-04-27")).toBe(
      balanceAt(after.series, "2026-04-27") - 120_000,
    );

    // 4月末残高が120,000円ぶん高くなる
    expect(closingOf(after.monthly, "2026-04")).toBe(
      closingOf(before.monthly, "2026-04") + 120_000,
    );

    // 5/8 に引かれたあとは元に戻る
    expect(balanceAt(after.series, "2026-05-08")).toBe(
      balanceAt(before.series, "2026-05-08"),
    );
    expect(closingOf(after.monthly, "2026-05")).toBe(
      closingOf(before.monthly, "2026-05"),
    );
  });

  it("月次資金繰り表の出金が翌月へ移る", () => {
    const before = run();
    const after = run(deferred);

    const april = (rows: ReturnType<typeof buildMonthlyCashflow>) =>
      rows.find((r) => r.yearMonth === "2026-04")!;
    const may = (rows: ReturnType<typeof buildMonthlyCashflow>) =>
      rows.find((r) => r.yearMonth === "2026-05")!;

    expect(april(before.monthly).outflow).toBe(120_000);
    expect(may(before.monthly).outflow).toBe(120_000);

    expect(april(after.monthly).outflow).toBe(0);
    expect(may(after.monthly).outflow).toBe(240_000);
  });

  it("年月別収支の該当月の予定額も移動する", () => {
    const before = run();
    const after = run(deferred);

    const beforeFixed = monthlyOf(before.pl.plan, "fixed");
    const afterFixed = monthlyOf(after.pl.plan, "fixed");

    // 繰延前：毎月120,000円
    expect(beforeFixed).toEqual(new Array(12).fill(120_000));

    // 繰延後：4月が0、5月が240,000円。他の月は変わらない
    expect(afterFixed[3]).toBe(0);
    expect(afterFixed[4]).toBe(240_000);
    expect(afterFixed[5]).toBe(120_000);

    // 年計は変わらない。予定が消えたわけではなく移動しただけ
    const yearTotal = (m: number[]) => m.reduce((a, b) => a + b, 0);
    expect(yearTotal(afterFixed)).toBe(yearTotal(beforeFixed));
  });

  it("繰延しても予定インスタンスのキーは変わらない", () => {
    const after = run(deferred);
    const moved = after.forecast.find((f) => f.date === "2026-05-08");

    expect(moved?.key).toBe("r:rh1:2026-04-27");
    expect(moved?.origDate).toBe("2026-04-27");
    expect(moved?.override?.note).toBe("資金繰りの都合で延期");
  });

  it("同じ月の中で日付を動かしても月次の集計は変わらない", () => {
    const withinMonth = run({ "r:rh1:2026-04-27": { date: "2026-04-05" } });
    const before = run();

    expect(closingOf(withinMonth.monthly, "2026-04")).toBe(
      closingOf(before.monthly, "2026-04"),
    );
    expect(monthlyOf(withinMonth.pl.plan, "fixed")[3]).toBe(120_000);

    // 日次では動いている
    expect(balanceAt(withinMonth.series, "2026-04-05")).toBe(
      balanceAt(before.series, "2026-04-05") - 120_000,
    );
  });
});

/* ========================= FR-07 のほかの操作 ========================= */

describe("FR-07 金額変更と当回スキップ", () => {
  it("金額を変えると資金繰りと年月別収支の両方に効く", () => {
    const before = run();
    const after = run({ "r:rh1:2026-04-27": { amount: 100_000 } });

    expect(closingOf(after.monthly, "2026-04")).toBe(
      closingOf(before.monthly, "2026-04") + 20_000,
    );
    expect(monthlyOf(after.pl.plan, "fixed")[3]).toBe(100_000);
  });

  it("当回スキップはその月の予定を消す", () => {
    const after = run({ "r:rh1:2026-04-27": { skipped: true } });

    expect(after.forecast.some((f) => f.key === "r:rh1:2026-04-27")).toBe(false);

    const fixed = monthlyOf(after.pl.plan, "fixed");
    expect(fixed[3]).toBe(0);
    expect(fixed[4]).toBe(120_000);

    // 年計は1回ぶん減る
    expect(fixed.reduce((a, b) => a + b, 0)).toBe(120_000 * 11);
  });

  it("スキップは定期項目そのものを止めない", () => {
    const after = run({ "r:rh1:2026-04-27": { skipped: true } });

    expect(after.forecast).toHaveLength(11);
    expect(after.forecast.map((f) => f.date.slice(0, 7))).not.toContain("2026-04");
  });

  it("繰延を解除すると元に戻る", () => {
    const before = run();
    const reverted = run({});

    expect(reverted.forecast).toEqual(before.forecast);
    expect(reverted.monthly).toEqual(before.monthly);
    expect(reverted.pl).toEqual(before.pl);
  });
});

/* ========================= 資金繰りと損益の日付の違い ========================= */

describe("繰延で資金繰りと損益がずれる場合", () => {
  /* カード払いの支出を繰り延べると、発生日（CL-5）は動いた日、
     現金が動く日（CL-3・CL-6）は新しい発生日から計算し直した引落日になる。
     ずれ方が違うことを固定しておく。 */

  it("カード払いの繰延は損益と資金繰りで移動幅が違う", () => {
    const card = {
      id: "c1",
      name: "メインカード",
      kind: "card" as const,
      balance: 0,
      closingDay: 15,
      payMonthOffset: 1,
      payDay: 10,
      settleAccountId: "a1",
    };
    const base: ForecastInput = {
      recurring: [],
      oneoffs: [
        {
          id: "o1",
          date: "2026-04-10",
          name: "備品",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-07",
          amount: 50_000,
          bizRatio: 100,
          accountId: "c1",
        },
      ],
    };

    const runCard = (overrides?: Overrides) => {
      const forecast = buildForecast({ ...base, overrides }, FROM, TO);
      const series = buildBalanceSeries(
        { accounts: [seikatsu, card], asOf: FROM, forecast, actuals: [] },
        TO,
        FROM,
      );
      return {
        monthly: buildMonthlyCashflow(series, 0),
        pl: buildPLMatrix({ forecast, actuals: [], year: 2026, scope: "all" }),
      };
    };

    // 4/10 利用（10 <= 15 で4月締め）→ 5/10 引落
    const before = runCard();
    expect(monthlyOf(before.pl.plan, "variable")[3]).toBe(50_000); // 損益は4月
    expect(
      before.monthly.find((r) => r.yearMonth === "2026-05")!.outflow,
    ).toBe(50_000); // 現金は5月

    // 4/20 に繰延（20 > 15 で5月締め）→ 6/10 引落
    const after = runCard({ "o:o1": { date: "2026-04-20" } });
    expect(monthlyOf(after.pl.plan, "variable")[3]).toBe(50_000); // 損益は4月のまま
    expect(after.monthly.find((r) => r.yearMonth === "2026-05")!.outflow).toBe(0);
    expect(after.monthly.find((r) => r.yearMonth === "2026-06")!.outflow).toBe(
      50_000,
    ); // 現金は6月へ

    // 損益の月は動かないのに、現金の月は1ヶ月動く
  });
});
