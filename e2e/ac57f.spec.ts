/**
 * AC-57f 当たる条件が同じルールを2つ持てない
 *
 * > **当たる条件が同じルールを2つ持てないこと。** `(pattern, accountId,
 * > direction)` が一意であること。**null どうしも同じとみなすこと**
 * > （PostgreSQL の既定では null は互いに異なる）。設定画面で `pattern` を
 * > 打ち替えて衝突させたとき、**保存の前に知らせること**（§3.2 ImportRule）
 *
 * ## なぜ実機で要るか
 *
 * **ここは2つの機構が同じことを守っている。**
 *
 * | | |
 * |---|---|
 * | 画面 | `ruleConflict` が保存の前に知らせる（DBのエラーを出さない） |
 * | DB | `(user_id, pattern, account_id, direction)` の一意索引（`nulls not distinct`） |
 *
 * 単体テストで測れるのは画面側だけで、**DBが実際に弾くところは
 * 測れていなかった。** 索引は貼ったが、「貼ったこと」と「弾くこと」は
 * 別である（§9.1）。片方が働いていれば重複は入らないので、**どちらが
 * 働いているのかは、両方を別々に試さないと分からない。**
 *
 * ## 空振りを避ける形（CLAUDE.md §2.11）
 *
 * | 空振りする形 | ここで使う形 |
 * |---|---|
 * | 両方に口座が入った組み合わせで測る | **`account_id` が null どうし**で測る。`nulls not distinct` が無い実装でも通ってしまう |
 * | 弾かれる側だけ見る | **通る側も見る。** 口座を1つに限れば保存できること ―― 「何をしても保存できない」状態と区別できない |
 * | 画面だけ見る | **DBに直接 insert して 23505 を見る。** 画面を直すだけで通る状態と区別できない |
 *
 * 前提：負荷試験アカウントに口座が3つあること。ルールは0件から始める。
 */

import { expect, test } from "@playwright/test";

import { env, report, signIn } from "./support.ts";

/** 重複の一意制約違反。PostgreSQL の `unique_violation` */
const UNIQUE_VIOLATION = "23505";

const PATTERN = "ﾃｽﾄ ﾆﾝｲｾｲ";

test("同じ条件のルールは、画面が保存の前に止める。DBも弾く", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");

  const panel = page.getByText("CSV取込の仕分けルール");
  await expect(panel).toBeVisible({ timeout: 60_000 });

  /* ---------- 0. 前提：0件から始める ---------- */
  /**
   * **残っていたら測れない。** 前回の行が当たる状態で「衝突した」と
   * 言っても、どのルールと衝突したのか分からない。
   */
  const titleOf = async () => (await panel.textContent()) ?? "";
  const countOf = async () => Number((await titleOf()).match(/（(\d+)件）/)?.[1] ?? -1);

  while ((await countOf()) > 0) {
    await page.getByRole("button", { name: "削除" }).first().click();
    await expect(page.getByText("保存しました")).toBeVisible({ timeout: 30_000 });
  }
  expect(await countOf()).toBe(0);

  /* ---------- 1. 1件目を作る（口座は「すべての口座」＝ null） ---------- */
  await page.getByRole("button", { name: "ルールを足す" }).click();
  await page.getByLabel("新しいルールの摘要").fill(PATTERN);
  /* 口座は既定の「すべての口座」のまま。**ここが null であること**が、
     この検査の肝である */
  await expect(page.getByLabel("新しいルールの口座")).toHaveValue("");
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("保存しました")).toBeVisible({ timeout: 30_000 });
  expect(await countOf()).toBe(1);

  /* ---------- 2. 同じ条件で2件目（画面が止めること） ---------- */
  await page.getByRole("button", { name: "ルールを足す" }).click();
  await page.getByLabel("新しいルールの摘要").fill(PATTERN);
  await expect(page.getByLabel("新しいルールの口座")).toHaveValue("");

  const warning = page.getByText("当たる条件が同じルールが既にあります");
  await expect(warning).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

  /* **DBのエラーが出ていないこと。** 画面の警告だけで止まっている */
  await expect(page.getByText("保存できませんでした")).toHaveCount(0);
  expect(await countOf()).toBe(1);

  /* ---------- 3. 通る側も見る（口座を限れば保存できる） ---------- */
  /**
   * **この段階を減らさないこと。** 弾かれることだけを見ると、
   * 「何をしても保存できない」状態でも通る（§9.1 の6つ目）。
   * 口座を1つに限ると当たる条件が変わるので、保存できるのが正しい。
   */
  const accountSelect = page.getByLabel("新しいルールの口座");
  const firstAccount = (await accountSelect.locator("option").nth(1).getAttribute("value")) ?? "";
  expect(firstAccount).not.toBe("");
  await accountSelect.selectOption(firstAccount);

  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("保存しました")).toBeVisible({ timeout: 30_000 });
  expect(await countOf()).toBe(2);

  /* ---------- 4. 打ち替えで衝突させる（既にある行を直す経路） ---------- */
  /**
   * 2件目の口座を「すべての口座」に戻すと、1件目と同じ条件になる。
   * **保存の前に知らせ、値を元に戻すこと**（ADR-0027）。
   */
  const rowAccount = page.getByLabel("口座", { exact: true }).last();
  await rowAccount.selectOption("");

  await expect(page.getByText("当たる条件が同じルールが既にあります")).toBeVisible();
  await expect(page.getByText("保存できませんでした")).toHaveCount(0);
  /* **値が戻っていること。** 通らなかった変更を画面に残さない */
  await expect(rowAccount).toHaveValue(firstAccount);
  expect(await countOf()).toBe(2);

  /* ---------- 5. DBが弾くこと（`account_id` が null どうし） ---------- */
  /**
   * **画面を通さずに insert する。** 画面の判定を消しても通る状態
   * （＝DBが守っていない状態）と区別するため。
   *
   * `pattern` は1件目と同じ、`account_id` は null。**ここが
   * `nulls not distinct` の有無で割れる。**
   */
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const auth = await supabase.auth.signInWithPassword({
    email: env("LOADTEST_EMAIL"),
    password: env("LOADTEST_PASSWORD"),
  });
  if (auth.error) throw new Error(`サインイン: ${auth.error.message}`);

  const duplicate = await supabase.from("import_rules").insert({
    id: "dddddddd-0000-4000-8000-00000000000f",
    user_id: auth.data.user.id,
    pattern: PATTERN,
    account_id: null,
    direction: null,
    category_code: "EXP-20",
    cost_type: "variable",
    biz_ratio: 0,
  });

  /* 入ってしまったら、その行を残さない（後片付けは teardown だが、
     この検査の失敗で本番に重複を置いたままにしない） */
  if (!duplicate.error) {
    await supabase
      .from("import_rules")
      .delete()
      .eq("id", "dddddddd-0000-4000-8000-00000000000f");
  }

  const okOther = await supabase.from("import_rules").insert({
    id: "dddddddd-0000-4000-8000-0000000000aa",
    user_id: auth.data.user.id,
    pattern: `${PATTERN} ﾍﾞﾂ`,
    account_id: null,
    direction: null,
    category_code: "EXP-20",
    cost_type: "variable",
    biz_ratio: 0,
  });

  report([
    ["ルールの件数（画面）", await countOf()],
    ["同じ条件の insert", duplicate.error ? `${duplicate.error.code} ${duplicate.error.message}` : "通ってしまった"],
    ["条件の違う insert", okOther.error ? `${okOther.error.code} ${okOther.error.message}` : "通る（正しい）"],
  ]);

  /* **null どうしでも弾かれること。** これが見たかった1点 */
  expect(duplicate.error?.code, "同じ条件の行が insert できてしまった").toBe(
    UNIQUE_VIOLATION,
  );
  /* **条件が違えば通ること。** 全部弾く状態と区別する */
  expect(okOther.error, "条件の違う行まで弾かれている").toBeNull();
});
