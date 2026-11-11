/**
 * AC-10 閉じて再度開いてもデータが残る
 *
 * > ブラウザを閉じて再度開いても、入力したデータが残っていること
 *
 * ## なぜ実機で要るか（これまでの確認との違い）
 *
 * これまでは**再読込で代用していた。** 再読込ではブラウザのプロセスも
 * タブも閉じないので、**「閉じて開く」で失われるものは失われない。**
 *
 * ここでは `launchPersistentContext` を使い、**ブラウザを本当に閉じて、
 * 同じプロファイルで開き直す。** `test` が配るページは使わない。
 *
 * ## 2つのことが同時に要る
 *
 * | | 壊れると何が起きるか |
 * |---|---|
 * | セッションが残る | 開き直すとサインイン画面に戻る。データは消えていないが利用者には同じこと |
 * | 変更が保存されている | 閉じる前の入力が消える。**保存は400msのデバウンス後**（FR-17） |
 *
 * **両方を見る。** サインインが残っているだけでは「データが残る」に
 * ならないし、保存されていてもサインアウトしていたら辿り着けない。
 *
 * 前提：`pnpm loadtest:seed -- --empty --as-of=today`
 */

import { chromium, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { env, expectBalanceShown, report } from "./support.ts";

/** 保存のデバウンス（FR-17）。余裕を持って待つ */
const SAVE_DEBOUNCE_MS = 400;

test("ブラウザを閉じて開き直しても、サインインと入力が残る", async ({ baseURL }) => {
  const profile = mkdtempSync(join(tmpdir(), "sakiguri-ac10-"));
  /* 毎回違う値にする。前回の残りを「残った」と読み違えない */
  const marker = 123_000 + (Date.now() % 1000) * 7;

  let signedInAfterReopen = false;
  let valueAfterReopen = "";
  let before = "";

  try {
    /* ---------- 1回目。サインインして値を変える ---------- */
    const first = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await first.newPage();

    await page.goto(`${baseURL}/`);
    await page.getByLabel("メールアドレス").fill(env("LOADTEST_EMAIL"));
    await page.getByLabel("パスワード").fill(env("LOADTEST_PASSWORD"));
    await page.getByRole("button", { name: "サインイン" }).click();
    /* **残高が出るまで待つ。** 1280 では Hero の金額が残高の出しどころ
       （`support.ts` の `dashboardBalance`） */
    await expectBalanceShown(page);

    await page.goto(`${baseURL}/settings`);

    /**
     * 生活防衛ラインの欄。
     *
     * **v0.6.0 で「変更」を押すまで入力欄が出なくなった**（普段は
     * 金額が文字で出ているだけ。`SettingsScreen.tsx` の `editReserve`）。
     * それまでは `getByLabel` で直に引けていた。
     *
     * **パネルの見出しと区別するため `exact` にする**
     * （見出しは「基準日と生活防衛ライン」）。「変更」は基準日にも
     * あるので、**ラベルから親に上がってその欄の中だけを見る。**
     */
    const block = page
      .getByText("生活防衛ライン", { exact: true })
      .locator("xpath=..");
    await expect(block).toBeVisible({ timeout: 30_000 });
    /* 入れる前の表示を控えておく。**変わらない値を「残った」と
       読み違えないため**（marker は毎回違うが、側からも見ておく） */
    before = ((await block.locator("span.num").textContent()) ?? "").trim();

    await block.getByRole("button", { name: "変更" }).click();
    const field = block.getByLabel("生活防衛ライン");
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(String(marker));
    await field.blur();

    /* デバウンス後の保存が届くまで待つ。**ここを待たずに閉じると
       消えるが、それは AC-10 ではなく保存の競合の話** */
    await page.waitForTimeout(SAVE_DEBOUNCE_MS * 5);

    /* **本当に閉じる。** 再読込ではない */
    await first.close();

    /* ---------- 2回目。同じプロファイルで開き直す ---------- */
    const second = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const reopened = await second.newPage();
    await reopened.goto(`${baseURL}/settings`);

    /* サインイン画面に戻っていないこと */
    signedInAfterReopen =
      (await reopened.getByLabel("パスワード").count()) === 0;

    if (signedInAfterReopen) {
      /* **表示されている金額を読む。** 入力欄の値でなく画面に出ている
         数字で見る ―― 利用者が「残っている」と判断するのはこちらである */
      const again = reopened
        .getByText("生活防衛ライン", { exact: true })
        .locator("xpath=..")
        .locator("span.num");
      await expect(again).toBeVisible({ timeout: 60_000 });
      valueAfterReopen = ((await again.textContent()) ?? "").replace(/[^\d]/g, "");
    }

    await second.close();
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }

  report([
    ["入れる前の表示", before || "(読めない)"],
    ["入れた値", marker.toLocaleString()],
    ["開き直したあとサインイン済み", signedInAfterReopen ? "はい" : "**いいえ**"],
    ["開き直したあとの値", valueAfterReopen || "(読めない)"],
  ]);

  /* **入れる前と違う値を入れていること。** 元から同じ値だったら
     「残った」が何も測らない（CLAUDE.md §2.11） */
  expect(
    before.replace(/[^\d]/g, ""),
    "入れる前から同じ値だった。何も変えていない",
  ).not.toBe(String(marker));

  expect(
    signedInAfterReopen,
    "開き直したらサインイン画面に戻った。セッションが残っていない",
  ).toBe(true);
  expect(Number(valueAfterReopen), "入れた値が残っていない").toBe(marker);
});
