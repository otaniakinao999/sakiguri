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
import { SELECT_COLUMNS } from "../../src/lib/supabase/rows.ts";

/**
 * 削除の鍵。テーブルごとに主キーが違う。
 *
 * **対象のテーブルは手で並べない。** `SELECT_COLUMNS`（本番が読む全テーブル）
 * から作り、ここに鍵が無いテーブルがあれば**止まる。** 列挙を手で持つと、
 * テーブルが増えたときに消し残りが出る ―― 実際に `import_rules` を足した
 * ときに漏れていた（CLAUDE.md §2.8）。
 *
 * `usage_events` は指標の記録なので消さない（`SELECT_COLUMNS` にも無い）。
 */
const KEYS: Record<string, string> = {
  accounts: "id",
  recurring_items: "id",
  oneoff_items: "id",
  actuals: "id",
  overrides: "plan_key",
  import_rules: "id",
};

const unkeyed = Object.keys(SELECT_COLUMNS).filter((name) => !(name in KEYS));
if (unkeyed.length > 0) {
  fail(
    `消す鍵が決まっていないテーブルがあります: ${unkeyed.join(", ")}\n` +
      `  scripts/loadtest/teardown.ts の KEYS に足してください`,
  );
}

/** 消す順。**参照の末端から消す**（settings は最後） */
const ORDER = ["actuals", "oneoff_items", "recurring_items", "overrides", "import_rules", "accounts"];

const TABLES = [
  ...ORDER.map((name) => ({ name, key: KEYS[name] })),
  { name: "settings", key: "user_id" },
] as const;

/* 順序の列挙も突き合わせる。足し忘れると、そのテーブルだけ消えない */
const ordered = [...ORDER].sort().join(",");
const keyed = Object.keys(KEYS).sort().join(",");
if (ordered !== keyed) {
  fail(`KEYS と ORDER が食い違っています\n  ORDER: ${ordered}\n  KEYS:  ${keyed}`);
}

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
