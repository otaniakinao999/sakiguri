/**
 * FR-65・AC-74 入出金予定表を口座で絞る。資金移動は両端に出す
 *
 * **移動先を落とさないことが肝である。** 落とすと、その口座の明細は
 * **残高だけが上がって理由の行が無い**画面になる ―― AC-71 で留めた
 * 「行が残高を説明する」が崩れる。
 *
 * ## 退化させない（§2.11）
 *
 * **資金移動が0件のデータでは、どう実装しても通る。** フィクスチャには
 * 両端を持つ振替が3件ある（実績2件は向きが逆の組、予定1件）。
 * **在ることを先に測る。**
 *
 * **片側だけを測ると、移動元だけに出す実装と区別が付かない。** 同じ行が
 * 移動元の側と移動先の側の**両方**に、**逆の符号**で出ることを、同じ
 * 実行で測る。
 */

import { describe, expect, it } from "vitest";

import { buildMonthlyCashflow } from "@/core/monthly";
import {
  buildFixtureModel,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { buildLedgerView, type LedgerEntry } from "@/lib/ledger";

const FROM = "2026-09";
const TO = "2026-12";

/** 口座を絞った（または絞らない）明細 */
function ledger(accountId: string | null): LedgerEntry[] {
  const scope = accountId === null ? undefined : new Set([accountId]);
  const { series } = buildFixtureModel(FIXTURE_TODAY, scope);
  const view = buildLedgerView({
    series,
    monthly: buildMonthlyCashflow(series, 0, scope),
    from: FROM,
    to: TO,
    kind: "all",
    status: "all",
    today: FIXTURE_TODAY,
    scope,
  });
  return view.groups.flatMap((g) => g.entries);
}

const nameOf = (rows: LedgerEntry[]) => rows.map((r) => r.name);
const find = (rows: LedgerEntry[], name: string) =>
  rows.filter((r) => r.name === name);

describe("AC-74 口座で行を絞る", () => {
  it("その口座に関わらない行は出ない（在ること・無いこと）", () => {
    const all = ledger(null);
    const cash = ledger("a0");

    /* **在ること。** 現金（a0）を動かす行が出ている */
    expect(nameOf(cash)).toContain("ＡＴＭ　セブン銀行");
    expect(cash.length).toBeGreaterThan(0);

    /* **無いこと。** 銀行（a1）だけの行は出ない */
    expect(nameOf(all)).toContain("事務所家賃");
    expect(nameOf(cash)).not.toContain("事務所家賃");

    /* 絞ると減る ―― 絞っていない実装と区別する */
    expect(cash.length).toBeLessThan(all.length);
  });

  it("絞らなければ従来どおり全部出る", () => {
    const all = ledger(null);
    expect(nameOf(all)).toContain("事務所家賃");
    expect(nameOf(all)).toContain("ＡＴＭ　セブン銀行");
    expect(nameOf(all)).toContain("△△信金へ資金移動");
  });
});

describe("AC-74 資金移動は両端に出る", () => {
  /** 試験データに両端を持つ振替が在ること（§2.11） */
  it("振替が0件ではない", () => {
    const all = ledger(null);
    expect(find(all, "ＡＴＭ　セブン銀行")).toHaveLength(1);
    expect(find(all, "ＡＴＭ　ローソン")).toHaveLength(1);
    expect(find(all, "△△信金へ資金移動")).toHaveLength(1);
  });

  it("同じ行が移動元と移動先の両方に、逆の符号で出る（実績）", () => {
    /* ＡＴＭ　セブン銀行：○○銀行（a1）→ 現金（a0）50,000 */
    const atBank = find(ledger("a1"), "ＡＴＭ　セブン銀行");
    const atCash = find(ledger("a0"), "ＡＴＭ　セブン銀行");

    expect(atBank).toHaveLength(1);
    expect(atCash).toHaveLength(1);
    /* **移動元は負、移動先は正**（AC-58b。符号は範囲で決まる） */
    expect(atBank[0].delta).toBe(-50_000);
    expect(atCash[0].delta).toBe(50_000);
  });

  it("向きが逆の組も、それぞれ逆に出る", () => {
    /* ＡＴＭ　ローソン：現金（a0）→ ○○銀行（a1）23,000。
       **2026-11-12 に 46,000円 ずれた形である** ―― 向きが逆の2件が
       同じ名前で並ぶので、符号が逆に出ることが見分けの頼りになる */
    const atBank = find(ledger("a1"), "ＡＴＭ　ローソン");
    const atCash = find(ledger("a0"), "ＡＴＭ　ローソン");

    expect(atBank[0].delta).toBe(23_000);
    expect(atCash[0].delta).toBe(-23_000);
  });

  it("予定の資金移動も、移動先に出る", () => {
    /* △△信金へ資金移動：○○銀行（a1）→ △△信金（a2）200,000。
       **移動先を落とすと、a2 の残高だけが 200,000 上がって理由の行が
       無い画面になる**（AC-71） */
    const atTo = find(ledger("a2"), "△△信金へ資金移動");
    const atFrom = find(ledger("a1"), "△△信金へ資金移動");

    expect(atTo).toHaveLength(1);
    expect(atTo[0].delta).toBe(200_000);
    expect(atTo[0].status).toBe("plan");
    expect(atFrom[0].delta).toBe(-200_000);
  });

  it("合計の範囲では、閉じる振替の符号が付かない（AC-58b）", () => {
    /* **絞ったときに符号が付くことと、合計のときに付かないことを同じ
       実行で測る。** 片方だけだと「どの範囲でも符号を付ける実装」と
       区別が付かない */
    const all = ledger(null);
    expect(find(all, "ＡＴＭ　セブン銀行")[0].delta).toBe(0);
    expect(find(all, "△△信金へ資金移動")[0].delta).toBe(0);
  });
});

describe("AC-74 行が残高を説明する（AC-71 と同じ考え）", () => {
  it("その日の最後の行の残高が、その日の終値に着地する", () => {
    for (const accountId of ["a0", "a1", "a2"]) {
      const scope = new Set([accountId]);
      const { series } = buildFixtureModel(FIXTURE_TODAY, scope);
      const rows = buildLedgerView({
        series,
        monthly: buildMonthlyCashflow(series, 0, scope),
        from: FROM,
        to: TO,
        kind: "all",
        status: "all",
        today: FIXTURE_TODAY,
        scope,
      }).groups.flatMap((g) => g.entries);

      /* **在ることを先に。** 行が0件なら下のループは何も測らない */
      expect(rows.length).toBeGreaterThan(0);

      const last = new Map<string, number>();
      for (const row of rows) last.set(row.date, row.balance);
      for (const [date, balance] of last) {
        const closing = series.rows.find((r) => r.date === date)!.proj;
        expect({ accountId, date, balance }).toEqual({
          accountId,
          date,
          balance: closing,
        });
      }
    }
  });
});
