"use client";

/**
 * 利用イベントを送る
 *
 * 一次情報：docs/PoC開発計画.md §4
 * 設計方針：docs/adr/0013-利用イベントに金額を入れない.md
 *
 * **記録は投げっぱなしにする。** 失敗しても画面を止めない。
 * 指標が1件欠けることより、利用者の操作が止まるほうが重い。
 *
 * 外部の解析ツールは入れない。資金繰りの金額が第三者に渡る経路を
 * 作らないため（PoC開発計画 §4）。送り先は自前の Supabase だけ。
 */

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

import { hasForbiddenKey, type EventMap, type EventName } from "./events";

/**
 * イベントを1件記録する。
 *
 * `occurred_at` は送らない。サーバー側の `now()` を使う
 * （クライアントの時刻を信用しない）。
 */
export function track<K extends EventName>(
  userId: string | undefined,
  event: K,
  props: EventMap[K],
): void {
  if (!userId || !isSupabaseConfigured()) return;

  const payload = props as Record<string, number | boolean>;

  /* 型で防いでいるが、名前でも弾く。開発中に気づけるようにする */
  const forbidden = hasForbiddenKey(payload);
  if (forbidden) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `利用イベントに入れてはいけないキーがあります: ${forbidden}（${event}）。docs/adr/0013 を参照`,
      );
    }
    return;
  }

  void getSupabase()
    .from("usage_events")
    .insert({ user_id: userId, event, props: payload })
    .then(({ error }) => {
      if (error && process.env.NODE_ENV !== "production") {
        console.warn(`利用イベントを送れませんでした（${event}）:`, error.message);
      }
    });
}
