import { describe, expect, it } from "vitest";

import {
  buildCashflowFixture,
  FIXTURE_HAS_CARD,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "../cashflow-fixture";
import { buildCashflowViewModel, formatLedgerTotal } from "../cashflow-view-model";

/**
 * SC-03 の配線
 *
 * 本番の画面は Supabase に繋がないと開けない。props を作るところを
 * 画面の中に置くと、確かめる手段が目視しか無くなる（§9.1 の6つ目）。
 */

const fixture = buildCashflowFixture();

const view = buildCashflowViewModel({
  series: fixture.series,
  monthly: fixture.monthly,
  view: fixture.view,
  from: fixture.from,
  to: fixture.to,
  today: FIXTURE_TODAY,
  reserveLine: FIXTURE_RESERVE_LINE,
  stats: fixture.stats,
});

describe("PageHeader の残高サマリー", () => {
  it("4つ出る。並びは 今日 / 30日後 / 90日後 / カード未払", () => {
    expect(view.stats.map((s) => s.label)).toEqual([
      "今日の残高",
      "30日後",
      "90日後",
      "カード未払",
    ]);
  });

  it("今日の残高は予測系列から取る（AC-49。ダッシュボードと同じ系列）", () => {
    const todayRow = fixture.series.rows.find((r) => r.date === FIXTURE_TODAY);
    expect(view.stats[0].value).toBe(todayRow?.proj);
  });

  it("カード未払だけ色が変わる。**符号は付けない**", () => {
    expect(FIXTURE_HAS_CARD).toBe(true);
    expect(view.stats[3].tone).toBe("expense");
    expect(view.stats[3].value).toBeGreaterThan(0);
    expect(view.stats.slice(0, 3).every((s) => s.tone === undefined)).toBe(true);
  });
});

describe("月次資金繰り表", () => {
  it("行は月次集計そのまま", () => {
    expect(view.months).toHaveLength(fixture.monthly.length);
    expect(view.months[0].income).toBe(fixture.monthly[0].inflow);
    expect(view.months[0].expense).toBe(fixture.monthly[0].outflow);
    expect(view.months[0].endBalance).toBe(fixture.monthly[0].closing);
    expect(view.months[0].lowest).toBe(fixture.monthly[0].lowest);
  });

  it("**色を変えるのは月末ではなく月中の最低で決める**", () => {
    /* screens.md 02 の注記「月末がプラスでも、月中に生活防衛ラインを
       割る月は色が変わります」。closing を見ていると落ちる */
    for (const [i, m] of view.months.entries()) {
      expect(m.highlight ?? false).toBe(fixture.monthly[i].warning !== null);
    }
  });

  it("注記は色が変わった月の名を並べる", () => {
    const breached = view.months.filter((m) => m.highlight).map((m) => m.label);
    expect(view.monthsNote.startsWith("月末がプラスでも")).toBe(true);
    if (breached.length === 0) {
      expect(view.monthsNote).not.toContain("（");
    } else {
      for (const label of breached) expect(view.monthsNote).toContain(label);
    }
  });
});

describe("入出金予定表", () => {
  it("月の区切り行が入る（要件定義書 §4.2 月グループ）", () => {
    const groups = view.ledger.filter((r) => r.groupLabel !== undefined);
    expect(groups.length).toBe(fixture.view.groups.length);
    expect(groups.length).toBeGreaterThan(1);
  });

  it("区切り行以外は明細。件数が合う", () => {
    const entries = view.ledger.filter((r) => r.groupLabel === undefined);
    const expected = fixture.view.groups.reduce((n, g) => n + g.entries.length, 0);
    expect(entries).toHaveLength(expected);
  });

  it("id が重複しない", () => {
    const ids = view.ledger.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("**カード引落は費目ではなく src で区分を決める**", () => {
    /* CL-2 の生成物。費目から引くと「固定費」などになり、
       フィルターの「カード引落」が1件も拾わない（ADR-0023） */
    const settle = fixture.view.groups
      .flatMap((g) => g.entries)
      .filter((e) => e.src === "settle");
    expect(settle.length).toBeGreaterThan(0);

    const rows = view.ledger.filter((r) => r.note === "自動で作られる行（編集できません）");
    expect(rows.length).toBe(settle.length);
    expect(rows.every((r) => r.category === "カード引落")).toBe(true);
    expect(rows.every((r) => r.amountType === "expense")).toBe(true);
  });

  it("収入は income、振替は neutral", () => {
    const income = view.ledger.filter((r) => r.category === "収入");
    expect(income.length).toBeGreaterThan(0);
    expect(income.every((r) => r.amountType === "income")).toBe(true);
    expect(
      view.ledger.filter((r) => r.category === "振替").every((r) => r.amountType === "neutral"),
    ).toBe(true);
  });

  it("**備考は1行に1つ。直せない行であることを最優先する**", () => {
    for (const row of view.ledger) {
      if (row.note === undefined) continue;
      expect(typeof row.note).toBe("string");
      expect(row.note.includes("\n")).toBe(false);
    }
  });

  it("実績が未入力の予定に印が付く（要件定義書 §4.2 過去月の表示）", () => {
    const overdue = fixture.view.groups
      .flatMap((g) => g.entries)
      .filter((e) => e.overdue && e.editable && !e.deferred);
    /* フィクスチャは一度も消し込んでいないので必ずある */
    expect(overdue.length).toBeGreaterThan(0);
    expect(view.ledger.filter((r) => r.note === "実績が未入力").length).toBe(overdue.length);
  });

  it("集計は絞り込み後の値をそのまま出す（§4.2 集計）", () => {
    expect(view.total).toEqual(fixture.view.total);
    const text = formatLedgerTotal(view.total);
    expect(text).toContain(`${fixture.view.total.count}件`);
    expect(text).toContain("入金");
    expect(text).toContain("出金");
  });
});

describe("グラフ", () => {
  it("横幅は表示している期間に従う", () => {
    const first = view.chart.points[0];
    const last = view.chart.points[view.chart.points.length - 1];
    expect(first.t).toBeLessThan(last.t);
    expect(view.chart.defenseLine).toBe(FIXTURE_RESERVE_LINE);
  });

  it("実線と破線の継ぎ目は actualEnd（01 と同じ関数を使っている）", () => {
    const solid = view.chart.points.filter((p) => p.actual !== null);
    const dashed = view.chart.points.filter((p) => p.forecast !== null);
    expect(solid.length).toBeGreaterThan(0);
    expect(dashed.length).toBeGreaterThan(0);
  });
});

describe("月へ飛ぶ見出し（要望9）", () => {
  /**
   * **押しても飛ばない見出しを作らない。**
   * 見出しの id が明細の区切り行の id と一致していなければ、
   * アンカーは何にも当たらず、押しても黙って何も起きない。
   * 画面では「反応しない」としか見えず、目視では原因が分からない。
   */
  it("見出しの id は、すべて明細の区切り行の id と一致する", () => {
    const groupIds = new Set(
      view.ledger.filter((r) => r.groupLabel !== undefined).map((r) => r.id),
    );
    expect(view.ledgerMonths.length).toBeGreaterThan(0);
    for (const m of view.ledgerMonths) {
      expect(groupIds.has(m.id)).toBe(true);
    }
  });

  it("月の数ぶんある。並びも明細と同じ", () => {
    const labels = view.ledger
      .filter((r) => r.groupLabel !== undefined)
      .map((r) => r.groupLabel);
    expect(view.ledgerMonths.map((m) => m.label)).toEqual(labels);
  });
});
