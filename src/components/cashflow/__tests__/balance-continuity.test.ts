import { describe, expect, it } from "vitest";

import { buildCashflowFixture, FIXTURE_TODAY } from "../cashflow-fixture";
import { buildCashflowViewModel } from "../cashflow-view-model";

/**
 * 残高の辻褄
 *
 * **画面に出ている数字どうしが合っているかを押さえる。** 月次表・
 * PageHeader・グラフは別々の経路で作られるので、どれか1つがずれても
 * 目視では気づけない。
 */

const fixture = buildCashflowFixture();
const view = buildCashflowViewModel({
  series: fixture.series,
  monthly: fixture.monthly,
  view: fixture.view,
  from: fixture.from,
  to: fixture.to,
  today: FIXTURE_TODAY,
  reserveLine: 1_500_000,
  stats: fixture.stats,
});

describe("月次資金繰り表", () => {
  it("前月の月末残高 ＋ 入金 − 出金 ＝ 当月の月末残高", () => {
    for (let i = 1; i < view.months.length; i++) {
      const prev = view.months[i - 1];
      const cur = view.months[i];
      expect(prev.endBalance + cur.income - cur.expense).toBe(cur.endBalance);
    }
  });

  it("月中の最低は月末残高以下", () => {
    for (const m of view.months) {
      expect(m.lowest).toBeLessThanOrEqual(m.endBalance);
    }
  });
});

describe("画面どうしの一致", () => {
  it("PageHeader の今日の残高は予測系列の今日の値", () => {
    const todayRow = fixture.series.rows.find((r) => r.date === FIXTURE_TODAY);
    expect(view.stats[0].value).toBe(todayRow?.proj);
  });

  it("**今日の残高は、今日を含む月の月中の最低以上**", () => {
    /* 今日より後にもっと下がる日があっても、今日時点では最低を下回れない */
    const thisMonth = view.months.find((m) => m.label.includes("10月"));
    expect(thisMonth).toBeDefined();
    expect(view.stats[0].value).toBeGreaterThanOrEqual(thisMonth!.lowest);
  });

  it("グラフの最後の予測値は、表示期間の最後の月の月末残高と同じ", () => {
    const last = view.chart.points.at(-1);
    const lastMonth = view.months.at(-1);
    expect(last?.forecast).toBe(lastMonth?.endBalance);
  });
});

describe("残高推移の月次", () => {
  it("**月の最終日ではなく、最後に実績がある日を取る**", () => {
    /* 月末がまだ来ていない月は act が null になり、実績の線が
       1点だけになって描かれない（実際に描かれなかった） */
    const withActual = view.monthlyChart.filter((m) => m.actual !== null);
    expect(withActual.length).toBeGreaterThanOrEqual(2);
  });

  it("月末残高は月次表と同じ値", () => {
    expect(view.monthlyChart.map((m) => m.closing)).toEqual(
      view.months.map((m) => m.endBalance),
    );
  });

  it("出金は正の数で渡す（描画側が下向きにする）", () => {
    expect(view.monthlyChart.every((m) => m.outflow >= 0)).toBe(true);
    expect(view.monthlyChart.every((m) => m.inflow >= 0)).toBe(true);
  });
});
