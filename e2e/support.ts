/**
 * e2e の共通部分
 *
 * **spec は2本だけ**（AC-28a / AC-28b）。ここは両方が使う下ごしらえ。
 */

import { expect, type Page, type CDPSession } from "@playwright/test";

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

  /* ダッシュボードが出るまで待つ。3,000件の読み込みを含むので長めに */
  await expect(page.getByText("今後90日の資金繰り")).toBeVisible({
    timeout: 60_000,
  });
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
