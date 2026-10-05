/**
 * 負荷試験データの投入
 *
 *     pnpm loadtest:seed                       3,000件 / 550日（v1.0 の目標値）
 *     pnpm loadtest:seed -- --rows=3000 --span=90    ページング用
 *     pnpm loadtest:seed -- --rows=24000 --span=4400 v1.5 の目標値
 *
 * **本人セッションで入れる。** RLS があるので、負荷試験アカウント以外の
 * 行には触れない（client.ts）。
 *
 * ## 測りたい差が出るデータにする（CLAUDE.md §2.11）
 *
 * - **定期項目を0件にしない。** 実績だけ入れても CL-1 の展開も FR-46 の
 *   候補照合も FR-43 の未消し込み件数も空振りする
 * - **振替は口座ごとに相殺させない。** 合計が0になる組み合わせにすると、
 *   口座別の付け替えが1円も動かず、正しい実装でも効果が見えない
 * - **実績はすべて `plan_key = null`（未判定）。** 候補照合を総当たりで
 *   通すため
 */

import { addDays, arg, fail, signInAsLoadtest } from "./client.ts";

const AS_OF = "2026-01-01";

/* 口座 id は固定。teardown と突き合わせられるようにする */
const SEIKATSU = "11111111-1111-4111-8111-111111111111";
const JIGYOU = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";

/** PostgREST の1リクエストあたりの行数。大きすぎると落ちる */
const CHUNK = 500;

const uuid = (prefix: string, i: number) =>
  `${prefix}-${String(i).padStart(12, "0")}`;

async function main(): Promise<void> {
  const rows = arg("rows", 3000);
  const span = arg("span", 550);

  const { supabase, userId, email } = await signInAsLoadtest();
  console.log(`投入先 ${email}`);
  console.log(`実績 ${rows.toLocaleString()}件 / ${span}日 / 基準日 ${AS_OF}`);

  const check = async (label: string, error: { message: string } | null) => {
    if (error) fail(`${label}: ${error.message}`);
  };

  /* ---------- 設定 ---------- */
  await check(
    "settings",
    (
      await supabase
        .from("settings")
        .upsert({ user_id: userId, as_of: AS_OF, reserve_line: 600_000 })
    ).error,
  );

  /* ---------- 口座2つとカード1枚 ---------- */
  await check(
    "accounts",
    (
      await supabase.from("accounts").upsert([
        { id: SEIKATSU, user_id: userId, name: "負荷試験 生活口座", kind: "bank", balance: 1_200_000, unbilled_balance: 0 },
        { id: JIGYOU, user_id: userId, name: "負荷試験 事業口座", kind: "bank", balance: 3_400_000, unbilled_balance: 0 },
        {
          id: CARD, user_id: userId, name: "負荷試験 カード", kind: "card",
          balance: 0, unbilled_balance: 0,
          closing_day: 15, pay_month_offset: 1, pay_day: 10,
          settle_account_id: JIGYOU,
        },
      ])
    ).error,
  );

  /* ---------- 定期項目50件（うち振替3件） ---------- */
  const recurring = Array.from({ length: 50 }, (_, k) => {
    const i = k + 1;
    /* 振替3件。**口座ごとに相殺しない金額にする**（§2.11）。
       生活 → 事業 が 60,000 + 30,000、事業 → 生活 が 80,000。
       どちらの口座も純額が0にならない */
    if (i === 11) return trf(i, 60_000, SEIKATSU, JIGYOU);
    if (i === 22) return trf(i, 80_000, JIGYOU, SEIKATSU);
    if (i === 33) return trf(i, 30_000, SEIKATSU, JIGYOU);

    const income = i % 10 === 0;
    return {
      id: uuid("44444444-4444-4444-8444", i),
      user_id: userId,
      name: `負荷試験 定期 ${i}`,
      type: income ? "income" : "expense",
      cost_type: income ? null : i % 3 === 0 ? "fixed" : "variable",
      category_code: income
        ? "INC-01"
        : i % 3 === 0 ? "EXP-01" : i % 7 === 0 ? "EXP-03" : i % 5 === 0 ? "EXP-02" : "EXP-21",
      amount: income ? 400_000 + i * 1_000 : 3_000 + i * 700,
      biz_ratio: i % 4 === 0 ? 100 : i % 6 === 0 ? 40 : 0,
      account_id: i % 11 === 0 ? CARD : i % 4 === 0 ? JIGYOU : SEIKATSU,
      to_account_id: null,
      day: (i % 28) + 1,
      months: null,
      active: true,
    };
  });

  function trf(i: number, amount: number, from: string, to: string) {
    return {
      id: uuid("44444444-4444-4444-8444", i),
      user_id: userId,
      name: `負荷試験 振替 ${i}`,
      type: "transfer",
      cost_type: null,
      category_code: "TRF-01",
      amount,
      biz_ratio: 0,
      account_id: from,
      to_account_id: to,
      day: (i % 28) + 1,
      months: null,
      active: true,
    };
  }

  await check("recurring_items", (await supabase.from("recurring_items").upsert(recurring)).error);

  /* ---------- 単発予定40件 ---------- */
  const oneoffs = Array.from({ length: 40 }, (_, k) => {
    const i = k + 1;
    const income = i % 8 === 0;
    return {
      id: uuid("55555555-5555-4555-8555", i),
      user_id: userId,
      date: addDays(AS_OF, i * 9),
      name: `負荷試験 単発 ${i}`,
      type: income ? "income" : "expense",
      cost_type: income ? null : "variable",
      category_code: income ? "INC-02" : "EXP-21",
      amount: income ? 150_000 + i * 2_000 : 8_000 + i * 1_300,
      biz_ratio: i % 5 === 0 ? 100 : 0,
      account_id: i % 3 === 0 ? JIGYOU : SEIKATSU,
      to_account_id: null,
    };
  });
  await check("oneoff_items", (await supabase.from("oneoff_items").upsert(oneoffs)).error);

  /* ---------- オーバーライド40件（FR-07） ----------
   *
   * **AC-34 の「全テーブルで並び替えキーが一意」を、このテーブルで実際に
   * 試せる状態にするために入れる。** `overrides` だけが並び替えキーに
   * `plan_key`（text）を使う。ほかの4テーブルは `id`（uuid）である。
   * 0件のまま通しても何も確かめていない（要件定義書 §9.1）。
   *
   * `plan_key` は CL-1 が展開する予定インスタンスのキー。形式は AC-50 が
   * 直書きのテストで固定しているので、ここで組み立てる。
   * **`forecast.ts` から import できない**（`./date` を拡張子なしで
   * import しているため Node が解決できない）。形式を変えるときは
   * AC-50 のテストが落ちるので、そのときここも直す。
   *
   * **同じ plan_key が2件できない組み合わせを選ぶ。** そこが一意性の
   * 確認対象なので、作る側が重複を作ってしまうと検査にならない。
   * 定期項目 1〜20 × 2ヶ月 = 40件で、(id, 発生日) の組が重複しない。
   */
  const planKey = (recurringIndex: number, date: string) =>
    `r:${uuid("44444444-4444-4444-8444", recurringIndex)}:${date}`;

  const overrides = [2026 * 12 + 2, 2026 * 12 + 5].flatMap((ym) =>
    Array.from({ length: 20 }, (_, k) => {
      const i = k + 1;
      const month = `${Math.floor(ym / 12)}-${String((ym % 12) + 1).padStart(2, "0")}`;
      const day = String((i % 28) + 1).padStart(2, "0");
      const occursOn = `${month}-${day}`;

      /* **繰延と金額変更の両方を入れる。** 片方だけだと形が偏る */
      const deferral = i % 2 === 0;
      return {
        user_id: userId,
        plan_key: planKey(i, occursOn),
        date: deferral ? addDays(occursOn, 5) : null,
        amount: deferral ? null : 1_000 + i * 137,
        skipped: null,
        note: deferral ? `負荷試験 繰延 ${i}` : null,
      };
    }),
  );

  await check("overrides", (await supabase.from("overrides").upsert(overrides)).error);

  const uniqueKeys = new Set(overrides.map((o) => o.plan_key));
  if (uniqueKeys.size !== overrides.length) {
    fail(
      `作った plan_key が重複しています（${overrides.length}件中 ${uniqueKeys.size}種）。` +
        `一意性を確かめる側が重複を作っては検査にならない`,
    );
  }

  /* ---------- 実績 ---------- */
  const actuals = Array.from({ length: rows }, (_, i) => {
    const income = i % 20 === 0;
    return {
      id: uuid("66666666-6666-4666-8666", i),
      user_id: userId,
      plan_key: null,                       // 全件が未判定（§2.11）
      date: addDays(AS_OF, Math.floor((i * span) / rows)),
      name: `負荷試験 ${i}`,
      type: income ? "income" : "expense",
      cost_type: income ? null : i % 5 === 0 ? "fixed" : "variable",
      category_code: income
        ? "INC-01"
        : i % 5 === 0 ? "EXP-01" : i % 7 === 0 ? "EXP-02" : i % 11 === 0 ? "EXP-03" : "EXP-21",
      amount: income ? 300_000 + (i % 50) * 1_000 : 500 + (i % 9_000),
      biz_ratio: i % 3 === 0 ? 100 : 0,
      account_id: i % 3 === 1 ? CARD : i % 3 === 2 ? JIGYOU : SEIKATSU,
      to_account_id: null,
    };
  });

  for (let at = 0; at < actuals.length; at += CHUNK) {
    const slice = actuals.slice(at, at + CHUNK);
    await check(`actuals[${at}]`, (await supabase.from("actuals").upsert(slice)).error);
    process.stdout.write(`\r  実績 ${Math.min(at + CHUNK, actuals.length)} / ${actuals.length}`);
  }
  console.log("");

  /* ---------- 入ったことを数える ---------- */
  const count = async (table: string) =>
    (await supabase.from(table).select("*", { count: "exact", head: true })).count;

  const months = new Set(actuals.map((a) => a.date.slice(0, 7)));
  const perMonth = Math.round(actuals.length / months.size);

  console.log("");
  console.log("投入結果");
  console.log(`  実績           ${await count("actuals")}`);
  console.log(`  オーバーライド ${await count("overrides")}（繰延20・金額変更20）`);
  console.log(`  定期項目       ${await count("recurring_items")}（うち振替3）`);
  console.log(`  単発予定       ${await count("oneoff_items")}`);
  console.log(`  口座           ${await count("accounts")}`);
  console.log(`  期間           ${actuals[0].date} 〜 ${actuals.at(-1)!.date}（${months.size}ヶ月）`);
  console.log(`  1ヶ月あたり    約${perMonth}件`);
  console.log("");
  console.log("測りたい差が出るか（CLAUDE.md §2.11）");
  console.log(`  分割取得（1,000件）  ${actuals.length > 1000 ? `通る（${Math.ceil(actuals.length / 1000)}ページ）` : "**通らない**"}`);
  console.log(`  月内ページング（200件）  ${perMonth > 200 ? "通る" : `**通らない**（--span を小さくする）`}`);
  console.log(`  振替の純額  生活 ${-60_000 + 80_000 - 30_000} / 事業 ${60_000 - 80_000 + 30_000}（どちらも0でない）`);
  console.log(`  overrides の行  ${await count("overrides")}件（0件だと並び替えキーの一意性を試せない。§9.1）`);
}

await main();
