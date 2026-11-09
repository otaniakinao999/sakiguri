/**
 * 負荷試験データの投入
 *
 *     pnpm loadtest:seed                       3,000件 / 550日（v1.0 の目標値）
 *     pnpm loadtest:seed -- --rows=3000 --span=90    ページング用
 *     pnpm loadtest:seed -- --rows=24000 --span=4400 v1.5 の目標値
 *     pnpm loadtest:seed -- --settled=0              済みの単発予定を作らない
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
 * - **負荷試験の実績（`--rows` のぶん）はすべて `plan_key = null`（未判定）。**
 *   候補照合を総当たりで通すため
 * - **そのうえで、単発予定を消し込む実績を別に `--settled` 件つくる。**
 *   全件 `plan_key = null` だと AC-55（実績が付いた単発予定を隠す）が
 *   **対象行0件のまま全部通る**（§2.11 の3つ目の形）。隠す側と出す側の
 *   両方が非0になるよう、既定は 40件中 7件にしてある
 */

import { buildForecast, oneoffKey, recurringKey } from "../../src/core/forecast.ts";
import { forecastEnd } from "../../src/lib/period.ts";
import { addDays, arg, fail, signInAsLoadtest } from "./client.ts";

/** 基準日の既定。`--as-of=today` で今日にできる（AC-29a） */
const DEFAULT_AS_OF = "2026-01-01";

/** 今日の日付。CLAUDE.md §2.2（UTC 変換を伴う API を使わない） */
function todayStr(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `--as-of=2026-01-01` または `--as-of=today` */
function asOfArg(): string {
  const hit = process.argv.find((a) => a.startsWith("--as-of="));
  if (!hit) return DEFAULT_AS_OF;
  const value = hit.split("=")[1];
  if (value === "today") return todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`--as-of は YYYY-MM-DD か today を指定してください: ${hit}`);
  }
  return value;
}

/** `--empty` なら実績・定期・単発・変更を作らず、口座と設定だけ入れる */
const EMPTY = process.argv.includes("--empty");

/* 口座 id は固定。teardown と突き合わせられるようにする */
const SEIKATSU = "11111111-1111-4111-8111-111111111111";
const JIGYOU = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";

/** PostgREST の1リクエストあたりの行数。大きすぎると落ちる */
const CHUNK = 500;

const uuid = (prefix: string, i: number) =>
  `${prefix}-${String(i).padStart(12, "0")}`;

/** 単発予定の総数。`--settled` の上限でもある */
const ONEOFF_COUNT = 40;

/**
 * 実績を結ぶ単発予定の件数（AC-55）。
 *
 * **`arg()` を使わない。** あちらは0を弾くので `--settled=0` が通らない。
 * ここは0も意味のある指定（済みを作らない）なので、自前で読む。
 */
function settledArg(): number {
  const hit = process.argv.find((a) => a.startsWith("--settled="));
  if (!hit) return 7;
  const value = Number(hit.split("=")[1]);
  if (!Number.isInteger(value) || value < 0 || value > ONEOFF_COUNT) {
    fail(`--settled は 0〜${ONEOFF_COUNT} の整数で指定してください: ${hit}`);
  }
  return value;
}

async function main(): Promise<void> {
  const AS_OF = asOfArg();
  const rows = EMPTY ? 0 : arg("rows", 3000);
  const span = arg("span", 550);
  const SETTLED = EMPTY ? 0 : settledArg();

  const { supabase, userId, email } = await signInAsLoadtest();
  console.log(`投入先 ${email}`);
  console.log(
    EMPTY
      ? `**--empty**。口座と設定だけ作る（基準日 ${AS_OF}）`
      : `実績 ${rows.toLocaleString()}件 / ${span}日 / 基準日 ${AS_OF}`,
  );

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

  if (!EMPTY) {
    await check("recurring_items", (await supabase.from("recurring_items").upsert(recurring)).error);
  }

  /* ---------- 単発予定40件 ---------- */
  const oneoffs = Array.from({ length: ONEOFF_COUNT }, (_, k) => {
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
  if (!EMPTY) {
    await check("oneoff_items", (await supabase.from("oneoff_items").upsert(oneoffs)).error);
  }

  /* ---------- 単発予定を消し込む実績（AC-55） ----------
   *
   * **これが無いと AC-55 は対象行0件のまま全部通る。** `settledOneoffIds`
   * が空集合になるので、「隠す」も「隠した件数」も「0件の文言」も、
   * 壊れていても気づけない（§2.11 の3つ目の形）。
   *
   * **全件は消し込まない。** 全部済みにすると、今度は普通に並んだ表が
   * 一度も出ない。既定は 40件中 7件で、隠す側（7）と出す側（33）の
   * 両方を非0にする。
   *
   * 金額・日付・費目は**消し込み先の単発予定に合わせる。** 合わせないと
   * 予実の差が実在しない理由で出て、別の条項の計測を濁す。
   */
  const settledActuals = oneoffs.slice(0, SETTLED).map((plan, k) => ({
    id: uuid("77777777-7777-4777-8777", k + 1),
    user_id: userId,
    plan_key: oneoffKey(plan.id),
    date: plan.date,
    name: plan.name,
    type: plan.type,
    cost_type: plan.cost_type,
    category_code: plan.category_code,
    amount: plan.amount,
    biz_ratio: plan.biz_ratio,
    account_id: plan.account_id,
    to_account_id: null,
  }));

  /* **入れる前に、前回ぶんを消す。**
   *
   * `upsert` だけだと id が同じ行しか上書きされないので、**`--settled` は
   * 減る方向に効かない。** 7件入れたあとに `--settled=0` を流しても前の
   * 7件が残り、しかも投入結果は「0 / 40」と出る。**出力が事実と逆になる**
   * のがいちばん悪く、「試せない」と書いてあるのに実際は隠れている。
   * （2026-11-09 に本番で踏んだ）
   *
   * **投入先は `client.ts` で2段に固定されている**（`.env.local` の
   * `LOADTEST_EMAIL` と、**サインインが成立したあとのセッションの email**
   * の両方に `+loadtest` を要求する）。だからこの削除が実データの
   * アカウントに当たることはない。
   *
   * **id の形ではなく `plan_key` で消す。** 「`--settled` が作った行」を
   * id の形に埋めると、画面から消し込んだ実績が残って同じずれが出る。
   * 消したいのは「単発予定を消し込んでいる実績」そのもの。`--rows` の
   * ぶんは全件 `plan_key = null` なので当たらない。
   */
  if (!EMPTY) {
    await check(
      "actuals(settled) 前回ぶんの削除",
      (await supabase.from("actuals").delete().like("plan_key", "o:%")).error,
    );
  }

  if (!EMPTY && settledActuals.length > 0) {
    await check(
      "actuals(settled)",
      (await supabase.from("actuals").upsert(settledActuals)).error,
    );
  }

  /* ---------- オーバーライド40件（FR-07） ----------
   *
   * **AC-34 の「全テーブルで並び替えキーが一意」を、このテーブルで実際に
   * 試せる状態にするために入れる。** `overrides` だけが並び替えキーに
   * `plan_key`（text）を使う。ほかの4テーブルは `id`（uuid）である。
   * 0件のまま通しても何も確かめていない（要件定義書 §9.1）。
   *
   * `plan_key` は CL-1 が展開する予定インスタンスのキー。**本番の
   * `recurringKey` をそのまま呼ぶ。文字列を組み立てない。** 組み立てると、
   * 形式を変えたときに AC-50 のテストは落ちるがこのスクリプトは落ちず、
   * 古い形式のキーを作り続ける（CLAUDE.md §2.8）。
   *
   * **同じ plan_key が2件できない組み合わせを選ぶ。** そこが一意性の
   * 確認対象なので、作る側が重複を作ってしまうと検査にならない。
   * 定期項目 1〜20 × 2ヶ月 = 40件で、(id, 発生日) の組が重複しない。
   */
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
        plan_key: recurringKey(uuid("44444444-4444-4444-8444", i), occursOn),
        date: deferral ? addDays(occursOn, 5) : null,
        amount: deferral ? null : 1_000 + i * 137,
        skipped: null,
        note: deferral ? `負荷試験 繰延 ${i}` : null,
      };
    }),
  );

  if (!EMPTY) {
    await check("overrides", (await supabase.from("overrides").upsert(overrides)).error);
  }

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

  for (let at = 0; !EMPTY && at < actuals.length; at += CHUNK) {
    const slice = actuals.slice(at, at + CHUNK);
    await check(`actuals[${at}]`, (await supabase.from("actuals").upsert(slice)).error);
    process.stdout.write(`\r  実績 ${Math.min(at + CHUNK, actuals.length)} / ${actuals.length}`);
  }
  console.log("");

  /* ---------- 入ったことを数える ---------- */
  const count = async (table: string) =>
    (await supabase.from(table).select("*", { count: "exact", head: true })).count;

  const months = new Set(actuals.map((a) => a.date.slice(0, 7)));
  const perMonth = months.size ? Math.round(actuals.length / months.size) : 0;

  /* **投入したつもりの数ではなく、DB にある数を読む。**
   *
   * 前回ぶんが残っていたり、画面から消し込んだ実績があったりすると、
   * 「`--settled` 件だから N 件」は事実と食い違う。**実際にそれで
   * 「0 / 40」と出しながら7件隠れていた**（2026-11-09 に本番で踏んだ）。
   *
   * 上の削除で揃うはずだが、**揃っていることを出力に頼らせない。**
   * 出力が事実とずれると、次に測る人は画面ではなく出力を信じる。
   */
  const settledRows = EMPTY
    ? []
    : ((await supabase.from("actuals").select("plan_key").like("plan_key", "o:%"))
        .data ?? []);
  const settledKeys = new Set(settledRows.map((r) => r.plan_key as string));
  const settledCount = settledKeys.size;
  const oneoffRows = (await count("oneoff_items")) ?? 0;

  console.log("");
  console.log("投入結果");
  console.log(`  実績           ${await count("actuals")}`);
  console.log(`  オーバーライド ${await count("overrides")}（繰延20・金額変更20）`);
  console.log(`  定期項目       ${await count("recurring_items")}（うち振替3）`);
  console.log(`  単発予定       ${oneoffRows}（うち実績で消し込み済 ${settledCount}）`);
  console.log(`  口座           ${await count("accounts")}`);
  if (actuals.length > 0) {
    console.log(`  期間           ${actuals[0].date} 〜 ${actuals.at(-1)!.date}（${months.size}ヶ月）`);
    console.log(`  1ヶ月あたり    約${perMonth}件`);
  }
  /* **予定インスタンスを本番と同じ関数・同じ期間で数える**（AC-48）。
     「1,200件」は未消込の数であって、展開した総数ではない。
     消し込み済みを含めて掲げると §9.1 の3つ目を踏む */
  const to = forecastEnd(AS_OF);
  const forecast = EMPTY
    ? []
    : buildForecast({ recurring, oneoffs, overrides: {} } as never, AS_OF, to);
  /* 期間から外れた単発予定を数えないために、展開した結果と突き合わせる */
  const reconciled = forecast.filter((f) => settledKeys.has(f.key)).length;

  console.log("");
  console.log(`予定インスタンス（CL-1。基準日 ${AS_OF} 〜 ${to}）`);
  console.log(`  展開した総数   ${forecast.length}`);
  console.log(`  うち消し込み済 ${reconciled}`);
  console.log(`  **うち未消込** ${forecast.length - reconciled}`);
  console.log(`  AC-48 の条件   1,200件 ${forecast.length - reconciled >= 1200 ? "**満たす**" : "**満たさない**（定期項目を増やす）"}`);

  console.log("");
  console.log("測りたい差が出るか（CLAUDE.md §2.11）");
  console.log(`  分割取得（1,000件）  ${actuals.length > 1000 ? `通る（${Math.ceil(actuals.length / 1000)}ページ）` : "**通らない**"}`);
  console.log(`  月内ページング（200件）  ${perMonth > 200 ? "通る" : `**通らない**（--span を小さくする）`}`);
  console.log(`  振替の純額  生活 ${-60_000 + 80_000 - 30_000} / 事業 ${60_000 - 80_000 + 30_000}（どちらも0でない）`);
  console.log(`  overrides の行  ${await count("overrides")}件（0件だと並び替えキーの一意性を試せない。§9.1）`);
  console.log(
    `  AC-55 の済み/未済  ${settledCount} / ${oneoffRows - settledCount}` +
      (settledCount > 0 && settledCount < oneoffRows
        ? "（どちらも非0。隠す側と出す側の両方を試せる）"
        : settledCount === 0
          ? "  **隠す側を試せない**（--settled を1以上に）"
          : "  **出す側を試せない**（全件が済み。--settled を減らす）") +
      (settledCount === SETTLED
        ? ""
        : `  **--settled=${SETTLED} と食い違う。DB の数を出している**`),
  );
}

await main();
