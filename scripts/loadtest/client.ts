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
 * 負荷試験アカウントは2つある。
 *
 * **1つだと「他人の行が見えない」を測れない**（CLAUDE.md §2.11）。
 * 自分の行しか無い環境では、RLS が効いていても効いていなくても
 * 同じ結果になる ―― 見えない相手が居ないからである。
 */
export type LoadtestWhich = 1 | 2;

const SLOT: Record<LoadtestWhich, { email: string; password: string }> = {
  1: { email: "LOADTEST_EMAIL", password: "LOADTEST_PASSWORD" },
  2: { email: "LOADTEST2_EMAIL", password: "LOADTEST2_PASSWORD" },
};

/**
 * 2つのアドレスが別物であることを確かめる。
 *
 * **同じだと、共有の検査が全部「通る」。** 他人の行が見えないことも、
 * 失効したら見えなくなることも、**相手が自分なら自動的に成り立つ**
 * （§2.11 の3つ目の形 ―― 対象の行が0件のとき、その条項は必ず通る）。
 */
export function assertTwoAccounts(): { first: string; second: string } {
  const first = env("LOADTEST_EMAIL");
  const second = env("LOADTEST2_EMAIL");
  if (first === second) {
    fail(
      `LOADTEST_EMAIL と LOADTEST2_EMAIL が同じです: ${first}\n` +
        `  **これでは他人の行が1件も無いので、共有の検査が全部通ります。**\n` +
        `  pnpm loadtest:account --second で2つ目を作ってください`,
    );
  }
  return { first, second };
}

/**
 * 負荷試験アカウントでサインインする。
 *
 * **番人は2つある。**
 *
 * 1. **`+loadtest` を含まないアカウントでは止まる。** 実データの
 *    アカウントで投入や削除を走らせない（supabase/loadtest/README.md）
 * 2. **`.env.local` のアドレスと完全に一致すること。** 1 だけだと
 *    **別の `+loadtest` アカウントでも通る**（2026-11-15 に気づいた）。
 *    アカウントが2つになると、この緩さは「1つ目のつもりで2つ目に
 *    入っていた」も通すので、**どちらの枠か**まで見る
 */
export async function signInAsLoadtest(
  which: LoadtestWhich = 1,
): Promise<LoadtestSession> {
  const slot = SLOT[which];
  const email = env(slot.email);
  if (!email.includes("+loadtest")) {
    fail(`${slot.email} が負荷試験用ではありません: ${email}`);
  }

  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: env(slot.password),
  });

  if (error) {
    fail(
      `${slot.email} でサインインできません\n` +
        `  auth.signInWithPassword: ${error.code ?? "(code 無し)"} ${error.message}\n\n` +
        `  pnpm loadtest:account${which === 2 ? " --second" : ""} を流してください`,
    );
  }

  const signedInAs = data.session?.user.email ?? "(不明)";
  if (!signedInAs.includes("+loadtest")) {
    fail(`サインインしたアカウントが負荷試験用ではありません: ${signedInAs}`);
  }
  /* **完全一致。** 「+loadtest を含む」だけでは、枠を取り違えても通る */
  if (signedInAs !== email) {
    fail(
      `入ったアカウントが ${slot.email} と違います\n` +
        `  ${slot.email} ${email}\n` +
        `  サインイン      ${signedInAs}`,
    );
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
