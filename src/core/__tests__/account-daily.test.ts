/**
 * AC-71 口座を選ぶと、日ごとの増減と残高が出ること（FR-64）
 *
 * **出納帳と1日ずつ突き合わせるための表である。** 2026-11-12 に
 * 46,000円 ずれたとき、どの日でずれたのかを画面から辿る手段が無かった。
 *
 * ## 留め具（AC-71）
 *
 * **期間の増減の合計が「期末残高 − 期首残高」と一致すること。**
 * 一致しない実装は、どこかの行を二重に数えているか落としている。
 *
 * **増減と残高を別々に出すから、この条項が効く。** 残高の差から増減を
 * 引くと合計は必ず一致し、**どんな実装でも通る**（CLAUDE.md §2.11 の
 * 4つ目の形）。
 *
 * ## 退化させない（§2.11）
 *
 * - **行が0件の口座で測らない。** 増減も合計も0で必ず通る（3つ目の形）
 * - **資金移動の入る日と出る日を両方入れる。** 片方だけだと、向きを
 *   取り違えた実装でも合計が合ってしまう場合がある
 * - **額を相殺させない。** +50,000 と −23,000 で合計 +27,000（1つ目の形）
 */

import { describe, expect, it } from "vitest";

import { buildAccountDaily } from "../account-daily";
import { buildBalanceSeries, type BalanceSeries } from "../balance";
import type { Account, Actual, DateStr } from "../types";

const CASH = "cash";
const BANK = "bank";
const CARD = "card";

const ACCOUNTS: Account[] = [
  { id: CASH, name: "現金", kind: "cash", balance: 52_000 },
  { id: BANK, name: "○○銀行", kind: "bank", balance: 1_000_000 },
  {
    id: CARD,
    name: "××カード",
    kind: "card",
    balance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 10,
    settleAccountId: BANK,
  },
];

const ASOF: DateStr = "2026-10-01";
const END: DateStr = "2026-10-31";

const actual = (over: Partial<Actual> & Pick<Actual, "id" | "date">): Actual => ({
  key: null,
  unplanned: true,
  name: "行",
  type: "expense",
  costType: "variable",
  categoryCode: "EXP-09",
  amount: 1_000,
  bizRatio: 100,
  accountId: CASH,
  ...over,
});

/**
 * 現金が動く5日ぶん。**入る日と出る日の両方**を入れてある。
 *
 * | 日 | 何 | 現金 |
 * |---|---|---|
 * | 10/03 | 売上の現金受け | +80,000 |
 * | 10/14 | 銀行から引出し（振替） | +50,000 |
 * | 10/18 | 消耗品（2件） | −3,500 |
 * | 10/23 | 銀行へ預け入れ（振替） | −23,000 |
 * | 10/28 | 振替先が未設定（**残高は動かない**） | 0 |
 */
const ACTUALS: Actual[] = [
  actual({ id: "a", date: "2026-10-03", name: "現金売上", type: "income", costType: null, categoryCode: "INC-01", amount: 80_000 }),
  actual({ id: "b", date: "2026-10-14", name: "ＡＴＭ　引出し", type: "transfer", costType: null, categoryCode: "TRF-01", amount: 50_000, accountId: BANK, toAccountId: CASH }),
  actual({ id: "c", date: "2026-10-18", name: "コピー用紙", amount: 1_200 }),
  actual({ id: "d", date: "2026-10-18", name: "文具", amount: 2_300 }),
  actual({ id: "e", date: "2026-10-23", name: "ＡＴＭ　預け入れ", type: "transfer", costType: null, categoryCode: "TRF-01", amount: 23_000, accountId: CASH, toAccountId: BANK }),
  actual({ id: "f", date: "2026-10-28", name: "振替先を入れ忘れた行", type: "transfer", costType: null, categoryCode: "TRF-01", amount: 9_000, accountId: CASH }),
  /* 銀行だけを動かす行。**現金の表に出てはいけない** */
  actual({ id: "g", date: "2026-10-20", name: "家賃", amount: 95_000, costType: "fixed", categoryCode: "EXP-01", accountId: BANK }),
];

const series = buildBalanceSeries(
  { accounts: ACCOUNTS, asOf: ASOF, forecast: [], actuals: ACTUALS },
  END,
  END,
);

const daily = (accountId: string, from = ASOF, to = END) =>
  buildAccountDaily({ series, accounts: ACCOUNTS, accountId, from, to });

/* ========================= 日ごとの増減と残高 ========================= */

describe("AC-71 日ごとの増減と残高", () => {
  const got = daily(CASH);

  it("測る対象がある（行が0件の口座ではない）", () => {
    /* **0件だと、下のどの条項も何も確かめない**（§2.11 の3つ目の形） */
    expect(got.rows.length).toBeGreaterThan(0);
    /* 入る日と出る日の両方がある */
    expect(got.rows.some((r) => r.delta > 0)).toBe(true);
    expect(got.rows.some((r) => r.delta < 0)).toBe(true);
    /* 相殺して0になっていない */
    expect(got.total).not.toBe(0);
  });

  it("動いた日だけが、日付の順に出る", () => {
    expect(got.rows.map((r) => r.date)).toEqual([
      "2026-10-03",
      "2026-10-14",
      "2026-10-18",
      "2026-10-23",
      "2026-10-28",
    ]);
  });

  it("その日の増減が出る（同じ日の2件は足される）", () => {
    const byDate = new Map(got.rows.map((r) => [r.date, r]));
    expect(byDate.get("2026-10-03")!.delta).toBe(80_000);
    /* 振替で入ってくる側は + */
    expect(byDate.get("2026-10-14")!.delta).toBe(50_000);
    /* 同じ日の2件（1,200 + 2,300） */
    expect(byDate.get("2026-10-18")!.delta).toBe(-3_500);
    expect(byDate.get("2026-10-18")!.count).toBe(2);
    /* 振替で出ていく側は − */
    expect(byDate.get("2026-10-23")!.delta).toBe(-23_000);
  });

  it("その日の残高が出る（期首からの積み上げ）", () => {
    const byDate = new Map(got.rows.map((r) => [r.date, r.balance]));
    expect(got.opening).toBe(52_000);
    expect(byDate.get("2026-10-03")).toBe(132_000);
    expect(byDate.get("2026-10-14")).toBe(182_000);
    expect(byDate.get("2026-10-18")).toBe(178_500);
    expect(byDate.get("2026-10-23")).toBe(155_500);
    expect(got.closing).toBe(155_500);
  });

  it("**残高に反映しない振替も行として出る**（増減は0）", () => {
    /* 振替先が未設定の行。明細には在るのに残高が動かない。
       **件数が無いと「この日は何も無い」と読まれる** */
    const row = got.rows.find((r) => r.date === "2026-10-28")!;
    expect(row.delta).toBe(0);
    expect(row.count).toBe(1);
    expect(row.balance).toBe(155_500);
  });

  it("ほかの口座の行は出ない", () => {
    /* 10/20 の家賃は銀行だけを動かす */
    expect(got.rows.some((r) => r.date === "2026-10-20")).toBe(false);
    /* **銀行の側には出ている。** 片方だけ見ると「全部落とす実装」と
       区別が付かない */
    const bank = daily(BANK);
    expect(bank.rows.find((r) => r.date === "2026-10-20")!.delta).toBe(-95_000);
    /* 振替は両方の口座に出る（向きが逆） */
    expect(bank.rows.find((r) => r.date === "2026-10-14")!.delta).toBe(-50_000);
    expect(bank.rows.find((r) => r.date === "2026-10-23")!.delta).toBe(23_000);
  });
});

/* ========================= AC-71 の留め具 ========================= */

describe("AC-71 増減の合計 ＝ 期末残高 − 期首残高", () => {
  it("現金でも銀行でも一致する", () => {
    for (const id of [CASH, BANK]) {
      const got = daily(id);
      expect(got.rows.length).toBeGreaterThan(0);
      expect(got.total).toBe(got.closing - got.opening);
      expect(got.gap).toBe(0);
    }
  });

  it("期間を途中で切っても一致する（期首が基準日でない）", () => {
    const got = daily(CASH, "2026-10-15", "2026-10-25");
    /* 10/18 と 10/23 だけが入る */
    expect(got.rows.map((r) => r.date)).toEqual(["2026-10-18", "2026-10-23"]);
    /* 期首は 10/14 の終値 */
    expect(got.opening).toBe(182_000);
    expect(got.closing).toBe(155_500);
    expect(got.total).toBe(-26_500);
    expect(got.gap).toBe(0);
  });

  it("1日も動かない期間でも一致する（増減0・残高はそのまま）", () => {
    const got = daily(CASH, "2026-10-05", "2026-10-10");
    expect(got.rows).toEqual([]);
    expect(got.opening).toBe(132_000);
    expect(got.closing).toBe(132_000);
    expect(got.gap).toBe(0);
  });

  /**
   * **「一致する」だけを測ると、`gap` を常に0にする実装でも通る。**
   *
   * 同じ実行で、**一致しない状態も作って測る。** 系列の残高を1日ぶん
   * ずらす ―― 実装がどこかの行を落としたときに起きることである。
   */
  it("一致しなければ `gap` に出る（黙って合わせない）", () => {
    const broken: BalanceSeries = {
      ...series,
      rows: series.rows.map((row) =>
        row.date >= "2026-10-23"
          ? { ...row, byAccount: { ...row.byAccount, [CASH]: row.byAccount[CASH] - 7 } }
          : row,
      ),
    };
    const got = buildAccountDaily({
      series: broken,
      accounts: ACCOUNTS,
      accountId: CASH,
      from: ASOF,
      to: END,
    });
    expect(got.gap).toBe(7);
    expect(got.total).not.toBe(got.closing - got.opening);
  });
});

/* ========================= 予定の件数 ========================= */

describe("AC-71 まだ実績が入っていない予定を数える", () => {
  /**
   * **出納帳には予定の行が無い。** 残高は予測系列から取る（AC-49a）ので、
   * 未記録の予定があるとその日から先は出納帳と食い違う。**理由が
   * 分かるように件数を出す。**
   */
  it("予定の件数が出る。実績だけの日は0", () => {
    const withPlan = buildBalanceSeries(
      {
        accounts: ACCOUNTS,
        asOf: ASOF,
        forecast: [
          {
            key: "r1:2026-10-25",
            date: "2026-10-25",
            name: "現金で払う予定",
            type: "expense",
            costType: "variable",
            categoryCode: "EXP-09",
            amount: 4_000,
            bizRatio: 100,
            accountId: CASH,
            src: "recurring",
            srcId: "r1",
          },
        ],
        actuals: ACTUALS,
      },
      END,
      END,
    );
    const got = buildAccountDaily({
      series: withPlan,
      accounts: ACCOUNTS,
      accountId: CASH,
      from: ASOF,
      to: END,
    });
    const byDate = new Map(got.rows.map((r) => [r.date, r]));

    expect(byDate.get("2026-10-25")).toMatchObject({
      delta: -4_000,
      count: 1,
      planCount: 1,
    });
    /* **同じ実行で、実績だけの日も見る。** 片方だけだと全部を予定と
       数える実装でも通る */
    expect(byDate.get("2026-10-18")).toMatchObject({ count: 2, planCount: 0 });

    /* 予定を入れても留め具は保たれる */
    expect(got.gap).toBe(0);
  });
});
