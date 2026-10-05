/**
 * AC-28a ページングと到達性
 *
 * > 見出しに表示した総件数のすべてに、画面上の操作（月切替・ページング）
 * > だけで到達できること。重複がないこと（FR-42）
 *
 * 前提：`pnpm loadtest:seed -- --rows=3000 --span=90` が済んでいること。
 * **月あたり約1,000件になり、FR-42 の月内ページング（200件超）が発動する。**
 *
 * 550日（月約158件）では**ページングが1回も発動しない。** 確かめたい相手が
 * 動かないまま通る（§9.1「閾値に達していない」）。実際、単体テストでは
 * 見ていたが実機では発動していなかった。
 */

import { expect, test } from "@playwright/test";

import { report, signIn } from "./support.ts";

/** FR-42。`MONTH_PAGE_SIZE` と同じ値 */
const PAGE_SIZE = 200;

/**
 * 「実績（3,000件）」「2026年3月（1,033件）」から件数を取る。
 *
 * **全部の数字を連結してはいけない。** 年月にも数字が入っているので、
 * 「2026年3月（1,033件）」が `202631033` になる（実際に一度やった）。
 * 括弧の中だけを見る。
 */
function count(text: string): number {
  const hit = text.match(/（([\d,]+)件）/);
  if (!hit) throw new Error(`件数を読み取れません: ${text}`);
  return Number(hit[1].replace(/,/g, ""));
}

test("総件数のすべてに操作だけで到達でき、重複がない", async ({ page }) => {
  await signIn(page);
  await page.goto("/entry");

  const title = page.getByText(/^実績（[\d,]+件）$/);
  await expect(title).toBeVisible({ timeout: 60_000 });

  /* **実績カードの中だけを見る。** 同じ画面に「要対応」の表もあり、
     `table tbody tr` で拾うとそちらの行まで数えてしまう */
  const card = page.locator("section").filter({ has: title });
  const rowsIn = card.locator("tbody tr");

  const total = count((await title.textContent()) ?? "");

  const monthSelect = card.locator("#actual-month");
  const months = await monthSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((n) => ({
      value: (n as HTMLOptionElement).value,
      text: (n as HTMLOptionElement).textContent ?? "",
    })),
  ).then((list) => list.map((o) => ({ value: o.value, count: count(o.text) })));

  /* **辿った行を全部ためる。** 件数を数えるだけだと、同じ行が2ページに
     出ていても合計は合ってしまう。id の代わりに「日付＋内容＋金額」で
     見る（画面には id が出ない） */
  const seen = new Set<string>();
  let rowsWalked = 0;
  let pagedMonths = 0;
  const perMonth: { month: string; shown: number; walked: number; pages: number }[] = [];

  for (const month of months) {
    await monthSelect.selectOption(month.value);
    await expect(rowsIn.first()).toBeVisible({ timeout: 30_000 });

    let pages = 0;
    let walkedHere = 0;

    for (;;) {
      const rows = await rowsIn.evaluateAll((nodes) =>
        nodes.map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()),
      );
      for (const row of rows) {
        seen.add(row);
        rowsWalked += 1;
        walkedHere += 1;
      }
      pages += 1;

      const next = card.getByRole("button", { name: "次の200件" });
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      await next.click();
      /* ページが入れ替わるのを待つ */
      await page.waitForTimeout(100);
    }

    if (pages > 1) pagedMonths += 1;
    perMonth.push({ month: month.value, shown: month.count, walked: walkedHere, pages });
  }

  console.log("\n===== AC-28a ページングと到達性 =====");
  report([
    ["見出しの総件数", total.toLocaleString()],
    ["辿った行数", rowsWalked.toLocaleString()],
    ["ユニークな行", seen.size.toLocaleString()],
    ["月の数", months.length],
    ["ページングが発動した月", `${pagedMonths} / ${months.length}`],
    ["1ページの上限", PAGE_SIZE],
  ]);
  console.log("");
  console.log("  月ごと        見出し   辿った   ページ");
  for (const m of perMonth) {
    console.log(
      `    ${m.month}  ${String(m.shown).padStart(6)} ${String(m.walked).padStart(8)} ${String(m.pages).padStart(7)}`,
    );
  }
  console.log("");

  /* **閾値に達しているか。** 発動していないなら、確かめたい相手が
     動いていない（§9.1）。ここで止める */
  expect(
    pagedMonths,
    "ページングが1回も発動していない。--span を小さくして月200件を超えさせる",
  ).toBeGreaterThan(0);

  /* 月ごとの見出しと、辿れた数が合う */
  for (const m of perMonth) {
    expect(m.walked, `${m.month} の月見出しと辿れた数`).toBe(m.shown);
  }

  /* 総件数すべてに到達できた */
  expect(rowsWalked).toBe(total);

  /* 重複がない */
  expect(seen.size).toBe(rowsWalked);
});
