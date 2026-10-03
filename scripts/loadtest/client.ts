/**
 * 負荷試験スクリプトの共通部分
 *
 * **publishable key と本人セッションだけで組む。** service_role キーは
 * 使わない。あれは RLS を迂回して全利用者の全行を読み書きできる。
 *
 * ## RLS が安全装置になっている
 *
 * サインインしたのが負荷試験アカウントである以上、**このスクリプトは
 * そのアカウントの行しか触れない。** 投入も削除も、他の利用者の行には
 * 物理的に当たらない。SQL Editor から service_role で流す形と違い、
 * 取り違えの被害が原理的に起きない（CLAUDE.md §2.5）。
 *
 * メールアドレスの番人は、それでも置く。**間違ったアカウントの行を
 * 消すことは防げる**ため。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const PLACEHOLDERS = ["", "ここに自分で書く", "ここに書く"];

export function env(name: string): string {
  const value = process.env[name];
  if (!value || PLACEHOLDERS.includes(value)) {
    fail(
      `${name} が .env.local にありません。` +
        `先に pnpm loadtest:account を流してください`,
    );
  }
  return value;
}

export interface LoadtestSession {
  supabase: SupabaseClient;
  userId: string;
  email: string;
}

/**
 * 負荷試験アカウントでサインインする。
 *
 * **`+loadtest` を含まないアカウントでは止まる。** 実データのアカウントで
 * 投入や削除を走らせない（supabase/loadtest/README.md と同じ条件）。
 */
export async function signInAsLoadtest(): Promise<LoadtestSession> {
  const email = env("LOADTEST_EMAIL");
  if (!email.includes("+loadtest")) {
    fail(`LOADTEST_EMAIL が負荷試験用ではありません: ${email}`);
  }

  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: env("LOADTEST_PASSWORD"),
  });

  if (error) {
    fail(
      `サインインできません\n` +
        `  auth.signInWithPassword: ${error.code ?? "(code 無し)"} ${error.message}\n\n` +
        `  pnpm loadtest:account を流してください`,
    );
  }

  const signedInAs = data.session?.user.email ?? "(不明)";
  if (!signedInAs.includes("+loadtest")) {
    fail(`サインインしたアカウントが負荷試験用ではありません: ${signedInAs}`);
  }

  return { supabase, userId: data.session!.user.id, email: signedInAs };
}

/** `--rows=3000` のような引数を読む */
export function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.split("=")[1]);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`--${name} は正の整数で指定してください: ${hit}`);
  }
  return value;
}

/** 'YYYY-MM-DD' に n 日足す。CLAUDE.md §2.2（UTC 変換を伴う API を使わない） */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
