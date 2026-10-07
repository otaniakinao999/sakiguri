/**
 * AC-48 実績入力画面が操作可能な範囲に収まる
 *
 * > 基準日以降の実績3,000件・未消込の予定インスタンス1,200件の状態で、
 * > 実績入力画面の初期表示が操作可能な範囲に収まること。**v1.0 は
 * > 総当たり（360万回）でよい**（FR-46・§5.1）
 *
 * ## 「操作可能」を何で判断するか
 *
 * **速さの目標ではないので、基準を自分で決めずに §5.1 から借りる。**
 *
 * | 見るもの | 基準 | 出どころ |
 * |---|---|---|
 * | 最長のロングタスク | **300 ms** | §5.1「残高再計算 データ変更から画面反映まで 300ms 以内（定期項目50件・実績3,000件・予測期間24ヶ月）」 |
 * | 操作してから画面が変わるまで | **300 ms** | 同上 |
 * | 初期表示 | 3,000 ms | §5.1「初回表示」。AC-28b で別に見ている |
 *
 * §5.1 の条件（定期項目50件・実績3,000件・予測期間24ヶ月）は、`seed.ts` が
 * 作る状態とちょうど同じである。**借りる相手として正しい。**
 *
 * **ロングタスクを見る理由。** ここで重いのは FR-46 の候補照合で、
 * 3,000 × 1,241 の総当たりになる。これはメインスレッドで動くので、
 * 長ければ**その間クリックが効かない。** 平均の応答では見えない。
 *
 * 前提：`pnpm loadtest:seed`（既定）。未消込が1,200件を超えていることは
 * seed の出力で確かめる（§9.1 の3つ目）。
 */

import { expect, test } from "@playwright/test";

import { countUnmatchedForecast, report, signIn } from "./support.ts";

/** §5.1「残高再計算 データ変更から画面反映まで 300ms 以内」 */
const INTERACTION_BUDGET_MS = 300;

/** §5.1「v1.0 は基準日以降の実績3,000件」 */
const EXPECTED_ROWS = 3_000;

/** AC-48 の条件。未消込の予定インスタンス */
const EXPECTED_UNMATCHED = 1_200;

test("3,000件×1,200件で実績入力画面が操作可能", async ({ page }) => {
  /* ロングタスクを拾う。**ページを開く前に仕込む。** 開いたあとだと
     一番重い初回の計算を取り逃がす */
  await page.addInitScript(() => {
    (window as unknown as { __longTasks: number[] }).__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (window as unknown as { __longTasks: number[] }).__longTasks.push(
          Math.round(entry.duration),
        );
      }
    }).observe({ entryTypes: ["longtask"] });
  });

  await signIn(page);

  const started = Date.now();
  await page.goto("/entry");

  const listTitle = page.getByText(/^実績（[\d,]+件）$/);
  await expect(listTitle).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({
    timeout: 60_000,
  });
  const firstPaint = Date.now() - started;

  /* ---------- 測りたい状態になっているか（§9.1） ---------- */
  const rows = Number(((await listTitle.textContent()) ?? "").replace(/[^\d]/g, ""));

  /**
   * **要対応の件数では代用できない。**
   *
   * 要対応は `plan.date <= today` で絞ったあとの数で、照合が舐める
   * 集合とは別物である（実測で 1,241 と 508）。画面の数で代用すると、
   * 測りたい負荷の 1/2 以下で「満たした」と書くことになる。
   *
   * **別経路で数える。** 本番の `buildForecast` を DB の行に対して
   * そのまま走らせる（`countUnmatchedForecast`）。
   */
  const todoTitle = page.getByText(/^要対応（[\d,]+件）$/);
  await expect(todoTitle).toBeVisible({ timeout: 60_000 });
  const todo = Number(((await todoTitle.textContent()) ?? "").replace(/[^\d]/g, ""));

  const set = await countUnmatchedForecast();
  /* 消し込み済みが0なら、展開した総数がそのまま未消込である */
  expect(
    set.reconciled,
    "消し込み済みの実績がある。未消込の数を引き算で出すことになる",
  ).toBe(0);
  const unmatched = set.forecast;

  /* ---------- 操作してから画面が変わるまで ---------- */
  const card = page.locator("section").filter({ has: listTitle });
  const monthSelect = card.locator("#actual-month");
  const options = await monthSelect.locator("option").count();

  const firstRowText = async () =>
    (await card.locator("tbody tr").first().textContent()) ?? "";

  const before = await firstRowText();
  const clickStarted = Date.now();
  await monthSelect.selectOption({ index: Math.min(1, options - 1) });
  await expect
    .poll(firstRowText, { timeout: 30_000, intervals: [10] })
    .not.toBe(before);
  const clickResponse = Date.now() - clickStarted;

  /* ---------- ロングタスク ---------- */
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number[] }).__longTasks ?? [],
  );
  const longest = longTasks.length ? Math.max(...longTasks) : 0;
  const over = longTasks.filter((d) => d > INTERACTION_BUDGET_MS);

  console.log("\n===== AC-48 実績入力画面が操作可能か =====");
  report([
    ["実績の件数（画面）", rows.toLocaleString()],
    ["実績の件数（DB）", set.actuals.toLocaleString()],
    ["消し込み済み（DB）", set.reconciled.toLocaleString()],
    ["**未消込の予定インスタンス**", unmatched.toLocaleString()],
    ["要対応の件数（画面）", `${todo.toLocaleString()}（plan.date <= today で絞ったあと。別物）`],
    ["総当たりの回数", (rows * unmatched).toLocaleString()],
    ["初期表示（行が出るまで）", `${firstPaint.toLocaleString()} ms`],
    ["月を切り替えて表が変わるまで", `${clickResponse.toLocaleString()} ms`],
    ["基準（§5.1 残高再計算）", `${INTERACTION_BUDGET_MS} ms`],
    ["ロングタスクの数", longTasks.length],
    ["最長のロングタスク", `${longest} ms`],
    [`${INTERACTION_BUDGET_MS}ms を超えたもの`, over.length ? over.join(", ") : "なし"],
  ]);
  console.log("");

  /* **測りたい負荷になっているかを先に見る。** 件数が足りないまま
     通しても、確かめたい総当たりが軽いだけ（§9.1 の3つ目） */
  expect(rows).toBe(EXPECTED_ROWS);
  expect(set.actuals, "画面と DB の実績件数が合わない").toBe(rows);
  expect(
    unmatched,
    "未消込の予定インスタンスが1,200件に届いていない。総当たりが軽く、測りたい負荷になっていない",
  ).toBeGreaterThanOrEqual(EXPECTED_UNMATCHED);

  /* 操作可能であること */
  expect(clickResponse).toBeLessThanOrEqual(INTERACTION_BUDGET_MS);
  expect(
    longest,
    "メインスレッドが止まっている。この間クリックが効かない",
  ).toBeLessThanOrEqual(INTERACTION_BUDGET_MS);
});
