/**
 * 負荷試験データの削除
 *
 *     pnpm loadtest:teardown
 *
 * **行だけを消す。アカウントは消さない。** 使い捨てにすると測るたびに
 * 人の手で作り直すことになる。v1.5 の24,000件でも同じアカウントを使う。
 *
 * ## 実データに当たらない理由が2つある
 *
 * 1. **RLS。** 本人セッションで消すので、負荷試験アカウントの行しか
 *    delete できない。他の利用者の行には物理的に当たらない
 * 2. **メールアドレスの番人。** `+loadtest` を含まないアカウントでは
 *    サインインの時点で止まる（client.ts）
 *
 * service_role キーで流す形だと1つ目が無くなる。使わない理由がこれ。
 */

import { fail, signInAsLoadtest } from "./client.ts";

/**
 * 消す対象。
 *
 * **`ACCOUNT_SCOPED_COLLECTIONS`（src/lib/mutations.ts）と同じ集合。**
 * 片方に足してもう片方に足し忘れると、消し残りが出る（CLAUDE.md §2.8）。
 * `usage_events` は指標の記録なので消さない。
 */
const TABLES = [
  { name: "actuals", key: "id" },
  { name: "oneoff_items", key: "id" },
  { name: "recurring_items", key: "id" },
  { name: "overrides", key: "plan_key" },
  { name: "accounts", key: "id" },
  { name: "settings", key: "user_id" },
] as const;

async function main(): Promise<void> {
  const { supabase, userId, email } = await signInAsLoadtest();
  console.log(`削除先 ${email}`);
  console.log("");

  const before: Record<string, number> = {};
  const after: Record<string, number> = {};

  for (const { name } of TABLES) {
    const { count } = await supabase
      .from(name)
      .select("*", { count: "exact", head: true });
    before[name] = count ?? 0;
  }

  for (const { name, key } of TABLES) {
    if (before[name] === 0) continue;
    /* RLS が自分の行に絞るので、`neq` は「全部」を表す書き方になる。
       PostgREST は条件なしの delete を拒否するため、条件は必要 */
    const { error } = await supabase
      .from(name)
      .delete()
      .neq(key, "00000000-0000-0000-0000-000000000000");
    if (error) fail(`${name} の削除: ${error.message}`);
  }

  for (const { name } of TABLES) {
    const { count } = await supabase
      .from(name)
      .select("*", { count: "exact", head: true });
    after[name] = count ?? 0;
  }

  console.log("テーブル           削除前    削除後");
  let left = 0;
  for (const { name } of TABLES) {
    console.log(
      `  ${name.padEnd(16)} ${String(before[name]).padStart(7)} ${String(after[name]).padStart(9)}`,
    );
    left += after[name];
  }

  /* `usage_events` は消さないので、残っていることを示す */
  const { count: events } = await supabase
    .from("usage_events")
    .select("*", { count: "exact", head: true });
  console.log(`  usage_events     ${String(events ?? "-").padStart(7)}   （消さない）`);

  console.log("");
  if (left === 0) {
    console.log("全部消えました。**アカウントは残してあります。**");
  } else {
    fail(`${left}行 残っています。上の表の「削除後」を見てください`);
  }
  console.log(`  user_id ${userId}`);
}

await main();
