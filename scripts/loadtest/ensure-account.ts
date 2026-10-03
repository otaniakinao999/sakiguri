/**
 * 負荷試験アカウントを用意する（冪等）
 *
 * 一次情報：supabase/loadtest/README.md
 *
 *     pnpm loadtest:account
 *
 * **このアカウントは消さない。** 使い捨てにすると、測るたびに人の手で
 * 作り直すことになる。`teardown` は行だけを消してアカウントは残す。
 * v1.5 の24,000件でも同じアカウントを使う。
 *
 * ## パスワードを画面に出さない
 *
 * 生成した値は `.env.local` に書くだけで、標準出力にもログにも出さない。
 * 長さだけを出す。**この約束を崩す変更をしないこと。**
 *
 * ## secret key を使わない
 *
 * admin API（`auth.admin.createUser`）なら1手で済むが、service_role キーは
 * RLS を迂回して全利用者の全行を読み書きできる。実データの記帳が入る
 * プロジェクトなので持ち込まない。publishable key と本人セッションで組む。
 *
 * ## 冪等
 *
 * すでにあってサインインできるなら何もしない。何度流してもよい。
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENV_PATH = new URL("../../.env.local", import.meta.url);

/** `.env.local` に書いてあっても未設定として扱う値 */
const PLACEHOLDERS = ["", "ここに自分で書く", "ここに書く"];

/** 生成するパスワードの長さ。base64url なので1バイト=約1.33文字 */
const PASSWORD_BYTES = 32; // → 43文字

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** 値そのものを出さない。長さだけ出す */
const masked = (value: string) => `（${value.length}文字。値は出さない）`;

function env(name: string): string {
  const value = process.env[name];
  if (!value || PLACEHOLDERS.includes(value)) {
    fail(`${name} が .env.local にありません`);
  }
  return value;
}

/**
 * `.env.local` の1行を書き換える。
 *
 * **他の行に触らない。** Supabase の URL とキーが同じファイルにある。
 */
function writeEnv(key: string, value: string): void {
  const text = readFileSync(ENV_PATH, "utf8");
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (!pattern.test(text)) {
    fail(`.env.local に ${key} の行がありません。先に行を作ってください`);
  }
  writeFileSync(ENV_PATH, text.replace(pattern, line));
}

/** サインインを試す。成功なら null、失敗ならそのエラー文言 */
async function trySignIn(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return error.message;

  /* 取り違えの番人。別のアカウントに入っていないことを確かめる */
  const signedInAs = data.session?.user.email ?? "(不明)";
  if (!signedInAs.includes("+loadtest")) {
    fail(
      `サインインできたアカウントが負荷試験用ではありません: ${signedInAs}`,
    );
  }
  await supabase.auth.signOut();
  return null;
}

async function main(): Promise<void> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const email = env("LOADTEST_EMAIL");

  /* **メールアドレスの番人。** 実データのアカウントで走らせない。
     投入・削除SQL と同じ条件（supabase/loadtest/README.md） */
  if (!email.includes("+loadtest")) {
    fail(
      `LOADTEST_EMAIL が負荷試験用ではありません: ${email}\n` +
        `  '+loadtest' を含むアドレスにしてください`,
    );
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`負荷試験アカウント: ${email}`);

  /* ---------- 1. すでにあるか。あれば何もしない ---------- */
  const stored = process.env.LOADTEST_PASSWORD;
  if (stored && !PLACEHOLDERS.includes(stored)) {
    const error = await trySignIn(supabase, email, stored);
    if (error === null) {
      console.log("既にあり、サインインできました。何もしません。");
      return;
    }
    console.log(`保存されているパスワードでは入れませんでした: ${error}`);
    console.log("新しく作ります。");
  } else {
    console.log("パスワードが未設定です。作ります。");
  }

  /* ---------- 2. 作る ---------- */
  const password = randomBytes(PASSWORD_BYTES).toString("base64url");

  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpError) {
    fail(
      `auth.signUp が失敗しました\n` +
        `  status  ${signUpError.status ?? "(無し)"}\n` +
        `  code    ${signUpError.code ?? "(無し)"}\n` +
        `  message ${signUpError.message}\n\n` +
        `  'User already registered' なら、アカウントは存在するが\n` +
        `  パスワードが分からない状態です。ダッシュボードの\n` +
        `  Authentication → Users でそのアカウントを削除してから\n` +
        `  流し直してください。`,
    );
  }

  /* **既存アカウントは identities が空で返る。** メールアドレスの存在を
     外から確かめられないようにするための仕様で、エラーにはならない */
  if (signUp.user && signUp.user.identities?.length === 0) {
    fail(
      `このメールアドレスは既に登録されています（signUp は identities: [] を返した）。\n` +
        `  パスワードが分からないので、このスクリプトでは入れません。\n` +
        `  Authentication → Users で削除してから流し直してください。`,
    );
  }

  console.log(`auth.signUp 成功。パスワードを生成しました ${masked(password)}`);
  console.log(
    `  session は ${signUp.session ? "返りました" : "返りませんでした（確認待ち）"}`,
  );

  /* 作れた時点で保存する。確認待ちでも、確認後に使うのはこの値 */
  writeEnv("LOADTEST_PASSWORD", password);
  console.log(".env.local の LOADTEST_PASSWORD に書きました。");

  /* ---------- 3. サインインできるかを確かめる ---------- */
  const error = await trySignIn(supabase, email, password);
  if (error !== null) {
    fail(
      `作成はできましたが、サインインできません\n` +
        `  auth.signInWithPassword: ${error}\n\n` +
        `  'Email not confirmed' なら、メール確認が要る設定です。\n` +
        `  Authentication → Providers → Email の Confirm email を\n` +
        `  一時的にオフにして、このスクリプトを流し直してください。\n` +
        `  （パスワードは .env.local に保存済みなので、次回は\n` +
        `   サインインの確認だけになります）`,
    );
  }

  console.log("サインインできました。'+loadtest' であることも確認しました。");
  console.log("完了。このアカウントは以後消しません。");
}

await main();
