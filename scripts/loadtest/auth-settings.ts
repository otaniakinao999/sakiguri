/**
 * 本番の認証の設定を、外から測れる範囲で測る
 *
 *     pnpm loadtest:auth
 *
 * `supabase/config.toml` に `[auth]` が無く、**本番の実際の値は誰も
 * 読めない。** `config push` は使えない（差分13件で本番を上書きする。
 * `docs/新規登録の経路.md`）。押すのではなく、**外から測って書き出す。**
 *
 * ## メールを1通も使わない（CLAUDE.md §2.11）
 *
 * **測ることが対象を消費するなら、測らない。** 新しいアドレスで登録を
 * 試すと、**成功した場合に確認メールが飛ぶ** ―― いま確認メールの枠は
 * 共有の基線を止めている当の資源である。測定でそれを減らさない。
 *
 * 代わりに**既に確認済みの負荷試験アカウントのアドレス**に対して
 * `signUp` を呼ぶ。GoTrue は確認済みの相手には**作りもせず送りもせず**、
 * 存在を伏せた応答を返す（AC-51 と同じ考え方）。パスワードの検査は
 * その前に走るので、**弾かれ方だけが見える。**
 *
 * ## 「検査がその前に走る」ことを先に確かめる（§2.11）
 *
 * これが逆（先に相手を探す）だと、**どんなパスワードでも伏せた応答が
 * 返る** ―― 漏洩の照合が無効でも有効でも同じ結果になり、測っていない
 * ものを「無効」と記録する。だから**1文字のパスワード**で先に叩き、
 * 長さの文句が返ることを見てから、漏洩の照合を測る。
 *
 * ## 測れないもの
 *
 * **レート制限は測らない。** 上限を知るには上限まで使うことになり、
 * 本来の確認に使う分が残らない。増やすかどうかの判断は「足りない」で
 * 足りるので、正確な上限は要らない（要件定義書 §9.1）。
 */

import { createClient } from "@supabase/supabase-js";

import { env, fail, signInAsLoadtest } from "./client.ts";

/** 長さだけが違うパスワードを作る。**毎回変える**（値を持ち回らない） */
function password(length: number): string {
  const pool = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += pool[Math.floor(Math.random() * pool.length)];
  }
  return out;
}

/** 漏洩の一覧に確実に入っている文字列。**どこの鍵でもない** */
const KNOWN_BREACHED = "Password123!";

interface Probe {
  code: string;
  message: string;
  /** 伏せた応答（＝パスワードの検査を抜けた） */
  passed: boolean;
}

async function signUpProbe(email: string, pw: string): Promise<Probe> {
  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.signUp({ email, password: pw });
  if (error) {
    return { code: error.code ?? "(code 無し)", message: error.message, passed: false };
  }
  return {
    code: "(エラー無し)",
    message: data.user?.identities?.length === 0
      ? "存在を伏せた応答（既存の確認済みアカウント。作られていない）"
      : "**応答が伏せ型ではない** ―― 下の注を読むこと",
    passed: true,
  };
}

async function main(): Promise<void> {
  /* ## 1. セッションの寿命 */
  const { supabase, email } = await signInAsLoadtest(1);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) fail("access_token が取れません");

  const payload = JSON.parse(
    Buffer.from(token!.split(".")[1], "base64url").toString("utf8"),
  ) as { exp: number; iat: number; aal?: string; amr?: Array<{ method: string }> };
  const seconds = payload.exp - payload.iat;

  console.log("");
  console.log("## 1. セッションの寿命");
  console.log("");
  console.log(`  access_token の exp - iat   ${seconds} 秒（${(seconds / 60).toFixed(0)} 分）`);
  console.log(`  expires_in                  ${data.session?.expires_in ?? "(無し)"} 秒`);
  console.log(`  refresh_token               ${data.session?.refresh_token ? "ある（期限は外から見えない）" : "無い"}`);
  console.log(`  aal                         ${payload.aal ?? "(無し)"}`);
  console.log(`  amr                         ${(payload.amr ?? []).map((m) => m.method).join(",") || "(無し)"}`);
  console.log("");
  console.log("  **refresh_token がある以上、アクセストークンの寿命は");
  console.log("  「盗られたときの影響の長さ」ではない。** 盗られるのが");
  console.log("  localStorage の中身なら refresh も一緒に渡る。");

  /* ## 2. パスワードの最低条件
     **相手は既に確認済みの負荷試験アカウント。** 1 で入れたことが
     「存在する」証拠になっている ―― 作られることも送られることもない */
  if (!email.includes("+loadtest")) fail(`測定先が負荷試験用ではありません: ${email}`);

  console.log("");
  console.log("## 2. パスワードの最低条件");
  console.log("");
  console.log(`  測定先 ${email}（確認済み。作られも送られもしない）`);
  console.log("");

  const first = await signUpProbe(email, password(1));
  console.log(`  1文字    ${first.code}  ${first.message}`);
  if (first.passed) {
    fail(
      "**1文字が通りました。**\n" +
        "  パスワードの検査より先に相手を探している可能性があります。\n" +
        "  その場合、下の漏洩の照合は**無効でも有効でも同じ結果**になるので、\n" +
        "  測定になりません（CLAUDE.md §2.11）。ここで止めます",
    );
  }

  let minimum: number | null = null;
  for (const length of [2, 4, 6, 8, 10, 12]) {
    const probe = await signUpProbe(email, password(length));
    console.log(`  ${String(length).padStart(2)}文字   ${probe.code}  ${probe.message}`);
    if (probe.passed) {
      /* **通ったらそこで止める。** それより上を試しても分かることが
         増えず、登録の試行だけが増える */
      minimum = length;
      break;
    }
  }
  console.log("");
  console.log(
    minimum === null
      ? "  12文字まで全部弾かれました。最低条件はこれより上です"
      : `  **弾かれなくなるのは ${minimum} 文字から**（1つ下の段との境）`,
  );

  /* ## 3. 漏洩パスワードの照合 */
  console.log("");
  console.log("## 3. 漏洩パスワードの照合（HaveIBeenPwned）");
  console.log("");
  const breached = await signUpProbe(email, KNOWN_BREACHED);
  console.log(`  既知の漏洩パスワード   ${breached.code}  ${breached.message}`);
  console.log("");
  console.log(
    breached.passed
      ? "  **弾かれない ―― 照合は無効。** 2 の長さだけが条件である"
      : "  **弾かれた ―― 照合は有効。**",
  );

  console.log("");
  console.log("## 測っていないもの");
  console.log("");
  console.log("  レート制限    測ると枠を使う。測らない（§2.11）");
  console.log("  2段階認証    外から見えない。aal / amr が上に出ている");
  console.log("  refresh の寿命 外から見えない");
  console.log("");
}

await main();
