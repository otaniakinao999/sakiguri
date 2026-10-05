/**
 * plain Node から本番の定数を import できることを検査する
 *
 *     pnpm check:node-import     （`pnpm test` の前に自動で走る）
 *
 * ## なぜ vitest のテストにしないか
 *
 * **vitest は独自に解決する。** 拡張子が無くても、`@/` の別名でも通す。
 * だから vitest のテストでは、plain Node が壊れていることを検知できない。
 * ここで検査したいのは「Node の ESM の規則で読めるか」なので、**vitest を
 * 通さずに node で実行する。**
 *
 * ## 何が壊れるのを防いでいるか
 *
 * `src/lib/supabase/fetch-all.ts` は `./rows.ts` を拡張子付きで import して
 * いる。リポジトリでここだけが拡張子付きなので、**統一しようとして外される
 * 可能性がある。** 外れると `scripts/loadtest/` が動かなくなるが、気づくのは
 * 次に測定を流すときで、それは数ヶ月後になる。
 *
 * 測定スクリプトの価値は**本番と同じ定数で動くこと**にある。写し取る形に
 * すると、片方を直したときにもう片方が古いまま残る（CLAUDE.md §2.8）。
 *
 * ## 条件
 *
 * オフラインで数百msで終わること。ネットワークにも DB にも触らない。
 * `fetch-all.ts` の実行時の依存は `rows.ts` だけで、`@supabase/supabase-js`
 * は型だけ（import type なので実行時には消える）。
 */

import { PAGE_SIZE } from "../src/lib/supabase/fetch-all.ts";
import { SELECT_COLUMNS, SETTINGS_COLUMNS } from "../src/lib/supabase/rows.ts";

const problems: string[] = [];

if (typeof PAGE_SIZE !== "number" || PAGE_SIZE <= 0) {
  problems.push(`PAGE_SIZE が読めません: ${String(PAGE_SIZE)}`);
}

/** `fetchAll` が引けるテーブル。増えたらここも増やす */
const TABLES = [
  "accounts",
  "recurring_items",
  "oneoff_items",
  "actuals",
  "overrides",
] as const;

for (const table of TABLES) {
  const columns = SELECT_COLUMNS[table];
  if (typeof columns !== "string" || columns.length === 0) {
    problems.push(`SELECT_COLUMNS.${table} が読めません`);
  }
}

/* 列挙を集合と突き合わせる（CLAUDE.md §2.8）。テーブルが増えたら落ちる */
const defined = Object.keys(SELECT_COLUMNS).sort();
const expected = [...TABLES].sort();
if (defined.join(",") !== expected.join(",")) {
  problems.push(
    `SELECT_COLUMNS のテーブルが変わりました\n` +
      `  このファイル: ${expected.join(", ")}\n` +
      `  rows.ts:      ${defined.join(", ")}`,
  );
}

if (typeof SETTINGS_COLUMNS !== "string" || SETTINGS_COLUMNS.length === 0) {
  problems.push("SETTINGS_COLUMNS が読めません");
}

if (problems.length > 0) {
  console.error("\n✗ plain Node から本番の定数を読めません\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n  src/lib/supabase/fetch-all.ts の import から拡張子（.ts）を" +
      "\n  外していないか見てください。外すと scripts/loadtest が動きません。\n",
  );
  process.exit(1);
}

console.log(
  `✓ plain Node から読めます（PAGE_SIZE=${PAGE_SIZE}、${TABLES.length}テーブル）`,
);
