/**
 * AC-29a 消し込みが止まっている警告の起点
 *
 * > `lastReconciledAt` から**45日**を経過した場合に「消し込みが止まって
 * > いる」警告が出ること。`lastReconciledAt` が null のときは**基準日**を
 * > 起点とすること。**新規利用者が初日に警告を受けないこと**（FR-43）
 *
 * ## なぜ実機で要るか
 *
 * 3つ目の条項（新規利用者が初日に警告を受けない）は単体テストで固定して
 * あるが、**実機では基準日＝今日の状態を作っていなかった。**
 *
 * ## 両方の状態を見る（§9.1 の4つ目）
 *
 * 「警告が出ない」ことだけを見ると、**警告の仕組みが丸ごと壊れていても
 * 通る。** だから同じ画面で、基準日を45日より前にずらして**出ること**も
 * 見る。片方だけでは「出ない」の意味が決まらない。
 *
 * 前提：`pnpm loadtest:seed -- --empty --as-of=today`
 * （口座と設定だけ。実績も予定も無い＝新規利用者の初日と同じ状態）
 */

import { expect, test } from "@playwright/test";

import { report, setAsOf, signIn, ymd } from "./support.ts";

/** FR-43。`STALLED_DAYS` と同じ値 */
const STALLED_DAYS = 45;

const WARNING = /消し込みが(止まっています|行われていません)|まだ一度も/;

test("基準日が今日なら警告を出さない。45日を超えたら出す", async ({ page }) => {
  await signIn(page);

  /* ---------- 1. 新規利用者の初日。基準日＝今日 ---------- */
  await setAsOf(ymd(0));
  await page.goto("/");
  await expect(page.getByText("現預金 見込み")).toBeVisible({ timeout: 60_000 });

  const onDayOne = await page.getByText(WARNING).count();

  /* ---------- 2. 44日前。閾値のすぐ手前 ---------- */
  await setAsOf(ymd(-(STALLED_DAYS - 1)));
  await page.reload();
  await expect(page.getByText("現預金 見込み")).toBeVisible({ timeout: 60_000 });

  const justBefore = await page.getByText(WARNING).count();

  /* ---------- 3. 46日前。閾値を超えている ---------- */
  await setAsOf(ymd(-(STALLED_DAYS + 1)));
  await page.reload();
  await expect(page.getByText("現預金 見込み")).toBeVisible({ timeout: 60_000 });

  const afterThreshold = await page.getByText(WARNING).count();
  const text = afterThreshold
    ? ((await page.getByText(WARNING).first().textContent()) ?? "").trim()
    : "(出ていない)";

  report([
    ["基準日＝今日（初日）", `警告 ${onDayOne} 件`],
    [`基準日＝${STALLED_DAYS - 1}日前（閾値の手前）`, `警告 ${justBefore} 件`],
    [`基準日＝${STALLED_DAYS + 1}日前（閾値を超える）`, `警告 ${afterThreshold} 件`],
    ["出た文面", text],
  ]);

  /* 片付け。次の spec が今日の基準日を前提にしないように戻す */
  await setAsOf(ymd(0));

  /* **初日に出ないこと。** これが AC-29a の3つ目の条項 */
  expect(onDayOne, "新規利用者の初日に警告が出ている").toBe(0);

  /* 閾値の手前でも出ない */
  expect(justBefore, `${STALLED_DAYS - 1}日で警告が出ている`).toBe(0);

  /* **出るほうも見る。** 出ないことだけを見ると、仕組みが壊れていても
     通る（§9.1 の4つ目） */
  expect(
    afterThreshold,
    `${STALLED_DAYS + 1}日経っても警告が出ない。仕組みが動いていない`,
  ).toBeGreaterThan(0);

  /* 一度も消し込んでいないので「止まっている」ではない（AC-29c） */
  expect(text).toContain("まだ一度も");
});
