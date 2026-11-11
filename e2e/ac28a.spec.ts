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

import {
  actualListPanel,
  actualRowDates,
  actualTotalNote,
  monthTabs,
  readActualTotal,
  report,
  signIn,
} from "./support.ts";

/** FR-42。`MONTH_PAGE_SIZE` と同じ値 */
const PAGE_SIZE = 200;

/**
 * ページンク゚の表示から、その月の件数とページ数を読む。
 *
 * 「1〜200 件目 ／ 1,033件（1/6ページ）」の形（`formatActualListFooter`）。
 *
 * **v0.6.0 で月の件数の出しどころが変わった。** 以前は `<select>` の
 * 選択肢が「2026年3月（1,033件）」と件数を持っていたが、MonthTab の
 * ラベルは「2026年3月」だけである。**月の件数はページンク゚の
 * 表示にしか出ていない**（かつそれは1ペ゚ーシに收まる月には出ない）。
 *
 * **全部の数字を連結してはいけない。** 年月にも数字が入るので、
 * 「2026年3月（1,033件）」が `202631033` になる（実際に一度やった）。
 */
function readFooter(text: string): { monthCount: number; pages: number } | null {
  const hit = text.match(/／\s*([\d,]+)件（\d+\/(\d+)ページ）/);
  if (!hit) return null;
  return {
    monthCount: Number(hit[1].replace(/,/g, "")),
    pages: Number(hit[2]),
  };
}

test("総件数のすべてに操作だけで到達でき、重複がない", async ({ page }) => {
  await signIn(page);
  await page.goto("/entry");

  /* **実績一覧のパネルの中だけを見る。** 同じ画面に「やること」の表も
     あり、画面全体から行を拾うとそちらの行まで数えてしまう */
  const card = actualListPanel(page);
  await expect(actualTotalNote(page)).toBeVisible({ timeout: 60_000 });

  /* 見出しに出ていた総件数は、v0.6.0 で下の注記に移った */
  const total = await readActualTotal(page);

  const tabs = monthTabs(page);
  const monthLabels = await tabs.allTextContents();

  /**
   * **辿った行を全部ためる。** 件数を数えるだけだと、同じ行が2ページに
   * 出ていても合計は合ってしまう。id の代わりに「日付＋内容＋金額」で
   * 見る（画面には id が出ない）。
   */
  const seen = new Set<string>();
  let rowsWalked = 0;
  let pagedMonths = 0;
  const perMonth: {
    month: string;
    shown: number | null;
    walked: number;
    pages: number;
  }[] = [];

  for (let i = 0; i < monthLabels.length; i += 1) {
    await tabs.nth(i).click();
    await expect(actualRowDates(page).first()).toBeVisible({ timeout: 30_000 });

    let pages = 0;
    let walkedHere = 0;
    let shown: number | null = null;

    for (;;) {
      /**
       * **行の文字を TodoRow の中から取る。**
       *
       * v0.6.0 の行は `table tbody tr` ではなく `div` である。
       * 日付の列から親に上がると、日付・内容・金額・区分・状態が
       * 並んだ行が取れる。
       */
      const rows = await actualRowDates(page).evaluateAll((nodes) =>
        nodes.map((n) =>
          (n.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
        ),
      );
      for (const row of rows) {
        seen.add(row);
        rowsWalked += 1;
        walkedHere += 1;
      }
      pages += 1;

      const footer = readFooter((await card.textContent()) ?? "");
      if (footer) shown = footer.monthCount;

      const next = card.getByRole("button", { name: `次の${PAGE_SIZE}件` });
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      const before = rows.join(",");
      await next.click();
      /* ページが入れ替わるのを待つ。**固定の待ち時間にしない** ――
         遅いと前のページをもう一度数えて「重複している」と出る */
      await expect
        .poll(
          async () =>
            (
              await actualRowDates(page).evaluateAll((nodes) =>
                nodes.map((n) =>
                  (n.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
                ),
              )
            ).join(","),
          { timeout: 30_000, intervals: [10] },
        )
        .not.toBe(before);
    }

    if (pages > 1) pagedMonths += 1;
    perMonth.push({ month: monthLabels[i], shown, walked: walkedHere, pages });
  }

  console.log("\n===== AC-28a ページングと到達性 =====");
  report([
    ["画面に出た総件数", total.toLocaleString()],
    ["辿った行数", rowsWalked.toLocaleString()],
    ["ユニークな行", seen.size.toLocaleString()],
    ["月の数", monthLabels.length],
    ["ページングが発動した月", `${pagedMonths} / ${monthLabels.length}`],
    ["1ページの上限", PAGE_SIZE],
  ]);
  console.log("");
  console.log("  月ごと        注記   辿った   ページ");
  for (const m of perMonth) {
    console.log(
      `    ${m.month}  ${String(m.shown ?? "-").padStart(6)} ${String(m.walked).padStart(8)} ${String(m.pages).padStart(7)}`,
    );
  }
  console.log("");

  /* **閾値に達しているか。** 発動していないなら、確かめたい相手が
     動いていない（§9.1）。ここで止める */
  expect(
    pagedMonths,
    "ページングが1回も発動していない。--span を小さくして月200件を超えさせる",
  ).toBeGreaterThan(0);

  /* 月ごとの件数と、辿れた数が合う。**注記が出ている月だけ**
     （1ページに收まる月は件数を画面に出していない） */
  for (const m of perMonth) {
    if (m.shown === null) continue;
    expect(m.walked, `${m.month} の注記の件数と辿れた数`).toBe(m.shown);
  }

  /* 総件数すべてに到達できた */
  expect(rowsWalked).toBe(total);

  /* 重複がない */
  expect(seen.size).toBe(rowsWalked);
});
