/**
 * e2e の共通部分
 *
 * spec は AC 番号と1対1（CLAUDE.md §2.7）。ここは全部が使う下ごしらえ。
 */

import { expect, type Locator, type Page, type CDPSession } from "@playwright/test";

export function env(name: string): string {
  const value = process.env[name];
  if (!value || value === "ここに自分で書く") {
    throw new Error(
      `${name} が .env.local にありません。pnpm loadtest:account を流してください`,
    );
  }
  return value;
}

/**
 * 負荷試験アカウントでサインインする。
 *
 * **画面から入れる。** セッションを注入すると、注入の仕方が本番と違った
 * ときに気づけない。サインイン自体は測定の対象外なので、通信を絞る前に
 * 済ませる。
 */
export async function signIn(page: Page): Promise<void> {
  const email = env("LOADTEST_EMAIL");
  if (!email.includes("+loadtest")) {
    throw new Error(`LOADTEST_EMAIL が負荷試験用ではありません: ${email}`);
  }

  await page.goto("/");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(env("LOADTEST_PASSWORD"));
  await page.getByRole("button", { name: "サインイン" }).click();

  /**
   * ダッシュボードが出るまで待つ。3,000件の読み込みを含むので長めに。
   *
   * **画面に実際に出ている文言で待つこと。** ここは長いあいだ
   * 「今後90日の資金繰り」を待っていたが、**その文言は画面に無かった**
   * （`DashboardScreen.tsx` のコメントにしか無い。v0.6.0 の作り直しで
   * 消えたまま）。出ない文言を待つので、**`pnpm e2e` は全部 60 秒待って
   * 落ちる状態だった。** `口座・カード` は口座を読み終えてから出る
   * （CLAUDE.md §2.11 の留め具の話と同じ形 ―― 見張る先が死んでいた）。
   */
  await expect(page.getByText("口座・カード")).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * ダッシュボードに出ている残高の**金額そのもの**。
 *
 * **`現預金 見込み` を見張らない。** あの帯（`BalanceHeader`）は v0.6.0 の
 * `src/app/(app)/layout.tsx` で `<div className="wide:hidden">` に入っていて、
 * **Playwright の 1280 幅では常に不可視**である（狭いときだけ出る。広い
 * ときは Hero と PageHeader が同じ値を出すので二重になるため）。
 *
 * | | |
 * |---|---|
 * | `toBeVisible()` で待つ | `unexpected value "hidden"` で必ず落ちる |
 * | `toHaveCount(0)` で「出ていない」を測る | **何をしても通る** |
 *
 * 後者が CLAUDE.md §2.11 の「無いことを測る条項は、見る先が間違っていても
 * 通る」そのものである。1280 で実際に残高を出しているのは Hero の
 * 「今日の残高（M月D日）」の下に並ぶ金額（`DashboardView.tsx`、`t-balance`）
 * なので、そこを見る。
 *
 * **ラベルではなく金額を返す。** ラベルは残高の値が無くても出せるので、
 * ラベルだけを見ると「残高が出ている」の証拠にならない。
 */
export function dashboardBalance(page: Page): Locator {
  return page.locator("span.t-balance");
}

/**
 * ダッシュボードの残高が**金額として**出ていることを確かめ、その文字列を返す。
 *
 * **「無いこと」を測る条項は、同じ実行の中で「在ること」も測る**
 * （CLAUDE.md §2.11）。良いデータで出ることを先に見ておかないと、
 * 「出ない」のが仕様どおりなのか、こちらが違う場所を見ているのかを
 * 区別できない。
 *
 * 金額の形まで見る。`—`（読み込み前のプレースホルダ）や空文字で通さない。
 */
export async function expectBalanceShown(page: Page): Promise<string> {
  const amount = dashboardBalance(page);
  await expect(amount).toBeVisible({ timeout: 60_000 });
  const text = ((await amount.textContent()) ?? "").trim();
  expect(text, `残高が金額になっていない: ${text}`).toMatch(/^[−-]?¥[\d,]+$/);
  return text;
}

/**
 * 実績一覧のパネル（`/entry`）。
 *
 * **`実績（N件）` を見張らない。** v0.6.0 で見出しは「実績一覧」になり、
 * 件数は下の注記に移った（`EntryScreen.tsx` の `listFooter`）。
 * 古い形を待つと、**画面は正しく出ているのに 60 秒待って落ちる。**
 */
export function actualListPanel(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "実績一覧" }) });
}

/** 一覧の下の「全N件を出しています」。見出しから移った総件数（AC-28） */
export function actualTotalNote(page: Page): Locator {
  return actualListPanel(page)
    .locator("p")
    .filter({ hasText: /全[\d,]+件を出しています/ });
}

/** 上の注記から読んだ総件数 */
export async function readActualTotal(page: Page): Promise<number> {
  const text = (await actualTotalNote(page).textContent()) ?? "";
  const hit = text.match(/全([\d,]+)件/);
  expect(hit, `総件数が読めない: ${text}`).not.toBeNull();
  return Number(hit![1].replace(/,/g, ""));
}

/**
 * 実績の行の日付の列。
 *
 * **`table tbody tr` では引けない。** v0.6.0 の `TodoRow` は `div` で
 * 組んであり、表ではない。日付の列（`num w-48`）を行の数として使う。
 */
export function actualRowDates(page: Page): Locator {
  return actualListPanel(page).locator("span.num.w-48");
}

/** 月のタブ（MonthTab）。「2026年1月」の形 */
export function monthTabs(page: Page): Locator {
  return actualListPanel(page).getByRole("button", {
    name: /^\d{4}年\d{1,2}月$/,
  });
}

/**
 * `actuals` の全行数を DB から数える。
 *
 * **投入した件数を写し取らない**（CLAUDE.md §2.8）。`seed.ts` は
 * `--rows` に加えて `--settled` の分も入れるので、`3,000` と書き込むと
 * **正しい実装のまま落ちる**（実際に 3,007 で落ちた）。
 */
export async function countAllActuals(): Promise<number> {
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
  const { count, error } = await supabase
    .from("actuals")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`actuals の件数: ${error.message}`);
  return count ?? 0;
}

/**
 * 回線を 4G に絞る（§5.1「3秒以内（回線 4G 想定）」）。
 *
 * Chrome DevTools の "Fast 4G" と同じ値。**絞らずに測ると、開発機から
 * Supabase への速い回線で測ることになり、要件の条件と違う。**
 *
 * | | |
 * |---|---|
 * | 下り | 4 Mbps |
 * | 上り | 3 Mbps |
 * | 遅延 | 20 ms |
 */
export async function throttleTo4G(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (4 * 1000 * 1000) / 8,
    uploadThroughput: (3 * 1000 * 1000) / 8,
    latency: 20,
  });
  return cdp;
}

/** 測った値を、そのまま貼れる形で出す */
export function report(lines: [string, string | number][]): void {
  const width = Math.max(...lines.map(([k]) => [...k].length));
  for (const [key, value] of lines) {
    console.log(`  ${key.padEnd(width)}  ${value}`);
  }
}

/**
 * 照合が舐める集合を、**本番の関数で別経路から数える**。
 *
 * AC-48 の「未消込の予定インスタンス1,200件」は画面に出ない。要対応の
 * 件数は `plan.date <= today` で絞ったあとの数で、**別物である**
 * （実測で 1,241 と 508）。画面の数で代用すると、測りたい負荷になって
 * いないまま通る（§9.1 の3つ目）。
 *
 * ここでは CL-1 を本番の `buildForecast` でそのまま走らせる。
 * **消し込み済みが0件であることを DB から確かめてから**、展開した総数を
 * そのまま未消込として扱う。0件でなければ引き算の規則を写すことになるので、
 * そのときは止める（CLAUDE.md §2.8）。
 */
export async function countUnmatchedForecast(): Promise<{
  asOf: string;
  actuals: number;
  reconciled: number;
  forecast: number;
}> {
  const { createClient } = await import("@supabase/supabase-js");
  const { buildForecast } = await import("../src/core/forecast.ts");
  const { forecastEnd } = await import("../src/lib/period.ts");
  const { toOneoff, toOverrides, toRecurring } = await import(
    "../src/lib/supabase/rows.ts"
  );

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

  const settings = await supabase.from("settings").select("as_of").maybeSingle();
  const asOf = (settings.data as { as_of: string } | null)?.as_of;
  if (!asOf) throw new Error("settings がありません。pnpm loadtest:seed を流してください");

  const [recurring, oneoffs, overrides, all, matched] = await Promise.all([
    supabase.from("recurring_items").select("*"),
    supabase.from("oneoff_items").select("*").gte("date", asOf),
    supabase.from("overrides").select("*"),
    supabase.from("actuals").select("*", { count: "exact", head: true }).gte("date", asOf),
    supabase
      .from("actuals")
      .select("*", { count: "exact", head: true })
      .gte("date", asOf)
      .not("plan_key", "is", null),
  ]);

  const forecast = buildForecast(
    {
      recurring: (recurring.data ?? []).map(toRecurring),
      oneoffs: (oneoffs.data ?? []).map(toOneoff),
      overrides: toOverrides(overrides.data ?? []),
    },
    asOf,
    forecastEnd(asOf),
  );

  return {
    asOf,
    actuals: all.count ?? 0,
    reconciled: matched.count ?? 0,
    forecast: forecast.length,
  };
}

/** 負荷試験アカウントの基準日を書き換える（AC-29a の状態作り） */
export async function setAsOf(asOf: string): Promise<void> {
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

  const { error } = await supabase
    .from("settings")
    .update({ as_of: asOf, last_reconciled_at: null })
    .eq("user_id", auth.data.user.id);
  if (error) throw new Error(`基準日の更新: ${error.message}`);
}

/** 'YYYY-MM-DD'。CLAUDE.md §2.2（UTC 変換を伴う API を使わない） */
export function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
