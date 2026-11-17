"use client";

/**
 * 共有の読み書き（FR-23・FR-31・FR-67）
 *
 * 一次情報：supabase/migrations/0011_grants_and_invites.sql、AC-76〜AC-84
 *
 * ## マイグレーション 0011 が未適用でも落ちない
 *
 * 0008 と同じ扱いにしてある（ADR-0026）。**「テーブルが無い」だけを
 * 見分けて空として扱う。** ほかのエラーは投げる ―― 権限や通信の失敗を
 * 「共有が0件」として扱うと、**渡してある権限が消えたように見える。**
 *
 * **適用を先に行うこと**（CLAUDE.md §2.5.1）。未適用のままでは共有の
 * 画面が空になるだけで、既存の画面は壊れない。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Book, GrantLevel, InviteRow } from "../sharing.ts";
import { ownBookOnly } from "../sharing.ts";

interface GrantRow {
  owner_id: string;
  level: GrantLevel;
  owner_email: string | null;
}

interface InviteDbRow {
  id: string;
  email: string;
  level: GrantLevel;
  accepted_at: string | null;
  grantee_id: string | null;
}

/** そのテーブルがまだ無いことを表すエラーか（`storage.ts` と同じ判定） */
function isMissingTable(error: { code?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205";
}

/**
 * 自分が見られる帳の一覧（AC-84）。
 *
 * **自分の帳が必ず先頭にある。** 付与が0件なら長さ1で、画面はいまと
 * 同じに見える。
 */
export async function fetchBooks(
  supabase: SupabaseClient,
  userId: string,
): Promise<Book[]> {
  const { data, error } = await supabase
    .from("grants")
    .select("owner_id, level, owner_email")
    .eq("grantee_id", userId);

  if (error) {
    if (isMissingTable(error)) return ownBookOnly(userId);
    throw new Error(error.message);
  }

  const shared = (data ?? []).map((row: GrantRow) => ({
    ownerId: row.owner_id,
    /* **アドレスが無ければ id は出さない。** uuid は利用者に意味が無く、
       出すと「どの帳か」の手がかりにならない（AC-84） */
    label: row.owner_email ?? "（名前の分からない帳）",
    own: false,
    level: row.level,
  }));

  return [...ownBookOnly(userId), ...shared];
}

/**
 * 自分が出した招待の一覧（AC-83）。
 *
 * **未受諾も含む。** 届かなかった招待が見えないと、相手は「来ない」と
 * 言い、持ち主は「送った」と言うことになる。
 */
export async function fetchInvites(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<InviteRow[]> {
  const { data, error } = await supabase
    .from("invites")
    .select("id, email, level, accepted_at, grantee_id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }

  return (data ?? []).map((row: InviteDbRow) => ({
    id: row.id,
    email: row.email,
    level: row.level,
    acceptedAt: row.accepted_at,
    granteeId: row.grantee_id,
  }));
}

/**
 * 招待を出す。
 *
 * **アドレスから `user_id` を引かない**（AC-79）。相手が登録済みかどうかに
 * かかわらず、アドレスのまま置く ―― 引く経路を画面から使えるようにすると、
 * **誰でもアドレスの存在を試せる。**
 */
export async function createInvite(
  supabase: SupabaseClient,
  owner: { id: string; email: string },
  email: string,
  level: GrantLevel,
): Promise<void> {
  const { error } = await supabase.from("invites").upsert(
    {
      owner_id: owner.id,
      email: email.trim(),
      owner_email: owner.email,
      level,
      accepted_at: null,
    },
    { onConflict: "owner_id, email" },
  );
  if (error) throw new Error(error.message);
}

/** 招待を取り消す（未受諾のものを消す） */
export async function deleteInvite(
  supabase: SupabaseClient,
  ownerId: string,
  inviteId: string,
): Promise<void> {
  const { error } = await supabase
    .from("invites")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", inviteId);
  if (error) throw new Error(error.message);
}

/**
 * 受諾済みの付与を失効する。
 *
 * **招待も一緒に消す。** 招待が残っていると、相手がもう一度受諾できる。
 */
export async function revokeGrant(
  supabase: SupabaseClient,
  ownerId: string,
  invite: InviteRow,
): Promise<void> {
  if (invite.granteeId) {
    const { error } = await supabase
      .from("grants")
      .delete()
      .eq("owner_id", ownerId)
      .eq("grantee_id", invite.granteeId);
    if (error) throw new Error(error.message);
  }
  await deleteInvite(supabase, ownerId, invite.id);
}

/**
 * 自分のアドレス宛の招待を受け取る（AC-79）。
 *
 * **`grants` に直接 insert しない**（AC-78）。持ち主だけが書けるので、
 * 受諾は専用の経路を通る。作れるのは「自分のアドレス宛・持ち主が出した・
 * 未受諾」の招待に対応する**1行だけ**である。
 */
export async function acceptInvite(
  supabase: SupabaseClient,
  inviteId: string,
): Promise<void> {
  const { error } = await supabase.rpc("accept_invite", { invite_id: inviteId });
  if (error) throw new Error(error.message);
}

/** 自分宛の未受諾の招待（受け取る側の画面に出す） */
export async function fetchIncomingInvites(
  supabase: SupabaseClient,
): Promise<InviteRow[]> {
  const { data, error } = await supabase
    .from("invites")
    .select("id, email, level, accepted_at, grantee_id")
    .is("accepted_at", null);

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row: InviteDbRow) => ({
    id: row.id,
    email: row.email,
    level: row.level,
    acceptedAt: row.accepted_at,
    granteeId: row.grantee_id,
  }));
}
