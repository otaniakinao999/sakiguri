import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { UNRECORDED_LABEL } from "../unrecorded";

/**
 * AC-49e。**同じ値を出す箇所の文字列を突き合わせる。**
 *
 * これまでの AC-49e の確認は、画面を目視して「語が揃っている」と読んだ
 * ものだった。**ダッシュボードを見ていなかったので揃っていなかった。**
 * ヘッダーとツールチップが「うち未記録の予定」、ダッシュボードだけ
 * 「まだ記録されていない予定」で、マニュアルの語で探しても見つからない
 * 状態が残っていた。
 *
 * **目視は、見た場所しか見ない。** 見ていない場所は「揃っている」側に
 * 倒れる（§9.1 の6つ目：測る側が通る方向に間違っている）。だから
 * **出している箇所を列挙して、文字列で突き合わせる。**
 *
 * 列挙は漏れる。だから列挙の外側に2つ置く（下の「列挙の外側」）。
 */

/**
 * `Unrecorded.amount` を画面に出しているファイル
 *
 * **数えるファイルではなく、書き出すファイルを列挙する。**
 * ダッシュボードは DashboardScreen が金額を計算して DashboardView が
 * 文字にするので、語を持っているのは View 側。Screen を見ていると
 * 「語を使っていない」で落ちるが、実際には揃っている。
 *
 * **2026-11-01 に3件から2件に減らした。** 3件目は
 * `cashflow/BalanceChart.tsx`（日次チャートのツールチップ）だったが、
 * v0.6.0（ADR-0023）で日次チャートが月次の `MonthlyBalanceChart` に
 * 置き換わり、**どこからも描かれないファイルになっていた。**
 * 置き換わった先は月末残高・月中最低・入金・出金を出すだけで、この値を
 * 出していない。**列挙はそのまま残っていたので、テストは残骸を読んで
 * 通り続けていた**（§2.11：留め具が差を出せない場所を見張っていた）。
 * 月次のツールチップにこの値を出すかどうかは別件。
 */
const SHOWS_THE_VALUE = [
  "src/components/app-shell/BalanceHeader.tsx",
  "src/components/dashboard/DashboardView.tsx",
];

/** 同じ値に付けてはいけない別の言い回し */
const COMPETING = [
  "まだ記録されていない予定",
  "未記録の予定額",
  "記録されていない分",
  "未入力の予定額",
];

const repoRoot = new URL("../../../", import.meta.url);

const read = (path: string) => readFileSync(new URL(path, repoRoot), "utf8");

/**
 * コメントを落とす。
 *
 * **コメントでは古い言い回しに触れてよい**（なぜ変えたかを書くため）。
 * 落とさずに探すと、説明を書いただけで落ちる。逆に落とさないまま
 * 「どこかに語がある」を見ると、**コメントに書いてあるだけで通る。**
 */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** import 行を除いた本体。import があるだけでは「使っている」と見ない */
function body(source: string): string {
  return code(source)
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*\}?\s*from\s+"/.test(line))
    .join("\n");
}

/** `src/` 配下の実装ファイル（テストと、定数そのものの置き場を除く） */
function sourceFiles(): string[] {
  const found: string[] = [];

  const walk = (relative: string) => {
    const absolute = fileURLToPath(new URL(relative, repoRoot));

    for (const name of readdirSync(absolute)) {
      const child = `${relative}/${name}`;

      if (statSync(fileURLToPath(new URL(child, repoRoot))).isDirectory()) {
        if (name !== "__tests__") walk(child);
        continue;
      }

      if (!/\.tsx?$/.test(name)) continue;
      if (child === "src/lib/unrecorded.ts") continue;

      found.push(child);
    }
  };

  walk("src");

  return found;
}

describe("AC-49e うち未記録の予定の語が揃っている", () => {
  it.each(SHOWS_THE_VALUE)("%s が定数を**本体で**使っている", (path) => {
    /* **import にあるだけでは足りない。** 使うのをやめても import が
       残っていれば通ってしまう（実際にそれで通った） */
    expect(body(read(path)), "UNRECORDED_LABEL を本体で使っていない").toContain(
      "UNRECORDED_LABEL",
    );
  });

  it.each(SHOWS_THE_VALUE)("%s が語を直接書いていない", (path) => {
    expect(code(read(path)), "語を直接書いている。定数から引くこと").not.toContain(
      UNRECORDED_LABEL,
    );
  });

  it("定数は空でない", () => {
    expect(UNRECORDED_LABEL.length).toBeGreaterThan(0);
  });
});

/**
 * 列挙の外側
 *
 * **列挙は漏れる。** 上の3つは `SHOWS_THE_VALUE` に書いたファイルしか
 * 見ないので、**列挙を減らすとそのぶん見張りも減る。** 減らしたことに
 * 気づけるよう、列挙に依らない2つを置く。
 *
 * 1. 競合する言い回しを **`src/` 全体から** 探す。前の版はこれを
 *    `SHOWS_THE_VALUE` の中だけで見ていた（コメントは「全ソースから
 *    探す」と書いてあったが、**コードはそうなっていなかった**）。
 * 2. 定数を取り込んだファイルが列挙に入っているかを見る。**新しい
 *    箇所でこの値を出し始めたら、列挙の更新を忘れた時点で落ちる。**
 */
describe("AC-49e 列挙の外側", () => {
  it("競合する言い回しが src/ のどこにも無い", () => {
    const offenders: string[] = [];

    for (const path of sourceFiles()) {
      const source = code(read(path));

      for (const word of COMPETING) {
        if (source.includes(word)) offenders.push(`${path}（「${word}」）`);
      }
    }

    expect(offenders, "同じ値に別の呼び名を付けている").toEqual([]);
  });

  it("定数を使っているファイルが列挙に入っている", () => {
    const users = sourceFiles().filter((path) =>
      body(read(path)).includes("UNRECORDED_LABEL"),
    );

    expect([...users].sort(), "この値を出しているのに SHOWS_THE_VALUE に無い").toEqual(
      [...SHOWS_THE_VALUE].sort(),
    );
  });
});
