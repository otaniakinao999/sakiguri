import { readFileSync } from "node:fs";
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
 * 列挙は漏れる。だから「この値を出しているのにここに無いファイル」が
 * あれば落ちるよう、**競合する言い回しを全ソースから探す**ほうも置く。
 */

/**
 * `Unrecorded.amount` を画面に出しているファイル
 *
 * **数えるファイルではなく、書き出すファイルを列挙する。**
 * ダッシュボードは DashboardScreen が金額を計算して DashboardView が
 * 文字にするので、語を持っているのは View 側。Screen を見ていると
 * 「語を使っていない」で落ちるが、実際には揃っている。
 */
const SHOWS_THE_VALUE = [
  "src/components/app-shell/BalanceHeader.tsx",
  "src/components/dashboard/DashboardView.tsx",
  "src/components/cashflow/BalanceChart.tsx",
];

/** 同じ値に付けてはいけない別の言い回し */
const COMPETING = [
  "まだ記録されていない予定",
  "未記録の予定額",
  "記録されていない分",
  "未入力の予定額",
];

const read = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

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

describe("AC-49e うち未記録の予定の語が3箇所で揃っている", () => {
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

  it.each(SHOWS_THE_VALUE)("%s に競合する言い回しが無い", (path) => {
    /* **区切り文字を頼りに探さない。** 「どちらにも、まだ記録されて
       いない予定」のように読点のあとに続くと、区切りでは拾えない
       （実際に拾えなかった）。コメントだけ落として、あとは全文を見る */
    const source = code(read(path));

    for (const word of COMPETING) {
      expect(source, `「${word}」を画面に出している`).not.toContain(word);
    }
  });

  it("定数は空でない", () => {
    expect(UNRECORDED_LABEL.length).toBeGreaterThan(0);
  });
});
