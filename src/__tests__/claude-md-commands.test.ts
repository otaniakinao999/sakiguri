import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `CLAUDE.md` §6 の一覧と `package.json` の `scripts` を突き合わせる
 *
 * ## なぜ置くか
 *
 * **半分だけ載っている一覧は、無い一覧より悪い** ―― 載っていないものが
 * 「無い」と読めるので、既にある道具を知らずに作り直す。実際に
 * `roundtrip` / `sharing` / `account2` / `e2e` の4つが載っていなかった
 * （2026-11-17）。手で書いた一覧なので、足した人が書き忘れれば古くなる。
 *
 * CLAUDE.md §2.8 の「列挙を避けられない場合は、**集合の全体と突き合わせる
 * テストを置き、要素が増えたときに落ちるようにする**」がこれにあたる。
 *
 * ## 両方向を見る
 *
 * 「載っていない」だけでなく「**載っているが無い**」も落とす。消した
 * コマンドが一覧に残っていると、流そうとした人が存在しない名前を打つ。
 * §2.11 の「**無いことを測る条項は、同じ実行で在ることも測る**」。
 */

const root = fileURLToPath(new URL("../..", import.meta.url));

/** `pnpm` 自身のサブコマンド。`scripts` には無くて当然なので除く */
const PNPM_BUILTINS = new Set(["audit", "install", "why", "peers", "add", "dlx"]);

/**
 * 自動で走るので一覧に書かない
 *
 * `pretest` は `pnpm test` の前に pnpm が勝手に呼ぶ。打つものではない
 * （中身の `check:node-import` は単体でも打てるので一覧に在る）。
 */
const IMPLICIT = new Set(["pretest"]);

function scriptNames(): string[] {
  const pkg = JSON.parse(
    readFileSync(`${root}/package.json`, "utf8"),
  ) as { scripts: Record<string, string> };
  return Object.keys(pkg.scripts).filter((n) => !IMPLICIT.has(n));
}

/** CLAUDE.md の §6 だけを切り出す */
function sectionSix(): string {
  const md = readFileSync(`${root}/CLAUDE.md`, "utf8");
  const start = md.indexOf("## 6. コマンド");
  expect(start, "CLAUDE.md に §6 の見出しが無い").toBeGreaterThan(-1);
  const after = md.indexOf("\n## ", start + 1);
  return after === -1 ? md.slice(start) : md.slice(start, after);
}

/** §6 の中で `pnpm <名前>` として挙げられている名前 */
function documentedNames(section: string): Set<string> {
  const found = new Set<string>();
  for (const m of section.matchAll(/\bpnpm ([a-z0-9:_-]+)/g)) {
    const name = m[1];
    if (!PNPM_BUILTINS.has(name)) found.add(name);
  }
  return found;
}

describe("CLAUDE.md §6 のコマンド一覧", () => {
  const section = sectionSix();
  const documented = documentedNames(section);
  const scripts = scriptNames();

  /** 突き合わせる相手が空だと、下の2つは必ず通る（§2.11 の0件） */
  it("突き合わせる両側が空でない", () => {
    expect(scripts.length).toBeGreaterThan(10);
    expect(documented.size).toBeGreaterThan(10);
  });

  it.each(scriptNames())("`pnpm %s` が §6 に載っている", (name) => {
    expect(documented.has(name)).toBe(true);
  });

  it("§6 に載っているコマンドは全部 package.json に在る", () => {
    const known = new Set(scriptNames());
    const ghosts = [...documented].filter((n) => !known.has(n));
    expect(ghosts).toEqual([]);
  });
});
