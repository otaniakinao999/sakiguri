/**
 * AC-58b 金額の符号が、その行の残高の動きと一致する
 *
 * > **金額の符号が、その行の残高の動きと一致すること。** 片側の明細から
 * > 記録した振替の出金行に `−` が付き、入金行に `+` が付くこと。
 * > **合計の中で閉じる振替（`type = transfer`）には符号が付かないこと。**
 * > 実績の一覧で、出金の振替と入金の振替が見分けられること。
 * > **符号を付けても費用の色にしないこと**（符号は残高の向き、色は費目）。
 * > この規則が1箇所にあること（§3.3 全体に効く原則・§2.8）
 *
 * ## なぜ実機で要るか
 *
 * この欠陥は**画面を見て初めて見つかった。** 単体テストは「振替は
 * neutral」を正しく守っていて、全部通っていた。隣の残高列と食い違って
 * いることは、2つを並べて見るまで分からない（§2.12）。
 *
 * dev の画面（認証の外、フィクスチャ）では確認済み。ここで見るのは
 * **本番ビルドが、本番の DB から読んだ行で同じになること。**
 *
 * ## 空振りを避ける形（CLAUDE.md §2.11）
 *
 * | 空振りする形 | ここで使う形 |
 * |---|---|
 * | 片側だけ置く | **3種類を同じ表に出す。** `−` と `+` と符号なしが1画面に並ぶ。片方だけだと「全部に符号を付ける実装」と区別できない |
 * | 符号だけ見る | **色も見る。** 符号を付けたついでに費用の色にしていないか |
 * | 範囲の使い分けを見ない | **カード払いは、実績一覧で符号を持ち、入出金予定表には行として出ない**（CL-2 が引落にまとめる）。両方を見る |
 *
 * 前提：負荷試験アカウントに次の行が入っていること。
 *
 * | 日付 | 内容 | 形 |
 * |---|---|---|
 * | 11/5 | B信金へ移動 77,777 | 支出 ＋ TRF-01（片側記録の出金側） |
 * | 11/5 | A銀行から移動 77,777 | 収入 ＋ TRF-01（片側記録の入金側） |
 * | 11/6 | A銀行からB信金へ振替 55,555 | `type = transfer`（合計の中で閉じる） |
 * | 11/7 | サブスク（カード）12,345 | カード口座の支出 |
 * | 11/8 | 予定 サブスク（カード）23,456 | カード払いの予定（やること） |
 * | 11/9 | 予定 A銀行からB信金へ振替 33,333 | 閉じる振替の予定（やること） |
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { report, signIn } from "./support.ts";

/** 符号なしのスペース（U+2212 は `−`、U+FF0B ではなく ASCII の `+`） */
const MINUS = "−";

/**
 * その行の金額の、文字列と色。
 *
 * **色は `Amount` が付けるクラスから読む。** 「赤くなっていないか」は
 * 文字列からは分からない（CLAUDE.md §2.6 のトークン）。
 */
async function amountOf(row: Locator): Promise<{ text: string; tone: string }> {
  /* **`Amount` は `num text-right`。** `span.num` だけで引くと、
     TodoRow の日付（`num w-48`）が先に当たる */
  const amount = row.locator("span.num.text-right").first();
  const text = ((await amount.textContent()) ?? "").trim();
  const className = (await amount.getAttribute("class")) ?? "";
  const tone =
    className.match(/text-fg-(success|destructive)/)?.[0] ??
    (className.includes("text-foreground") ? "text-foreground" : "(不明)");
  return { text, tone };
}

/** 画面の行を内容で引く */
function rowOf(page: Page, title: string): Locator {
  return page.locator("tr", { hasText: title }).first();
}

test("符号は残高の動きと一致し、閉じる振替には付かない", async ({ page }) => {
  await signIn(page);

  /* ---------- 1. 入出金予定表（3種類を同じ表で見る） ---------- */
  await page.goto("/cashflow");
  await expect(page.getByText("月次資金繰り表")).toBeVisible({ timeout: 60_000 });

  /* 11月を含む期間を出す。既定は「先月〜6ヶ月」なので入っている */
  const out = rowOf(page, "B信金へ移動");
  const into = rowOf(page, "A銀行から移動");
  const closed = rowOf(page, "A銀行からB信金へ振替");

  await expect(out).toBeVisible({ timeout: 60_000 });
  await expect(into).toBeVisible();
  await expect(closed).toBeVisible();

  const ledger = {
    out: await amountOf(out),
    into: await amountOf(into),
    closed: await amountOf(closed),
  };

  /* **同じ表の中で3通りに割れること。** これが本体 */
  expect(ledger.out.text).toBe(`${MINUS}¥77,777`);
  expect(ledger.into.text).toBe("+¥77,777");
  expect(ledger.closed.text).toBe("¥55,555");

  /* 符号を付けても色は費目のまま（振替は既定色） */
  expect(ledger.out.tone).toBe("text-foreground");
  expect(ledger.into.tone).toBe("text-foreground");
  expect(ledger.closed.tone).toBe("text-foreground");

  /* 残高の動きと向きが一致していること。**隣の残高列を読む** ――
     符号だけ見ると、符号と残高が逆の実装でも通る */
  /* 残高の列は色を付けないので `Amount` ではない（`td.num` の素のテキスト）。
     0番目は日付の列 */
  const balanceOf = async (row: Locator) =>
    ((await row.locator("td.num").nth(1).textContent()) ?? "").trim();
  const balances = {
    out: await balanceOf(out),
    into: await balanceOf(into),
    closed: await balanceOf(closed),
  };

  /* ---------- 2. カード払いは引落にまとまる（範囲の使い分け） ---------- */
  /**
   * **入出金予定表にカード利用の行は出ない。** CL-2 が締め日ごとに
   * 引落1件へまとめるので、明細に出るのは引落の行である。
   * ここで見るのは「カード利用の行に符号が付いていない」ではなく
   * **「行として出ない」**こと ―― 出ていたら、現金イベント化を通って
   * いない。
   */
  await expect(page.locator("tr", { hasText: "サブスク（カード）" })).toHaveCount(0);
  const settle = rowOf(page, "負荷試験 カード 引落");
  await expect(settle).toBeVisible();
  const settleAmount = await amountOf(settle);
  /* 引落は現預金から出るので `−`。費目は「カード引落」で色は費用 */
  expect(settleAmount.text.startsWith(MINUS)).toBe(true);

  /* ---------- 3. 実績の一覧（出金の振替と入金の振替を見分ける） ---------- */
  await page.goto("/entry");
  await expect(page.getByText("実績一覧")).toBeVisible({ timeout: 60_000 });

  /**
   * 一覧の行（TodoRow）。**内容の文字そのものから親に上がる。**
   * クラス名で引くとデザインの変更で黙って当たらなくなる（0件でも
   * `toHaveCount(0)` 系は通ってしまう）。`exact` にして
   * 「サブスク（カード）」と「予定 サブスク（カード）」を分ける。
   */
  const listRow = (title: string) =>
    page.getByText(title, { exact: true }).locator("xpath=..");

  const entryOut = await amountOf(listRow("B信金へ移動"));
  const entryIn = await amountOf(listRow("A銀行から移動"));
  const entryClosed = await amountOf(listRow("A銀行からB信金へ振替"));
  const entryCard = await amountOf(listRow("サブスク（カード）"));

  /* **同じ額・同じ区分・同じ色で、符号だけが割れる。** 報告した欠陥
     （どちらも `¥77,777` と出て区別できなかった）そのもの */
  expect(entryOut.text).toBe(`${MINUS}¥77,777`);
  expect(entryIn.text).toBe("+¥77,777");
  expect(entryOut.tone).toBe(entryIn.tone);
  expect(entryClosed.text).toBe("¥55,555");

  /* **カード払いは符号を持つ。** 実績一覧の範囲はカードを含む ――
     現預金だけで足すと、この行の delta が0になって符号を失う */
  expect(entryCard.text).toBe(`${MINUS}¥12,345`);

  /* ---------- 4. やること（予定の行。別の経路） ---------- */
  const todoCard = await amountOf(listRow("予定 サブスク（カード）"));
  const todoClosed = await amountOf(listRow("予定 A銀行からB信金へ振替"));
  expect(todoCard.text).toBe(`${MINUS}¥23,456`);
  expect(todoClosed.text).toBe("¥33,333");

  /* ---------- 5. ダッシュボードのやること（さらに別の経路） ---------- */
  /**
   * **3画面を見る。** 符号の規則はもともと3箇所に別々に書かれていた
   * （`cashflow-view-model` / `entry-view-model` / `dashboard-view-model`）。
   * 1箇所に畳んだことは、3つとも見て初めて言える（§2.8）。
   */
  await page.goto("/");
  await expect(page.getByText("口座・カード")).toBeVisible({ timeout: 60_000 });
  const dashCard = await amountOf(listRow("予定 サブスク（カード）"));
  const dashClosed = await amountOf(listRow("予定 A銀行からB信金へ振替"));
  expect(dashCard.text).toBe(`${MINUS}¥23,456`);
  expect(dashClosed.text).toBe("¥33,333");

  report([
    ["入出金予定表 出金側", `${ledger.out.text}  残高 ${balances.out}  ${ledger.out.tone}`],
    ["入出金予定表 入金側", `${ledger.into.text}  残高 ${balances.into}  ${ledger.into.tone}`],
    ["入出金予定表 閉じる振替", `${ledger.closed.text}  残高 ${balances.closed}  ${ledger.closed.tone}`],
    ["入出金予定表 カード利用の行", "出ない（引落にまとまる）"],
    ["入出金予定表 カード引落", `${settleAmount.text}  ${settleAmount.tone}`],
    ["実績一覧 出金側 / 入金側", `${entryOut.text} / ${entryIn.text}（色は同じ ${entryOut.tone}）`],
    ["実績一覧 閉じる振替", entryClosed.text],
    ["実績一覧 カード払い", `${entryCard.text}  ${entryCard.tone}`],
    ["やること（実績入力）", `${todoCard.text} / ${todoClosed.text}`],
    ["やること（ダッシュボード）", `${dashCard.text} / ${dashClosed.text}`],
  ]);
});
