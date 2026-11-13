/**
 * AC-72 「うち未記録の予定」の金額と、やることの一覧が同じ集合を指す
 *
 * 2026-11-13 の報告：金額には今日付の予定（17,058円）が入っているのに
 * やることに出てこないので、**飛んだ先で金額が合わなかった。**
 *
 *   金額   `todayRow.proj − todayRow.act`      → 今日を含む
 *   件数   `cashDateOf(plan) <= today`         → 今日を含む
 *   一覧   `plan.date < today`                 → 含まない  ← ここだけ
 *
 * ## 退化させない（§2.11）
 *
 * **今日付の予定が0件のデータでは、`<` でも `<=` でも結果が同じになる。**
 * 今日を外している実装でも通ってしまうので、フィクスチャに今日（10/18）の
 * 予定を1件入れてある（`dashboard-fixture.ts` の o3「電気代」）。
 * **そのデータで差が出ることを、この検査の中で先に測る。**
 *
 * ## 残っている食い違い（カード）
 *
 * **一覧は発生日、金額は現金が動く日で見る。** 要件定義書 §3.3 が
 * 「発生日は過ぎたが引落日が未来のカード利用は、件数には入るが金額には
 * 入らない。これは仕様である」と定めていて、AC-49d も一覧の件数を発生日で
 * 数えることを要求している。**したがって一覧の合計と金額は、そのカード
 * 利用のぶんだけ食い違う** ―― AC-72 の2つ目の条項と衝突している。
 *
 * ここでは**食い違いの額を固定する。** 「合っている」ことにも「無視して
 * よい」ことにもせず、**差がカードの引落待ちと一致すること**を測る
 * （AC-72b。2026-11-13 に条項の側が直り、これが満たしている形になった）。
 *
 * **画面に出す額が、実際の差と同じであることも測る**（`awaiting`）。
 * 説明の文に別の計算を通すと、**合わない理由として合わない額が出る。**
 */

import { describe, expect, it } from "vitest";

import { cardIdsOf, depositIdsOf, viewDelta } from "@/core/balance";
import { settleDateOf } from "@/core/cash";
import { isCard } from "@/core/types";
import type { Account, DateStr, ForecastInstance } from "@/core/types";
import {
  buildFixtureModel,
  FIXTURE_ACCOUNTS,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { isUnrecordedOn } from "@/lib/unrecorded";

const BY_ID = new Map<string, Account>(FIXTURE_ACCOUNTS.map((a) => [a.id, a]));

/** 現金が動く日（CL-2）。`lib/unrecorded` の `cashDateOf` と同じ規則 */
function cashDateOf(plan: ForecastInstance): DateStr {
  const account = BY_ID.get(plan.accountId);
  if (!account || !isCard(account) || plan.type === "transfer") return plan.date;
  return settleDateOf(account, plan.date);
}

/** 発生日は今日以前だが、引落日が未来のカード利用（§3.3） */
function awaitingSettlement(plan: ForecastInstance, today: DateStr): boolean {
  return plan.date <= today && cashDateOf(plan) > today;
}

describe("AC-72 金額と一覧が同じ集合を指す", () => {
  it("今日の予定が一覧に出る（在ること・無いこと）", () => {
    const { dashboard } = buildFixtureModel();
    const dates = dashboard.unfilled.map((p) => p.date);

    /* **在ること。** 今日の行が入る。`plan.date < today` に戻すと落ちる */
    expect(dates).toContain(FIXTURE_TODAY);
    expect(dashboard.unfilled.map((p) => p.name)).toContain("電気代");

    /* **無いこと。** 明日以降は入らない ―― `<=` が `<` の反対に
       振り切れて「全部入れる」実装になっていないこと */
    expect(dates.filter((d) => d > FIXTURE_TODAY)).toEqual([]);

    /* **並びは新しい順。** 今日の行が先頭に来る（画面の2つの組が
       連続する前提。DashboardView の `TODO_SECTIONS`） */
    expect(dates[0]).toBe(FIXTURE_TODAY);
  });

  it("試験データで `<` と `<=` の差が出る（退化していない）", () => {
    /* **これを先に測る。** 今日付の予定が0件のデータだと、下の条項は
       どちらの実装でも通る（§2.11 の3つ目の形） */
    const today = buildFixtureModel(FIXTURE_TODAY);
    const yesterday = buildFixtureModel("2026-10-17");

    expect(today.dashboard.unfilled.length).toBe(
      yesterday.dashboard.unfilled.length + 1,
    );
    /* 金額も動く（今日の予定は今日の残高に効いている） */
    expect(today.dashboard.unrecorded.amount).not.toBe(
      yesterday.dashboard.unrecorded.amount,
    );
    expect(
      today.dashboard.unrecorded.amount - yesterday.dashboard.unrecorded.amount,
    ).toBe(-31_500);
  });

  it("境界の規則が1箇所にある（§2.8）", () => {
    /* 一覧も件数も、今日を「未記録」に入れる。
       **`isUnrecordedOn` を `<` に変えると、両方が同時に落ちる** */
    expect(isUnrecordedOn(FIXTURE_TODAY, FIXTURE_TODAY)).toBe(true);
    expect(isUnrecordedOn("2026-10-19", FIXTURE_TODAY)).toBe(false);
    expect(isUnrecordedOn("2026-10-17", FIXTURE_TODAY)).toBe(true);
  });

  it("一覧と、金額が見ている集合が一致する（カードの引落待ちを除いて）", () => {
    const { series, dashboard } = buildFixtureModel();

    /* 金額が見ている集合：現金が動く日が今日以前 */
    const inAmount = series.unmatchedForecast
      .filter((p) => isUnrecordedOn(cashDateOf(p), FIXTURE_TODAY))
      .map((p) => p.key)
      .sort();
    /* 一覧：発生日が今日以前。引落待ちのカード利用を外すと一致する */
    const inList = dashboard.unfilled
      .filter((p) => !awaitingSettlement(p, FIXTURE_TODAY))
      .map((p) => p.key)
      .sort();

    expect(inList).toEqual(inAmount);

    /* **在ることを先に見る。** 空の集合どうしは必ず一致する（§2.11） */
    expect(inList.length).toBeGreaterThan(5);

    /* **一覧が発生日で見ている証拠**（AC-49d・§3.3）。引落が未来の
       カード利用も、消し込む対象なので一覧には出る。**ここを現金日に
       倒すと、記録すべき予定が一覧から消える** ―― 0件になると、上の
       一致はカードの無いデータと同じ形で通ってしまう */
    const waiting = dashboard.unfilled.filter((p) =>
      awaitingSettlement(p, FIXTURE_TODAY),
    );
    expect(waiting.map((p) => p.name)).toEqual(["サブスク"]);
  });

  it("一覧の金額の合計が、注記の金額と一致する（引落待ちのぶんだけずれる）", () => {
    const { series, dashboard } = buildFixtureModel();
    const deposits = new Set(depositIdsOf(series));
    const viewed = [...depositIdsOf(series), ...cardIdsOf(series)];

    const sum = dashboard.unfilled.reduce(
      (total, plan) => total + viewDelta(plan, viewed, deposits),
      0,
    );
    const waiting = dashboard.unfilled
      .filter((p) => awaitingSettlement(p, FIXTURE_TODAY))
      .reduce((total, plan) => total + viewDelta(plan, viewed, deposits), 0);

    /* **差は引落待ちのカード利用そのもの。** 10/08 のサブスク 12,000 は
       引落が 11/10 なので、一覧には出るが今日の残高には効いていない */
    expect(waiting).toBe(-12_000);
    expect(sum - waiting).toBe(dashboard.unrecorded.amount);

    /* 生の差も残す。**0 ではない** ―― 一致は求めない（AC-72b）。
       §3.3 が「これは仕様である」と書いている差である */
    expect(sum).toBe(-120_100);
    expect(dashboard.unrecorded.amount).toBe(-108_100);

    /* **画面に出す額が、実際の差と同じであること**（AC-72b）。
       注記は `awaiting` を出す。ここが差とずれると、**合わない理由として
       合わない額**が出る */
    expect(dashboard.unrecorded.awaiting).toEqual({ amount: -12_000, count: 1 });
    expect(sum - dashboard.unrecorded.awaiting.amount).toBe(
      dashboard.unrecorded.amount,
    );
  });
});
