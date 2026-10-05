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
