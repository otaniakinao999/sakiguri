/**
 * 共有（`grants`）の検査 ―― **ポリシーを書く前に、測る側を先に作る**
 *
 *     pnpm loadtest:sharing      （終わったら pnpm loadtest:teardown と --second）
 *
 * ## なぜ先に作るか
 *
 * ポリシーを書いてから流して全部通ると、**「正しいから通った」のか
 * 「測れていないから通った」のかが区別できない**（CLAUDE.md §2.11）。
 * 先に流して、**落ちるべきものが落ちることを見てから**ポリシーを書く。
 *
 * ## 「無いこと」だけを数えない
 *
 * 共有の条項は半分が「**できないこと**」である ―― 閲覧では書けない、
 * 失効したら見えない、客は `grants` を書けない。**これらは、共有の
 * 仕組みがまだ1つも無い今でも「通る」。** 相手に何も与えていないので、
 * できないのは当たり前である。
 *
 * **それを「通過」と数えると、48通りの大半が緑で出て、何も測れていない
 * ことが隠れる。** だから各条項は**前提**（どんな付与があるか）を宣言し、
 * 前提を作れないときは **`前提なし`** と出す。通過とも失敗とも数えない。
 *
 * ## 2人分のデータが要る
 *
 * 1人だと「他人の行が見えない」を測れない ―― 見えない相手が居ない。
 * `LOADTEST_EMAIL`（A・所有者）と `LOADTEST2_EMAIL`（B・客）の2つを使い、
 * **同じアドレスなら止まる**（`assertTwoAccounts`）。
 */

import {
  assertTwoAccounts,
  fail,
  signInAsLoadtest,
  type LoadtestSession,
} from "./client.ts";
import { SELECT_COLUMNS } from "../../src/lib/supabase/rows.ts";

/* ========================= 対象の表 ========================= */

/**
 * RLS が効いている8表。
 *
 * **手で並べた列挙なので、集合と突き合わせる**（CLAUDE.md §2.8）。
 * `SELECT_COLUMNS`（本番が読む6表）に無い2つだけを明示し、増えたら落ちる。
 *
 * **本番とも1度突き合わせた**（2026-11-16）。`pg_tables` で `public` の表は
 * 8つ、どれも `rowsecurity` が on、`grants` はまだ無い。ここから先は
 * `SELECT_COLUMNS` との照合が番人になる ―― このスクリプトは RLS 下の
 * セッションで動くので、`pg_tables` 自体は読めない。
 */
const EXTRA = ["settings", "usage_events"] as const;
const TABLES = [...Object.keys(SELECT_COLUMNS), ...EXTRA].sort();

{
  const missing = Object.keys(SELECT_COLUMNS).filter((t) => TABLES.indexOf(t) < 0);
  if (missing.length > 0) {
    fail(`SELECT_COLUMNS に増えた表が TABLES にありません: ${missing.join(", ")}`);
  }
  if (TABLES.length !== 8) {
    fail(
      `対象の表が8つではありません（${TABLES.length}）: ${TABLES.join(", ")}\n` +
        `  表が増えたなら、この検査にも足してください`,
    );
  }
}

const uuid = (n: number) => `c0c0c0c0-0000-4000-8000-00000000000${n}`;

/** 行を1件作るときの中身。`user_id` は呼ぶ側が足す */
function seedRow(table: string, ownerId: string): Record<string, unknown> {
  const acc = "c0c0c0c0-0000-4000-8000-000000000001";
  const base = {
    name: "sharing 試験",
    type: "expense",
    cost_type: "variable",
    category_code: "EXP-07",
    amount: 1_000,
    biz_ratio: 0,
    account_id: acc,
  };
  switch (table) {
    case "settings":
      return { user_id: ownerId, as_of: "2026-11-01", reserve_line: 100_000 };
    case "accounts":
      return { id: acc, name: "sharing 試験口座", kind: "bank", balance: 500_000 };
    case "recurring_items":
      return { id: uuid(2), ...base, day: 10, active: true };
    case "oneoff_items":
      return { id: uuid(3), ...base, date: "2026-11-05" };
    case "actuals":
      return { id: uuid(4), ...base, date: "2026-11-05", plan_key: null };
    case "overrides":
      return { plan_key: "sharing-試験", amount: 2_000 };
    case "import_rules":
      return {
        id: uuid(5),
        pattern: "sharing 試験",
        account_id: null,
        direction: null,
        category_code: "EXP-34",
        cost_type: "variable",
        biz_ratio: 0,
      };
    default:
      return fail(`${table} の中身が決まっていません`);
  }
}

/** その行を名指しするための絞り込み（update / delete / 読み直しに使う） */
function whereOf(table: string, ownerId: string): [string, string] {
  switch (table) {
    case "settings":
      return ["user_id", ownerId];
    case "overrides":
      return ["plan_key", "sharing-試験"];
    case "accounts":
      return ["id", uuid(1)];
    case "recurring_items":
      return ["id", uuid(2)];
    case "oneoff_items":
      return ["id", uuid(3)];
    case "actuals":
      return ["id", uuid(4)];
    case "import_rules":
      return ["id", uuid(5)];
    default:
      return fail(`${table} の絞り込みが決まっていません`);
  }
}

/* ========================= 結果の表 ========================= */

type Status = "通過" | "**失敗**" | "前提なし" | "対象外";

interface Row {
  scenario: string;
  table: string;
  status: Status;
  detail: string;
}

const rows: Row[] = [];
const put = (scenario: string, table: string, status: Status, detail = "") =>
  rows.push({ scenario, table, status, detail });

/* ========================= 前提 ========================= */

/**
 * `grants` の表があるか。
 *
 * **無ければ、共有に関わる条項は前提を作れない。** 「できない」側の条項が
 * 黙って通るのを防ぐ唯一の手がかりがこれである。
 */
async function grantsExist(session: LoadtestSession): Promise<boolean> {
  const { error } = await session.supabase.from("grants").select("*").limit(1);
  /* PGRST205 = スキーマキャッシュに無い（＝表が無い） */
  return !(error && error.code === "PGRST205");
}

/**
 * 拒否の理由を見分ける。
 *
 * **主キーの衝突で失敗したのを「RLS が弾いた」と読まない**（§2.11）。
 * `settings` と `overrides` は所有者の行が既に在るので、客の insert は
 * **権限ではなく重複で落ちうる。** そのとき条項は「正しい実装でも壊れた
 * 実装でも同じ結果」になる。
 */
function deniedByPermission(error: { code?: string; message: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return false; // unique_violation
  return true;
}

function reason(error: { code?: string; message: string } | null): string {
  if (!error) return "弾かれなかった";
  return `${error.code ?? "(code無し)"} ${error.message.slice(0, 60)}`;
}

/* ========================= 本体 ========================= */

async function main(): Promise<void> {
  const { first, second } = assertTwoAccounts();
  console.log(`A（所有者）${first}`);
  console.log(`B（客）    ${second}`);
  console.log("");

  const a = await signInAsLoadtest(1);
  const b = await signInAsLoadtest(2);
  if (a.userId === b.userId) {
    fail("A と B が同じ利用者です。これでは他人の行が1件も在りません");
  }

  const hasGrants = await grantsExist(a);
  console.log(
    hasGrants
      ? "grants の表：あり"
      : "**grants の表：まだ無い。** 付与を要する条項は「前提なし」と出す",
  );
  console.log("");

  /* ---------- A の行を作る。**在ることを先に見る**（§2.11） ---------- */
  let seeded = 0;
  const shared = TABLES.filter((t) => t !== "usage_events");
  for (const table of shared) {
    const row = { user_id: a.userId, ...seedRow(table, a.userId) };
    const { error } = await a.supabase.from(table).upsert(row);
    if (error) {
      put("0 下ごしらえ", table, "**失敗**", `A が自分の行を作れない: ${reason(error)}`);
      continue;
    }
    const [col, value] = whereOf(table, a.userId);
    const { data } = await a.supabase.from(table).select(col).eq(col, value);
    const n = (data ?? []).length;
    if (n === 1) seeded++;
    put("0 下ごしらえ", table, n === 1 ? "通過" : "**失敗**", `A から ${n}件 見える`);
  }
  /* **`usage_events` には種を蒔かない。** 誰も select できないので
     「見えない」を測れず（必ず通る）、しかも `teardown` が消さない表
     なので、流すたびに本番の指標へ行が1つ積まれる（ADR-0013） */
  put("0 下ごしらえ", "usage_events", "対象外", "誰も select できず、teardown も消さない");
  if (seeded < shared.length) {
    fail("A の行を用意できませんでした。この先は測れません");
  }

  /* ---------- 1 共有されていない他人の行が見えない ---------- */
  for (const table of shared) {
    const [col, value] = whereOf(table, a.userId);
    const { data, error } = await b.supabase.from(table).select(col).eq(col, value);
    const n = (data ?? []).length;
    put(
      "1 共有なしでは見えない",
      table,
      error === null && n === 0 ? "通過" : "**失敗**",
      error ? reason(error) : `B から ${n}件 見える`,
    );
  }
  put("1 共有なしでは見えない", "usage_events", "対象外", "所有者も含め誰も select できない");

  /* ---------- 2 共有された行が見える（閲覧の付与） ---------- */
  for (const table of TABLES) {
    if (table === "usage_events") {
      put("2 共有すれば見える", table, "対象外", "指標の記録。誰も select できない（ADR-0013）");
      continue;
    }
    if (!hasGrants) {
      put("2 共有すれば見える", table, "前提なし", "閲覧の付与を作れない（grants が無い）");
      continue;
    }
    put("2 共有すれば見える", table, "前提なし", "付与の作り方が未定（順序2）");
  }

  /* ---------- 3 閲覧では書けない ---------- */
  for (const op of ["insert", "update", "delete"] as const) {
    for (const table of TABLES) {
      if (table === "usage_events") {
        put(`3 閲覧では${op}できない`, table, "対象外", "共有の対象ではない");
        continue;
      }
      if (!hasGrants) {
        put(
          `3 閲覧では${op}できない`,
          table,
          "前提なし",
          "**閲覧の付与が無い状態で測ると、何も与えていないので必ず通る**",
        );
        continue;
      }
      put(`3 閲覧では${op}できない`, table, "前提なし", "付与の作り方が未定（順序2）");
    }
  }

  /* ---------- 4 編集では書ける ---------- */
  for (const table of TABLES) {
    if (table === "usage_events") {
      put("4 編集なら書ける", table, "対象外", "共有の対象ではない");
      continue;
    }
    put(
      "4 編集なら書ける",
      table,
      hasGrants ? "前提なし" : "**失敗**",
      hasGrants ? "付与の作り方が未定（順序2）" : "編集を付与できないので、B は書けない",
    );
  }

  /* ---------- 5 失効したら見えなくなる ---------- */
  for (const table of TABLES) {
    if (table === "usage_events") {
      put("5 失効したら見えない", table, "対象外", "共有の対象ではない");
      continue;
    }
    put(
      "5 失効したら見えない",
      table,
      "前提なし",
      "**一度見えた状態を作れないと測れない。** 見えたことが無いまま" +
        "「見えない」を確かめても、何も測っていない",
    );
  }

  /* ---------- 6 客が grants を書けない ---------- */
  if (!hasGrants) {
    put(
      "6 客は grants を書けない",
      "grants",
      "**失敗**",
      "**表がまだ無い。** 権限の昇格を防ぐ当の表が存在しない",
    );
  } else {
    const { error } = await b.supabase
      .from("grants")
      .insert({ owner_id: a.userId, grantee_id: b.userId, level: "edit" });
    put(
      "6 客は grants を書けない",
      "grants",
      deniedByPermission(error) ? "通過" : "**失敗**",
      reason(error),
    );
  }

  /* ========================= 出力 ========================= */

  console.log("場面                        表                件");
  let last = "";
  for (const r of rows) {
    const head = r.scenario === last ? "" : r.scenario;
    last = r.scenario;
    console.log(
      `${head.padEnd(28)}${r.table.padEnd(18)}${r.status}` +
        (r.detail ? `  ${r.detail}` : ""),
    );
  }

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  console.log("");
  console.log(
    `合計 ${rows.length}　` +
      `通過 ${count("通過")}　失敗 ${count("**失敗**")}　` +
      `前提なし ${count("前提なし")}　対象外 ${count("対象外")}`,
  );
  console.log("");
  console.log(
    "**「前提なし」を通過と数えないこと。** 付与の仕組みが無い状態では、\n" +
      "「できない」側の条項は何も与えていないので必ず通る（§2.11）。",
  );
  console.log("");
  console.log("**行が残っています。pnpm loadtest:teardown と --second で消してください。**");
}

await main();
