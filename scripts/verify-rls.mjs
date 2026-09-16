/**
 * RLS が効いていることを実際に確かめる
 *
 * 一次情報：CLAUDE.md §2.5、docs/PoC開発計画.md フェーズ3・タスク#12
 *   完了条件：他ユーザーのデータが取得できないことを確認
 *
 * 使い方：
 *   node scripts/verify-rls.mjs
 *
 * 2人のユーザーを作り、片方のデータをもう片方から読もうとする。
 * publishable キーしか使わない。secret キーは要らない。
 *
 * 作ったユーザーは消せない（削除には secret キーが要る）。
 * 毎回ランダムなメールアドレスを使うので、検証のたびに増える。
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* .env.local を読む。dotenv を入れない */
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLES = [
  "settings",
  "accounts",
  "recurring_items",
  "oneoff_items",
  "actuals",
  "overrides",
];

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " NG   "} ${name}${detail ? ` — ${detail}` : ""}`);
};

function client() {
  return createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signUp(label) {
  const supabase = client();
  const email = `rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(`${label} の登録に失敗: ${error.message}`);
  if (!data.session) {
    throw new Error(
      `${label} にセッションが返りませんでした。メール確認が有効だと検証できません。` +
        ` Supabase の Authentication > Sign In / Providers で "Confirm email" を一時的に切ってください。`,
    );
  }
  return { supabase, userId: data.user.id, email };
}

async function main() {
  console.log("── 前提の確認 ──");
  const anon = client();
  const probe = await anon.from("accounts").select("id").limit(1);
  if (probe.error && probe.error.code === "PGRST205") {
    console.error(
      "\nテーブルがありません。先に supabase/migrations/ の SQL を適用してください。",
    );
    process.exit(2);
  }
  record(
    "未サインインでは accounts を読めない（0件かエラー）",
    probe.error !== null || (probe.data ?? []).length === 0,
    probe.error ? probe.error.message : `${(probe.data ?? []).length}件`,
  );

  console.log("\n── ユーザーAのデータを作る ──");
  const a = await signUp("a");
  const accountId = crypto.randomUUID();

  const seeded = await a.supabase.from("accounts").insert({
    id: accountId,
    user_id: a.userId,
    name: "Aの生活口座",
    kind: "bank",
    balance: 1234567,
  });
  record("A が自分の行を書ける", seeded.error === null, seeded.error?.message ?? "");

  const settings = await a.supabase
    .from("settings")
    .insert({ user_id: a.userId, as_of: "2026-04-01", reserve_line: 600000 });
  record("A が settings を書ける", settings.error === null, settings.error?.message ?? "");

  const readOwn = await a.supabase.from("accounts").select("*");
  record(
    "A は自分の行を読める",
    readOwn.error === null && (readOwn.data ?? []).length === 1,
    `${(readOwn.data ?? []).length}件`,
  );

  console.log("\n── ユーザーBから覗こうとする ──");
  const b = await signUp("b");

  for (const table of TABLES) {
    const got = await b.supabase.from(table).select("*");
    const rows = got.data ?? [];
    record(
      `B は ${table} の他人の行を読めない`,
      got.error === null && rows.length === 0,
      got.error ? got.error.message : `${rows.length}件`,
    );
  }

  const byId = await b.supabase.from("accounts").select("*").eq("id", accountId);
  record(
    "B は id を直接指定しても読めない",
    (byId.data ?? []).length === 0,
    `${(byId.data ?? []).length}件`,
  );

  const updated = await b.supabase
    .from("accounts")
    .update({ name: "Bが書き換えた" })
    .eq("id", accountId)
    .select();
  record(
    "B は他人の行を書き換えられない",
    (updated.data ?? []).length === 0,
    `${(updated.data ?? []).length}件が更新された`,
  );

  const deleted = await b.supabase
    .from("accounts")
    .delete()
    .eq("id", accountId)
    .select();
  record(
    "B は他人の行を消せない",
    (deleted.data ?? []).length === 0,
    `${(deleted.data ?? []).length}件が削除された`,
  );

  const spoofed = await b.supabase.from("accounts").insert({
    id: crypto.randomUUID(),
    user_id: a.userId,
    name: "Bが他人名義で作った行",
    kind: "bank",
    balance: 0,
  });
  record(
    "B は他人の user_id で行を作れない（with check）",
    spoofed.error !== null,
    spoofed.error?.message ?? "作れてしまった",
  );

  console.log("\n── Aのデータが無事か ──");
  const after = await a.supabase.from("accounts").select("*");
  const intact =
    (after.data ?? []).length === 1 &&
    after.data[0].name === "Aの生活口座" &&
    after.data[0].balance === 1234567;
  record("A の行は書き換えも削除もされていない", intact);

  console.log("\n── 利用イベント（ADR-0013）──");
  const inserted = await b.supabase
    .from("usage_events")
    .insert({ user_id: b.userId, event: "signed_in", props: {} });
  record("自分のイベントは書ける", inserted.error === null, inserted.error?.message ?? "");

  const readEvents = await b.supabase.from("usage_events").select("*");
  record(
    "自分のイベントも読めない（select のポリシーが無い）",
    (readEvents.data ?? []).length === 0,
    readEvents.error ? readEvents.error.message : `${(readEvents.data ?? []).length}件`,
  );

  const spoofEvent = await b.supabase
    .from("usage_events")
    .insert({ user_id: a.userId, event: "signed_in", props: {} });
  record(
    "他人の user_id でイベントを書けない",
    spoofEvent.error !== null,
    spoofEvent.error?.message ?? "書けてしまった",
  );

  const updEvent = await b.supabase
    .from("usage_events")
    .update({ event: "tampered" })
    .eq("user_id", b.userId)
    .select();
  record(
    "イベントを書き換えられない（update のポリシーが無い）",
    (updEvent.data ?? []).length === 0,
    `${(updEvent.data ?? []).length}件が更新された`,
  );

  const delEvent = await b.supabase
    .from("usage_events")
    .delete()
    .eq("user_id", b.userId)
    .select();
  record(
    "イベントを消せない（delete のポリシーが無い）",
    (delEvent.data ?? []).length === 0,
    `${(delEvent.data ?? []).length}件が削除された`,
  );

  console.log("\n── RLS の点検ビュー ──");
  const guard = await a.supabase.from("rls_guard").select("*");
  record(
    "rls_guard は外から読めない（どのテーブルが漏れているかを教えない）",
    guard.error !== null || (guard.data ?? []).length === 0,
    guard.error ? guard.error.message : `${(guard.data ?? []).length}件返った`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} 通過` +
      (failed.length ? `　失敗: ${failed.map((f) => f.name).join("、")}` : ""),
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\n検証を実行できませんでした:", e.message);
  process.exit(2);
});
