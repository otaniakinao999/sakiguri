/**
 * AC-35 件数が一致しないとき、残高を表示しない
 *
 * > 取得件数が総件数と一致しない状態を作ったとき、残高が表示されず、
 * > 読み込みに失敗したことが画面に示されること。**部分的なデータで
 * > 計算した残高を表示しないこと**（FR-47）
 *
 * ## なぜ実機で要るか
 *
 * これまでの実機確認は**通信の失敗**だった。AC-35 が見ているのは
 * **件数の不一致**で、別の経路である。症状はどちらも「読み込めない」
 * なので、確認したつもりになっていた（§9.1 の5つ目）。
 *
 * **通信は成功させたまま、行だけを減らす。** `route` で応答を横取りし、
 * 各ページから1行だけ落とす。`Content-Range` の総件数はそのままなので、
 * `fetchAll` の最後の照合が合わなくなる。
 *
 * | | |
 * |---|---|
 * | HTTP ステータス | 200 / 206（**失敗していない**） |
 * | 返る行 | 各ページ 1行少ない |
 * | 総件数ヘッダ | そのまま |
 *
 * ## 片方の状態だけを見ない（§9.1 の4つ目）
 *
 * **先に、横取りなしで残高が出ることを確かめる。** それをしないと、
 * 「残高が出ない」のが横取りのせいなのか、もともと出ないのかが
 * 分からない。
 *
 * 前提：`pnpm loadtest:seed`（既定 `--rows=3000 --span=550`）が済んでいること。
 */

import { expect, test } from "@playwright/test";

import { report, signIn } from "./support.ts";

test("件数が合わないときは残高を出さず、失敗を画面に示す", async ({ page }) => {
  await signIn(page);

  /**
   * ---------- 1. 横取りなし。残高が出ることを先に確かめる ----------
   *
   * **この段階を減らさないこと。**
   *
   * 横取りして「出ない」ことだけを見ると、**何をしても出ない状態でも
   * 通る。** サインインが壊れていても、画面が真っ白でも、残高は出ない。
   * 測る側が通る方向に間違っている形である（§9.1 の6つ目）。
   *
   * 先に「出る」ことを見ておくと、2段階目の「出ない」が横取りのせいだと
   * 言える。
   */
  await page.goto("/");
  const balance = page.getByText("現預金 見込み");
  await expect(balance).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("データを読み込めませんでした")).toHaveCount(0);

  /* ---------- 2. 行だけを1つ落とす。通信は成功させる ---------- */
  const statuses: number[] = [];
  let droppedFrom = 0;

  await page.route(/\/rest\/v1\/actuals\?/, async (route) => {
    const response = await route.fetch();
    statuses.push(response.status());

    const rows = (await response.json()) as unknown[];
    if (rows.length === 0) {
      await route.fulfill({ response });
      return;
    }
    droppedFrom += 1;
    /* `response` を渡すとヘッダがそのまま使われる。**`Content-Range` の
       総件数は元のまま**で、本文だけが1行短くなる */
    await route.fulfill({ response, json: rows.slice(0, -1) });
  });

  await page.reload();

  /* ---------- 3. 残高が出ず、失敗が示されること ---------- */
  const failure = page.getByText("データを読み込めませんでした");
  await expect(failure).toBeVisible({ timeout: 60_000 });

  /* **部分的なデータで計算した残高を出していない** */
  await expect(page.getByText("現預金 見込み")).toHaveCount(0);
  await expect(page.getByText("今後90日の資金繰り")).toHaveCount(0);

  /* 再試行の導線 */
  await expect(page.getByRole("button", { name: "もう一度読み込む" })).toBeVisible();

  /* ---------- 4. 通信の失敗ではなく件数の不一致であること ---------- */
  const detail = (await page.locator("p.break-words").textContent()) ?? "";
  const numbers = detail.match(/(\d[\d,]*)件のうち(\d[\d,]*)件/);

  report([
    ["横取りしたページ数", droppedFrom],
    ["HTTP ステータス", statuses.join(", ") || "(無し)"],
    ["画面に出た文言", detail.trim()],
    ["総件数", numbers ? numbers[1] : "(読めない)"],
    ["受け取った件数", numbers ? numbers[2] : "(読めない)"],
  ]);

  /* **通信は成功している。** 失敗していたら、確かめたい経路を通って
     いない（§9.1 の5つ目） */
  expect(statuses.length).toBeGreaterThan(0);
  for (const status of statuses) {
    expect(status, "応答が失敗している。件数の不一致ではなく通信の失敗になっている").toBeLessThan(400);
  }

  /* **件数の不一致として検知されている。** 文言が
     `IncompleteLoadError` のものであること */
  expect(detail).toContain("読み込みが不完全です");
  expect(numbers, `件数が文言に出ていない: ${detail}`).not.toBeNull();

  const expected = Number(numbers![1].replace(/,/g, ""));
  const received = Number(numbers![2].replace(/,/g, ""));

  /**
   * **落とした数と、足りない数は一致しない。**
   *
   * `fetchAll` は「受け取った件数ぶんだけ」次の開始位置を進める。1行
   * 落とすと次の範囲が1つ手前から始まるので、**前のページで落とした行が
   * 次のページで拾い直される。** 最後の1行だけが戻ってこない。
   *
   * | ページ | 要求 | 返った | 落とした後 | 累計 |
   * |---|---|---|---|---|
   * | 0 | 0-999 | 1000 | 999 | 999 |
   * | 1 | 999-1998 | 1000 | 999 | 1998 |
   * | 2 | 1998-2997 | 1000 | 999 | 2997 |
   * | 3 | 2997-3996 | 3 | 2 | 2999 |
   * | 4 | 2999-3998 | 1 | 0 | 2999（打ち切り） |
   *
   * なので「落とした数ぶん少ない」とは書けない。**書けることは
   * 「足りない」ことと、「落とした数より多くは失っていない」こと。**
   */
  expect(expected).toBe(3_000);
  expect(received, "件数が一致してしまっている。不一致を作れていない").toBeLessThan(expected);
  expect(received, "落とした数より多く失っている。横取りが壊している").toBeGreaterThanOrEqual(
    expected - droppedFrom,
  );
  /**
   * 0件ではないこと。
   *
   * **このアサーションを減らさないこと。** 全部失った状態（0件）は、
   * 通信がまるごと失敗したときと区別がつかない。0件を許すと、
   * 「件数の不一致を確かめたつもりで通信の失敗を確かめていた」という
   * これまでの誤りに戻る（§9.1 の5つ目）。
   */
  expect(received, "0件。通信の失敗と区別がつかない").toBeGreaterThan(0);

  /* ---------- 5. 横取りをやめれば直ること ---------- */
  await page.unroute(/\/rest\/v1\/actuals\?/);
  await page.getByRole("button", { name: "もう一度読み込む" }).click();

  await expect(page.getByText("現預金 見込み")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("データを読み込めませんでした")).toHaveCount(0);
});
