/**
 * AC-70 資金移動の向きが、画面の行から読めること（FR-63・制約11）
 *
 * **2026-11-12、利用者の現金残高が出納帳と 46,000円 ずれた。** 原因は
 * 1行で、「ＡＴＭ　ローソン」23,000円 が**銀行→現金**として入っていた
 * （実際は現金→銀行の預け入れ）。同じ期間の資金移動18件のうち17件は
 * 本当に引出しで、名前も同じ「ＡＴＭ　…」で並ぶ。
 *
 * ## 符号では足りない（AC-70 の条項）
 *
 * **同じ実行で両方を測る。**
 *
 * | 見ている範囲 | 符号 | 向き |
 * |---|---|---|
 * | 口座を絞る | 付く（AC-58b） | 出る |
 * | 合計 | **付かない**（閉じる振替の delta が0） | 出る |
 *
 * 片方だけだと、**「符号で代用している実装」**（絞ったときだけ測ると
 * 通る）とも**「全部の行に向きを出す実装」**（向きの有る行だけ測ると
 * 通る）とも区別が付かない。
 *
 * ## 画面を列挙する（CLAUDE.md §2.12）
 *
 * 向きは4箇所の行に出る。**直した画面だけを確認するのでは足りない** ――
 * 利用者が見ていたのは、こちらが最初に直そうとした画面ではなかった。
 */

import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { NO_DESTINATION } from "@/core/transfer-direction";
import type { Account, Actual, ForecastInstance } from "@/core/types";
import {
  buildCashflowFixture,
  FIXTURE_ACCOUNTS,
  FIXTURE_TODAY,
} from "@/components/cashflow/cashflow-fixture";
import { buildCashflowViewModel } from "@/components/cashflow/cashflow-view-model";
import {
  buildFixtureModel,
  FIXTURE_ACTUALS,
  FIXTURE_RESERVE_LINE,
} from "@/components/dashboard/dashboard-fixture";
import { buildDashboardViewModel } from "@/components/dashboard/dashboard-view-model";
import {
  buildEntryActualRows,
  buildEntryTodoRows,
  entryAmountScope,
} from "@/components/entry/entry-view-model";
import { buildLedgerView } from "@/lib/ledger";
import { buildMonthlyCashflow } from "@/core/monthly";

/* フィクスチャの2件（dashboard-fixture）。
   **向きが逆の組である。** 合計の範囲ではどちらも符号を失う */
const WITHDRAW = "ＡＴＭ　セブン銀行"; /* a1 ○○銀行 → a0 現金。10/14 */
const DEPOSIT = "ＡＴＭ　ローソン"; /* a0 現金 → a1 ○○銀行。10/23 */
/* 両側記録の組（`type` は income / expense で費目が TRF）。向きは出ない */
const BOTH_OUT = "△△信金へ移動";
const BOTH_IN = "○○銀行から移動";

/* ======================= 入出金予定表（SC-03） ======================= */

/** 明細の行を名前で引く。`scope` を渡すと口座で絞る */
function ledgerRows(scope?: ReadonlySet<string>) {
  const fixture = buildCashflowFixture(FIXTURE_TODAY, scope);
  const model = buildCashflowViewModel({
    series: fixture.series,
    monthly: fixture.monthly,
    accounts: FIXTURE_ACCOUNTS,
    accountId: null,
    view: fixture.view,
    from: fixture.from,
    to: fixture.to,
    today: FIXTURE_TODAY,
    reserveLine: fixture.reserveLine,
    stats: fixture.stats,
  });
  return new Map(
    model.ledger
      .filter((row) => row.groupLabel === undefined)
      .map((row) => [row.title, row]),
  );
}

describe("AC-70 入出金予定表", () => {
  const CASH = new Set(["a0"]);

  it("合計で見ているとき：**符号は付かないが、向きは出る**", () => {
    const rows = ledgerRows();

    /* 前提：4件とも同じ表に出ている。1件でも欠けると測れない
       （CLAUDE.md §2.11 の3つ目の形） */
    for (const name of [WITHDRAW, DEPOSIT, BOTH_OUT, BOTH_IN]) {
      expect(rows.has(name)).toBe(true);
    }

    /* **符号が付かない。** 閉じる振替なので合計残高を動かさない
       （AC-58b。それ自体は正しい） */
    expect(rows.get(WITHDRAW)!.display.signed).toBe(false);
    expect(rows.get(DEPOSIT)!.display.signed).toBe(false);

    /* **それでも向きが読める。** ここが報告された欠陥 */
    expect(rows.get(WITHDRAW)!.direction).toBe("○○銀行 普通 → 現金");
    expect(rows.get(DEPOSIT)!.direction).toBe("現金 → ○○銀行 普通");
    /* **2件が割れていること。** 同じ値を2回出す実装を落とす */
    expect(rows.get(WITHDRAW)!.direction).not.toBe(rows.get(DEPOSIT)!.direction);
  });

  it("口座で絞ったとき：**符号が付く。向きは変わらない**", () => {
    const rows = ledgerRows(CASH);

    /* 現金から見ると、引出しは入ってきて、預け入れは出ていく */
    expect(rows.get(WITHDRAW)!.display).toMatchObject({
      value: 50_000,
      signed: true,
    });
    expect(rows.get(DEPOSIT)!.display).toMatchObject({
      value: -23_000,
      signed: true,
    });

    /* **向きは範囲によらない。** 範囲で向きが変わる実装（「自分から見た
       出入り」を向きとして出すもの）はここで落ちる */
    expect(rows.get(WITHDRAW)!.direction).toBe("○○銀行 普通 → 現金");
    expect(rows.get(DEPOSIT)!.direction).toBe("現金 → ○○銀行 普通");
  });

  it("両側記録の行には向きが出ない（出る行と出ない行が混ざる）", () => {
    const rows = ledgerRows();

    /* **こちらは符号で向きが読める** ―― 口座を1つしか動かさないので
       合計の範囲でも delta が0にならない（AC-58b） */
    expect(rows.get(BOTH_OUT)!.display).toMatchObject({
      value: -77_777,
      signed: true,
    });
    expect(rows.get(BOTH_IN)!.display).toMatchObject({
      value: 77_777,
      signed: true,
    });
    expect(rows.get(BOTH_OUT)!.direction).toBeUndefined();
    expect(rows.get(BOTH_IN)!.direction).toBeUndefined();

    /* **同じ表の中で、出る行と出ない行が混ざっていること。**
       全部 true / 全部 false のどちらでもない（AC-70 の条項） */
    const shown = [WITHDRAW, DEPOSIT, BOTH_OUT, BOTH_IN].map(
      (name) => rows.get(name)!.direction !== undefined,
    );
    expect(shown).toEqual([true, true, false, false]);
  });

  it("振替でない行にも出ない（家賃・売上入金）", () => {
    const rows = ledgerRows();
    expect(rows.get("事務所家賃")?.direction).toBeUndefined();
    expect(rows.get("○○商会 売上入金")?.direction).toBeUndefined();
  });
});

/* ======================= 実績一覧・やること（SC-05） ======================= */

describe("AC-70 実績一覧とやること", () => {
  const scope = entryAmountScope(FIXTURE_ACCOUNTS);

  it("実績一覧：向きが出る。両側記録には出ない", () => {
    const rows = new Map(
      buildEntryActualRows(FIXTURE_ACTUALS, scope).map((r) => [r.title, r]),
    );
    expect(rows.get(WITHDRAW)!.direction).toBe("○○銀行 普通 → 現金");
    expect(rows.get(DEPOSIT)!.direction).toBe("現金 → ○○銀行 普通");
    expect(rows.get(BOTH_OUT)!.direction).toBeUndefined();

    /* **この画面は口座を絞れない。** 範囲は全口座なので、閉じる振替は
       delta が0になり**符号が付かない**（`entryAmountScope`）。
       つまり**この一覧では向きしか手がかりが無い** ―― 利用者が
       「符号が表示されない」と書いたのはこの状態である。

       **同じ実行で、符号が付く行も見る。** 片方だけだと「符号を全部
       落としている実装」と区別が付かない */
    expect(rows.get(WITHDRAW)!.display.signed).toBe(false);
    expect(rows.get(DEPOSIT)!.display.signed).toBe(false);
    expect(rows.get(BOTH_OUT)!.display).toMatchObject({
      value: -77_777,
      signed: true,
    });
  });

  it("やること：予定の行にも向きが出る", () => {
    const plan: ForecastInstance = {
      key: "r9:2026-10-20",
      date: "2026-10-20",
      name: "信金へ資金移動",
      type: "transfer",
      costType: null,
      categoryCode: "TRF-01",
      amount: 300_000,
      bizRatio: 0,
      accountId: "a1",
      toAccountId: "a2",
      src: "recurring",
      srcId: "r9",
    };
    const rows = buildEntryTodoRows(
      [{ kind: "plan", date: plan.date, rowKey: plan.key, plan }],
      scope,
    );
    expect(rows[0].direction).toBe("○○銀行 普通 → △△信金 普通");
  });

  it("振替先が未設定の予定は、移動元と「未設定」が出る", () => {
    const plan: ForecastInstance = {
      key: "r9:2026-10-21",
      date: "2026-10-21",
      name: "振替先を入れ忘れた行",
      type: "transfer",
      costType: null,
      categoryCode: "TRF-01",
      amount: 10_000,
      bizRatio: 0,
      accountId: "a1",
      src: "recurring",
      srcId: "r9",
    };
    const rows = buildEntryTodoRows(
      [{ kind: "plan", date: plan.date, rowKey: plan.key, plan }],
      scope,
    );
    expect(rows[0].direction).toBe(`○○銀行 普通 → ${NO_DESTINATION}`);
  });
});

/* ======================= ダッシュボード（SC-02） ======================= */

describe("AC-70 ダッシュボードの要対応", () => {
  it("予定の行に向きが出る", () => {
    const model = buildFixtureModel();
    const view = buildDashboardViewModel({
      series: model.series,
      dashboard: model.dashboard,
      accounts: FIXTURE_ACCOUNTS,
      today: FIXTURE_TODAY,
      reserveLine: FIXTURE_RESERVE_LINE,
      range: "90",
    });

    /* **要対応に振替の予定が在ること。** 0件だと、この条項は
       どんな実装でも通る（CLAUDE.md §2.11 の3つ目の形）。
       フィクスチャの単発予定 o2（10/15・○○銀行 → △△信金） */
    const transfer = view.todos.filter((t) => t.direction !== undefined);
    expect(transfer).toHaveLength(1);
    expect(transfer[0].direction).toBe("○○銀行 普通 → △△信金 普通");

    /* **同じ実行で、向きを持たない行も見る** */
    expect(view.todos.some((t) => t.direction === undefined)).toBe(true);
  });
});

/* ======================= 消した口座を参照している行 ======================= */

describe("AC-70 口座が見つからない行", () => {
  /**
   * **向きが出ないほうが危ない。** 読み取り側で落とすと「向きの出ない
   * 振替」ができて、AC-70 が守りたかったものがその行だけ消える。
   */
  it("振替先の口座が無くても、行は向きを持つ", () => {
    const accounts: Account[] = [
      { id: "bank", name: "○○銀行", kind: "bank", balance: 1_000_000 },
    ];
    const actual: Actual = {
      id: "t1",
      key: null,
      unplanned: true,
      name: "消した口座へ",
      type: "transfer",
      costType: null,
      categoryCode: "TRF-01",
      amount: 30_000,
      bizRatio: 0,
      accountId: "bank",
      toAccountId: "gone",
      date: "2026-10-05",
    };
    const series = buildBalanceSeries(
      { accounts, asOf: "2026-10-01", forecast: [], actuals: [actual] },
      "2026-10-31",
      "2026-10-31",
    );
    const monthly = buildMonthlyCashflow(series, 0);
    const model = buildCashflowViewModel({
      series,
      monthly,
      accounts,
      accountId: null,
      view: buildLedgerView({
        series,
        monthly,
        from: "2026-10",
        to: "2026-10",
        kind: "all",
        status: "all",
        today: "2026-10-31",
      }),
      from: "2026-10-01",
      to: "2026-10-31",
      today: "2026-10-31",
      reserveLine: 0,
      stats: [],
    });
    const row = model.ledger.find((r) => r.title === "消した口座へ")!;
    expect(row.direction).toBe("○○銀行 → 不明な口座");
  });
});
