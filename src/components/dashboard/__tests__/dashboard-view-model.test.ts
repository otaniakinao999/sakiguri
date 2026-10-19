import { describe, expect, it } from "vitest";

import { DASHBOARD_HORIZON_DAYS } from "@/lib/dashboard";

import {
  buildFixtureModel,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "../dashboard-fixture";
import {
  buildDashboardViewModel,
  LOOKBACK_DAYS,
  msOf,
  TODO_LIMIT,
} from "../dashboard-view-model";

/**
 * SC-02 の配線
 *
 * **本番の画面は Supabase に繋がないと開けない。** props を作るところを
 * 画面の中に置いていると、確かめる手段が目視しか無くなる（そして
 * 見ていない場所は「合っている」側に倒れる。§9.1 の6つ目）。
 * 純関数に出したので、ここで突き合わせる。
 */

const model = buildFixtureModel();

const view = buildDashboardViewModel({
  series: model.series,
  dashboard: model.dashboard,
  today: FIXTURE_TODAY,
  reserveLine: FIXTURE_RESERVE_LINE,
  range: "90",
});

describe("buildDashboardViewModel", () => {
  it("残高は予測系列から取る（AC-49）", () => {
    expect(view.balance).toBe(model.dashboard.current);
  });

  it("フィクスチャは生活防衛ラインを割る（検査の前提）", () => {
    expect(model.dashboard.warning).not.toBeNull();
    expect(model.dashboard.warning?.kind).toBe("reserveBreach");
  });

  it("警告があるときだけ最低残高の点を打つ", () => {
    expect(view.lowPoint).toEqual({
      date: model.dashboard.lowest.date,
      value: model.dashboard.lowest.balance,
    });
  });

  it("注記の金額は最低残高そのもの。文に混ぜない", () => {
    expect(view.annotation.tone).toBe("warning");
    expect(view.annotation.amount).toBe(model.dashboard.lowest.balance);
    expect(view.annotation.suffix).toContain("生活防衛ライン");
  });

  it("警告が無ければ注記は muted で金額を持たない", () => {
    const safe = buildDashboardViewModel({
      series: model.series,
      dashboard: { ...model.dashboard, warning: null },
      today: FIXTURE_TODAY,
      reserveLine: FIXTURE_RESERVE_LINE,
      range: "90",
    });
    expect(safe.annotation.tone).toBe("muted");
    expect(safe.annotation.amount).toBeNull();
    expect(safe.lowPoint).toBeNull();
    expect(safe.annotation.prefix).toContain(`${DASHBOARD_HORIZON_DAYS}日先まで`);
  });

  it("生活防衛ラインが0なら「残高を保てる」に変わる", () => {
    const noLine = buildDashboardViewModel({
      series: model.series,
      dashboard: { ...model.dashboard, warning: null },
      today: FIXTURE_TODAY,
      reserveLine: 0,
      range: "90",
    });
    expect(noLine.annotation.prefix).toContain("残高を保てる");
  });

  /* ---------- グラフ ---------- */

  it("実線と破線の継ぎ目は actualEnd。**今日を直接見ない**", () => {
    /* `actualEnd` は max(最後の実績, 今日)（balance.ts 手順4）。つまり
       ふだんは今日と同じで、Figma のとおり今日から破線になる。
       **違うのは未来日付の実績があるとき。** そのときは実線が今日より
       先まで伸びる。今日で切る実装だと、入れた実績が消える */
    const end = model.series.actualEnd;
    expect(end >= FIXTURE_TODAY).toBe(true);

    const endT = msOf(end);
    const solid = view.chart.points.filter((p) => p.actual !== null);
    const dashed = view.chart.points.filter((p) => p.forecast !== null);

    expect(solid.length).toBeGreaterThan(0);
    expect(dashed.length).toBeGreaterThan(0);

    /* 実線は継ぎ目まで、破線は継ぎ目から。**継ぎ目の1点は両方に入る**
       （入れないと線が切れる） */
    expect(solid.every((p) => p.t <= endT)).toBe(true);
    expect(dashed.every((p) => p.t >= endT)).toBe(true);
    expect(view.chart.points.some((p) => p.t === endT && p.actual !== null && p.forecast !== null)).toBe(
      true,
    );
  });

  it("未来日付の実績があれば実線が今日より先まで伸びる", () => {
    const later = buildFixtureModel("2026-10-10");
    /* 10/10 を今日にすると、まだ 10/10 より後の実績は無いので継ぎ目は今日 */
    expect(later.series.actualEnd).toBe("2026-10-10");
  });

  it("横幅は 今日−30日 から 今日+期間 まで", () => {
    const first = view.chart.points[0];
    const last = view.chart.points[view.chart.points.length - 1];
    const span = (last.t - first.t) / 86_400_000;
    expect(span).toBeLessThanOrEqual(LOOKBACK_DAYS + DASHBOARD_HORIZON_DAYS);
    expect(span).toBeGreaterThan(DASHBOARD_HORIZON_DAYS);
  });

  it("期間を広げると点が増える。最低残高と警告は変わらない", () => {
    const year = buildDashboardViewModel({
      series: model.series,
      dashboard: model.dashboard,
      today: FIXTURE_TODAY,
      reserveLine: FIXTURE_RESERVE_LINE,
      range: "12m",
    });
    expect(year.chart.points.length).toBeGreaterThan(view.chart.points.length);
    /* **ここが肝。** タブはグラフの横幅だけを変える（要件定義書 §4.1 は
       90日を見ると書いてある）。連動させると警告の意味が変わる */
    expect(year.lowPoint).toEqual(view.lowPoint);
    expect(year.annotation).toEqual(view.annotation);
  });

  it("目印は今日から。右端はラベルを左に出す", () => {
    expect(view.chart.markers[0].label).toBe("今日");
    expect(view.chart.markers[0].value).toBe(model.dashboard.current);
    expect(view.chart.markers[view.chart.markers.length - 1].side).toBe("left");
    expect(view.chart.markers.map((m) => m.label)).toContain("90日後（1月16日）");
  });

  /* ---------- やること ---------- */

  it("件数は全件。一覧は上限まで", () => {
    expect(view.todoCount).toBe(model.dashboard.unfilled.length);
    expect(view.todos.length).toBeLessThanOrEqual(TODO_LIMIT);
    expect(view.todos.length).toBeLessThanOrEqual(view.todoCount);
  });

  it("区分は costType から決める（§3.1.2 適用規則1）", () => {
    const byTitle = new Map(view.todos.map((t) => [t.title, t]));
    expect(byTitle.get("○○商会 売上入金")?.category).toBe("収入");
    expect(byTitle.get("○○商会 売上入金")?.amountType).toBe("income");
    expect(byTitle.get("事務所家賃")?.category).toBe("固定費");
    expect(byTitle.get("外注費")?.category).toBe("変動費");
    expect(byTitle.get("事務所家賃")?.amountType).toBe("expense");
  });

  /* ---------- 口座・カード ---------- */

  it("合計は口座の足し算。カードを含めない", () => {
    expect(view.total.label).toBe("現預金 合計");
    expect(view.total.value).toBe(model.dashboard.total);
    expect(view.total.value).toBe(view.accounts.reduce((s, a) => s + a.value, 0));
  });

  it("カードは未払残高と次回引落を両方出す", () => {
    expect(view.cards).toHaveLength(1);
    expect(view.cards[0].label).toBe("××カード 未払");
    /* **次回引落を落とさない。** 口座残高だけ見て足りると思った翌週に
       引落が来るのを防ぐ行（v0.6.0 のデザインには無い。ADR-0014） */
    expect(view.cards[0].note).toMatch(/^次回引落 \d+月\d+日 ¥/);
  });

  /* ---------- うち未記録の予定 ---------- */

  it("0件なら金額を出さない（AC-49b）", () => {
    const none = buildDashboardViewModel({
      series: model.series,
      dashboard: {
        ...model.dashboard,
        unrecorded: { amount: 123_000, count: 0 },
      },
      today: FIXTURE_TODAY,
      reserveLine: FIXTURE_RESERVE_LINE,
      range: "90",
    });
    expect(none.unrecorded).toBeNull();
  });

  it("1件以上なら金額を出す。件数は渡さない（AC-49d）", () => {
    expect(model.dashboard.unrecorded.count).toBeGreaterThan(0);
    expect(view.unrecorded).toBe(model.dashboard.unrecorded.amount);
    /* 件数は props に無い。金額の隣に出せないようにしてある */
    expect(Object.keys(view)).not.toContain("unrecordedCount");
  });
});

describe("消し込みの警告（FR-43）", () => {
  it("一度も消し込んでいない状態を拾う（AC-29c）", () => {
    expect(model.reconcile.stalled).not.toBeNull();
    expect(model.reconcile.stalled?.neverReconciled).toBe(true);
  });
});
