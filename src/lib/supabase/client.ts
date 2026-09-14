"use client";

/**
 * Supabase クライアント
 *
 * 一次情報：docs/PoC開発計画.md §2、docs/要件定義書.md FR-17
 *
 * ブラウザだけで使う。計算はクライアント側で行い（ADR-0003）、
 * サーバーは保存と認証だけを担うため、`@supabase/ssr` は入れていない。
 * セッションはブラウザの localStorage に置く。
 *
 * publishable キーはクライアントにバンドルされる前提の公開キー。
 * **守るのは RLS**（CLAUDE.md §2.5）。secret キーはここに置かない。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** 環境変数が揃っているか。未設定ならログイン画面を出さずに案内する。 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を .env.local に設定してください",
    );
  }

  cached = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}
