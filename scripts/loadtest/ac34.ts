/**
 * AC-34 重複・欠落・並びの逆転
 *
 *     pnpm loadtest:ac34
 *
 * 一次情報：docs/要件定義書.md §5.1.2、AC-34
 *
 * > 基準日以降の実績が API の1回あたり返却上限を超える件数ある状態で、
 * > 取得した実績の件数と総件数が一致すること。重複と欠落がないこと。
 * > **全テーブルについて、並び替えキーが一意であること**
 *
 * ## これは「遅い」ではなく「間違う」側の基準である
 *
 * 分割取得が崩れると、CL-3 が一部の実績しか知らないまま残高を出す。
 * 消し込み済みの予定が未消し込みとして復活し、残高と防衛ラインの警告が
 * 同時に狂う。**エラーにならず、画面にも異常が出ない。**
 *
 * ## 本番と同じ経路で取る
 *
 * `src/lib/supabase/fetch-all.ts` と同じ並び・同じ範囲指定で取る。
 * **測るために本番のコードを変えない。** ここで同じ条件を組み立てる。
 *
 * ## 全テーブルを見る
 *
 * AC-34 の最後の条項は「**全テーブルについて**、並び替えキーが一意で
 * あること」である。`actuals` だけ見て番号を掲げない（CLAUDE.md §3.1）。
 */

import { PAGE_SIZE } from "../../src/lib/supabase/fetch-all.ts";
import { SELECT_COLUMNS } from "../../src/lib/supabase/rows.ts";
import { fail, signInAsLoadtest } from "./client.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/** `loadAppData` が使う絞り込みと同じ（FR-47） */
const SINCE: Record<string, string | null> = {
  accounts: null,
  recurring_items: null,
  oneoff_items: "date",
  actuals: "date",
  overrides: null,
};

/** 並び替えに使う一意な列。`overrides` は id を持たない */
const ID_COLUMN: Record<string, string> = {
  accounts: "id",
  recurring_items: "id",
  oneoff_items: "id",
  actuals: "id",
  overrides: "plan_key",
};

interface Result {
  table: string;
  total: number | null;
  received: number;
  unique: number;
  duplicates: string[];
  outOfOrder: number;
  pages: number;
}

async function scan(
  supabase: SupabaseClient,
  table: string,
  asOf: string,
): Promise<Result> {
  const since = SINCE[table];
  const idColumn = ID_COLUMN[table];

  const seen = new Set<string>();
  const duplicates: string[] = [];
  let received = 0;
  let pages = 0;
  let offset = 0;
  let total: number | null = null;
  let outOfOrder = 0;
  let previous: string | null = null;

  for (let page = 0; page < 500; page++) {
    let query = supabase
      .from(table)
      .select(SELECT_COLUMNS[table as keyof typeof SELECT_COLUMNS], {
        count: "exact",
      })
      .range(offset, offset + PAGE_SIZE - 1);

    if (since) query = query.gte(since, asOf).order(since, { ascending: true });
    query = query.order(idColumn, { ascending: true });

    const { data, error, count } = await query;
    if (error) fail(`${table} の取得: ${error.message}`);
    if (count !== null) total = count;

    const got = (data ?? []) as unknown as Record<string, string>[];
    for (const row of got) {
      const id = row[idColumn];
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);

      /* 並びが崩れていると、ページの境界で同じ行が2回返り、別の行が
         1回も返らない。しかも**件数は一致する**（§5.1.2） */
      const sortKey = since ? `${row[since]}|${id}` : id;
      if (previous !== null && sortKey < previous) outOfOrder += 1;
      previous = sortKey;
    }

    pages += 1;
    received += got.length;
    offset += got.length;
    if (got.length === 0) break;
    if (total !== null && received >= total) break;
  }

  return { table, total, received, unique: seen.size, duplicates, outOfOrder, pages };
}

async function main(): Promise<void> {
  const { supabase, email } = await signInAsLoadtest();

  const { data: settings, error } = await supabase
    .from("settings")
    .select("as_of")
    .maybeSingle();
  if (error) fail(`settings の取得: ${error.message}`);
  const asOf = (settings as { as_of: string } | null)?.as_of;
  if (!asOf) fail("settings がありません。先に pnpm loadtest:seed を流してください");

  console.log("===== AC-34 重複・欠落・並びの逆転 =====");
  console.log(`アカウント ${email}`);
  console.log(`基準日     ${asOf}`);
  console.log(`1回あたり  ${PAGE_SIZE}件（fetch-all.ts の PAGE_SIZE）`);
  console.log("");

  const results: Result[] = [];
  for (const table of Object.keys(SINCE)) {
    results.push(await scan(supabase, table, asOf));
  }

  console.log("テーブル           総件数   受取   ユニーク  重複  逆転  往復");
  for (const r of results) {
    console.log(
      `  ${r.table.padEnd(16)}` +
        `${String(r.total ?? "-").padStart(7)}` +
        `${String(r.received).padStart(7)}` +
        `${String(r.unique).padStart(10)}` +
        `${String(r.duplicates.length).padStart(6)}` +
        `${String(r.outOfOrder).padStart(6)}` +
        `${String(r.pages).padStart(6)}`,
    );
  }
  console.log("");

  /* 条項ごとに判定する（CLAUDE.md §3.1） */
  const clauses = [
    {
      name: "上限を超える件数で試せているか",
      ok: results.some((r) => (r.total ?? 0) > PAGE_SIZE),
      detail: `actuals ${results.find((r) => r.table === "actuals")?.total ?? 0}件。${PAGE_SIZE}件を超えること`,
    },
    {
      name: "件数と総件数が一致する",
      ok: results.every((r) => r.total === null || r.received === r.total),
      detail: results
        .filter((r) => r.total !== null && r.received !== r.total)
        .map((r) => `${r.table} 受取${r.received} ≠ 総件数${r.total}`)
        .join(" / ") || "全テーブル一致",
    },
    {
      name: "重複がない",
      ok: results.every((r) => r.duplicates.length === 0),
      detail:
        results
          .filter((r) => r.duplicates.length > 0)
          .map((r) => `${r.table} ${r.duplicates.length}件（例 ${r.duplicates.slice(0, 3).join(", ")}）`)
          .join(" / ") || "0件",
    },
    {
      name: "欠落がない（総件数 = ユニーク）",
      ok: results.every((r) => r.total === null || r.unique === r.total),
      detail:
        results
          .filter((r) => r.total !== null && r.unique !== r.total)
          .map((r) => `${r.table} ユニーク${r.unique} ≠ 総件数${r.total}`)
          .join(" / ") || "全テーブル一致",
    },
    {
      name: "並び替えキーが一意（全テーブル）",
      ok: results.every((r) => r.received === r.unique && r.outOfOrder === 0),
      detail:
        results
          .filter((r) => r.received !== r.unique || r.outOfOrder > 0)
          .map((r) => `${r.table} 逆転${r.outOfOrder}`)
          .join(" / ") || "逆転0・重複0",
    },
  ];

  for (const c of clauses) {
    console.log(`${c.ok ? "○" : "**×**"} ${c.name.padEnd(28)} ${c.detail}`);
  }

  console.log("");
  const failed = clauses.filter((c) => !c.ok);
  if (failed.length === 0) {
    console.log("AC-34 の全条項を満たしました。");
  } else {
    console.log(`**${failed.length}条項が未達。** 上の × の行をそのまま報告してください。`);
    process.exit(1);
  }
}

await main();
