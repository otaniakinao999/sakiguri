/**
 * plain Node から本番モジュールを import できることを検査する
 *
 *     pnpm check:node-import     （`pnpm test` の前に自動で走る）
 *
 * ## なぜ要るか
 *
 * `scripts/` の測定スクリプトは**本番の定数と関数をそのまま使う。** 写し
 * 取ると、本番を直したときにスクリプトが古いまま残り、**本番と違うものを
 * 測っていることに気づけない**（CLAUDE.md §2.8）。
 *
 * そのために、下に挙げたモジュールだけは import に拡張子（`.ts`）を
 * 付けてある。Node の ESM は拡張子を省略できないためである。
 * **リポジトリの中でそこだけが違う流儀になるので、「統一しよう」で
 * 外される。** 外れた時点でスクリプトが動かなくなるが、気づくのは次に
 * 測定を流すときで、それは数ヶ月後になる。
 *
 * ## なぜ vitest のテストにしないか
 *
 * **vitest は独自に解決する。** 拡張子が無くても `@/` の別名でも通す。
 * だから vitest では plain Node が壊れていることを検知できない。
 * ここで見たいのは「Node の ESM の規則で読めるか」なので、node で動かす。
 *
 * ## 一覧は `scripts/` の実際の import と突き合わせる
 *
 * 下の `MODULES` は手で並べた列挙である。**列挙は必ず漏れる**ので、
 * `scripts/` を走査して「スクリプトが import しているのに一覧に無い」
 * モジュールがあれば落とす（CLAUDE.md §2.8）。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** scripts/ から plain Node で読む本番モジュールと、読めるべき export */
const MODULES: { path: string; exports: string[] }[] = [
  {
    path: "src/lib/supabase/fetch-all.ts",
    exports: ["PAGE_SIZE", "fetchAll", "IncompleteLoadError"],
  },
  {
    path: "src/lib/supabase/rows.ts",
    exports: ["SELECT_COLUMNS", "SETTINGS_COLUMNS", "toRecurring", "toOneoff", "toOverrides"],
  },
  {
    path: "src/core/forecast.ts",
    exports: ["recurringKey", "oneoffKey", "planKeySource", "buildForecast"],
  },
  {
    path: "src/lib/period.ts",
    exports: ["FORECAST_HORIZON_MONTHS", "forecastEnd"],
  },
];

const problems: string[] = [];

/* ---------- 1. 一覧のモジュールが plain Node で読めるか ---------- */

for (const mod of MODULES) {
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(`${ROOT}/${mod.path}`)) as Record<string, unknown>;
  } catch (e) {
    problems.push(
      `${mod.path} を plain Node から import できません\n` +
        `    ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
    );
    continue;
  }
  for (const name of mod.exports) {
    if (loaded[name] === undefined) {
      problems.push(`${mod.path} から ${name} が読めません`);
    }
  }
}

/* ---------- 2. scripts/ の実際の import と突き合わせる ---------- */

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

const declared = new Set(MODULES.map((m) => m.path));
const used = new Set<string>();

const SELF = fileURLToPath(import.meta.url);

for (const file of filesUnder(HERE)) {
  /* 自分自身は走査しない。この下のコメントや文字列を import と
     読み違える（実際に一度読み違えた） */
  if (file === SELF) continue;

  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    /* 型だけの import は実行時に消えるので対象外 */
    if (/^\s*import\s+type\b/.test(line)) continue;
    /* コメント行を外す。説明文に import の例を書くことがある */
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

    const hit = line.match(/\bfrom\s+"([^"]*\/src\/[^"]+)"/);
    if (!hit) continue;
    used.add(relative(ROOT, resolve(dirname(file), hit[1])));
  }
}

for (const path of used) {
  if (!declared.has(path)) {
    problems.push(
      `scripts/ が ${path} を import していますが、MODULES に入っていません\n` +
        `    このファイルの MODULES に足してください（読めるべき export も）`,
    );
  }
}

/* ---------- 3. 列挙そのものの突き合わせ（§2.8） ---------- */

const { SELECT_COLUMNS } = await import(`${ROOT}/src/lib/supabase/rows.ts`);
const TABLES = [
  "accounts",
  "recurring_items",
  "oneoff_items",
  "actuals",
  "overrides",
];
const defined = Object.keys(SELECT_COLUMNS as object).sort();
if (defined.join(",") !== [...TABLES].sort().join(",")) {
  problems.push(
    `SELECT_COLUMNS のテーブルが変わりました\n` +
      `    このファイル: ${[...TABLES].sort().join(", ")}\n` +
      `    rows.ts:      ${defined.join(", ")}`,
  );
}

/* ---------- 結果 ---------- */

if (problems.length > 0) {
  console.error("\n✗ plain Node から本番モジュールを読めません\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n  import から拡張子（.ts）を外していないか見てください。" +
      "\n  外すと scripts/loadtest が動きません（CLAUDE.md §2.8）。\n",
  );
  process.exit(1);
}

console.log(
  `✓ plain Node から読めます（${MODULES.length}モジュール / ` +
    `scripts が使うのは ${used.size}）`,
);
