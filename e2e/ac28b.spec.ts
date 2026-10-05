/**
 * AC-28b 実績一覧の初期表示
 *
 * > 基準日以降の実績が3,000件ある状態で、実績一覧の初期表示が 5.1 の
 * > 目標値を満たすこと（FR-42・FR-47）。**AC-28a とは別に実測で確認する**
 *
 * §5.1 の目標値：**初回表示 3秒以内（回線 4G 想定）**
 *
 * 前提：`pnpm loadtest:seed`（既定 `--rows=3000 --span=550`）が済んでいること。
 */

import { expect, test } from "@playwright/test";

import { report, signIn, throttleTo4G } from "./support.ts";

/** §5.1「初回表示 3秒以内」 */
const BUDGET_MS = 3_000;

/** §5.1「v1.0 は基準日以降の実績3,000件」 */
const EXPECTED_ROWS = 3_000;

test("3,000件で実績一覧の初期表示が3秒以内（4G）", async ({ page }) => {
  /* サインインは測定の対象外。通信を絞る前に済ませる */
  await signIn(page);

  const cdp = await throttleTo4G(page);

  /* **測るのは「開いてから一覧が出るまで」。** 画面遷移ではなく、
     URL を直接開いた状態（＝初回表示）で測る */
  const started = Date.now();
  await page.goto("/entry");

  const title = page.getByText(/^実績（[\d,]+件）$/);
  await expect(title).toBeVisible({ timeout: 60_000 });

  /* 見出しだけでなく、行が描かれるまでを含める。見出しは件数が分かった
     時点で出るので、そこで止めると描画の時間が落ちる */
  await expect(page.locator("table tbody tr").first()).toBeVisible({
    timeout: 60_000,
  });
  const elapsed = Date.now() - started;

  /* 画面に出ている総件数。**投入したデータで測れているかの確認** */
  const heading = (await title.textContent()) ?? "";
  const shown = Number(heading.replace(/[^\d]/g, ""));

  /* ブラウザ側の時刻でも取る。Date.now() との食い違いを見るため */
  const nav = await page.evaluate(() => {
    const e = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    return e
      ? {
          domContentLoaded: Math.round(e.domContentLoadedEventEnd),
          load: Math.round(e.loadEventEnd),
        }
      : null;
  });

  const rest = await page.evaluate(() => {
    const all = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    const api = all.filter((e) => e.name.includes("/rest/v1/"));
    return {
      total: all.length,
      restCount: api.length,
      lastRestEnd: api.length
        ? Math.round(Math.max(...api.map((e) => e.responseEnd)))
        : null,
    };
  });

  console.log("\n===== AC-28b 実績一覧の初期表示（4G） =====");
  report([
    ["画面に出た総件数", shown.toLocaleString()],
    ["開いてから行が出るまで", `${elapsed.toLocaleString()} ms`],
    ["目標値（§5.1）", `${BUDGET_MS.toLocaleString()} ms`],
    ["navigation DOMContentLoaded", nav ? `${nav.domContentLoaded} ms` : "-"],
    ["navigation loadEventEnd", nav ? `${nav.load} ms` : "-"],
    ["REST リクエスト数", rest.restCount],
    ["最後の REST 完了", rest.lastRestEnd ? `${rest.lastRestEnd} ms` : "-"],
    ["resource エントリ総数", `${rest.total}${rest.total >= 250 ? " ※上限" : ""}`],
  ]);
  console.log("");

  await cdp.detach();

  /* **件数を先に確かめる。** 0件や少ない件数で3秒を切っても、
     測りたいものを測っていない（§9.1・CLAUDE.md §2.11） */
  expect(shown).toBe(EXPECTED_ROWS);

  expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
});
