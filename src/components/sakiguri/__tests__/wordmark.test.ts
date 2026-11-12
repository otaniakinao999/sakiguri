/**
 * ロゴが面の色に溶けないこと（2026-11-13）
 *
 * **いちばん壊れやすいのはここである。** 支給された SVG は `fill="white"`
 * だった。そのまま置くと**白い面に白で何も見えない。** 明るい面は
 * サインインと確認の2画面で、どちらも入る前の画面なので、**壊れていても
 * 自分では気づきにくい**（使っている人は既にサインインしている）。
 *
 * ## これが測っていないこと
 *
 * **色が本当に見えていることは測れない。** `currentColor` の解決も、
 * 面との対比も、計算後のスタイルを読む必要があり、jsdom にはレイアウトも
 * 色の解決も無い（CLAUDE.md §2.7）。実機で見るしかない。
 *
 * 測るのは**その手前の2つ**である。どちらも、壊れ方が「色が決め打ちに
 * なる」という形で現れる。
 *
 *   1. ロゴ自身が色を持たないこと（`currentColor` だけ）
 *   2. 置いた側が色と高さを渡していること
 *
 * ## 置き場所は列挙しない（§2.8）
 *
 * **`src/` を走査して `Wordmark` を置いている全部を見る。** 手で並べると、
 * 4箇所目ができたときに漏れる ―― そのときに起きるのが**その画面だけ
 * 見えないロゴ**である。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");
const SELF = resolve(__dirname, "../Wordmark.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** `<Wordmark className="…" />` を置いている箇所。ファイルと class */
const PLACEMENTS = walk(SRC)
  .filter((path) => path !== SELF && !path.includes("__tests__"))
  .flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/<Wordmark\s+className="([^"]*)"/g)].map((m) => ({
      file: relative(SRC, path),
      className: m[1],
    }));
  });

const SOURCE = readFileSync(SELF, "utf8");

/**
 * 描画されるところだけ。**説明の文は外す。**
 *
 * 最初ここを分けておらず、「支給物は `fill="white"` だった」と書いた
 * 冒頭のコメントに当たって落ちた ―― 留め具が**コメントを読んでいた。**
 */
const MARKUP = SOURCE.slice(SOURCE.indexOf("<svg"), SOURCE.indexOf("<clipPath"));

describe("ロゴ自身は色を持たない（§2.6）", () => {
  it("塗りは currentColor だけ", () => {
    const fills = [...MARKUP.matchAll(/\bfill="([^"]*)"/g)].map((m) => m[1]);
    /* **在ることを先に見る。** 0件なら下の「無いこと」は何も測らない */
    expect(fills).toContain("currentColor");

    /* 許すのは currentColor と none だけ。**`<clipPath>` の中の
       `fill="white"` は描画に出ない**（切り抜きの形としか使われない）ので
       `MARKUP` から外してある */
    expect(fills.filter((f) => f !== "currentColor" && f !== "none")).toEqual([]);
  });

  it("リテラルの色が無い（#hex・rgb・色名）", () => {
    /* **在ることを先に見る。** 描画されるところを本当に切り出せているか
       ―― 空文字列なら下の3つは必ず通る（§2.11 の3つ目の形） */
    expect(MARKUP).toContain("<path");
    expect(MARKUP).toContain('fill="currentColor"');

    expect(MARKUP).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(MARKUP).not.toMatch(/\brgba?\(/);
    expect(MARKUP).not.toMatch(/(?:stroke|fill)="(?:white|black|#)/);
  });

  it("高さの既定を持たない（置いた側の h-* と二重にならない）", () => {
    /* 既定の `h-*` と呼び出し側の `h-*` が両方付くと、どちらが効くかは
       CSS の順序で決まり、属性に書いた順では決まらない */
    expect(SOURCE).toMatch(/className=\{`w-auto \$\{className\}`\}/);
    expect(SOURCE).not.toMatch(/`w-auto h-\d/);
  });
});

describe("置いた側が色と高さを渡す", () => {
  it("置き場所が3つ以上見つかる（走査が死んでいない）", () => {
    /* **留め具が見る先が消えていても通る**という形を避ける（§2.11）。
       サイドバー・サインイン・確認の3つが下限 */
    expect(PLACEMENTS.length).toBeGreaterThanOrEqual(3);
    const files = PLACEMENTS.map((p) => p.file);
    expect(files).toContain("components/app-shell/Sidebar.tsx");
    expect(files).toContain("components/auth/SignInScreen.tsx");
    expect(files).toContain("app/auth/confirm/page.tsx");
  });

  it("どの置き場所も `text-*` と `h-*` を渡している", () => {
    for (const { file, className } of PLACEMENTS) {
      expect(`${file}: ${className}`).toMatch(/\btext-[a-z]/);
      expect(`${file}: ${className}`).toMatch(/\bh-\d+\b/);
    }
  });

  it("濃い面と明るい面で違う色を渡している", () => {
    /* **同じ色を渡していたら、どちらかが面に溶ける。** 片方だけ見ると
       「全部に同じ text-* を渡す実装」と区別が付かない */
    const of = (file: string) =>
      PLACEMENTS.find((p) => p.file === file)!.className.match(/\btext-[\w-]+/)![0];
    expect(of("components/app-shell/Sidebar.tsx")).not.toBe(
      of("components/auth/SignInScreen.tsx"),
    );
  });

  it("高さはスケールの中（ADR-0004 で既定のスケールを落としている）", () => {
    /* `h-28` と書くと黙って効かない（`--spacing-28` が無い）。
       §2.6 の 4/8/12/16/24/32/40/48 だけ */
    const SCALE = [4, 8, 12, 16, 24, 32, 40, 48];
    for (const { file, className } of PLACEMENTS) {
      for (const m of className.matchAll(/\bh-(\d+)\b/g)) {
        expect(`${file}: h-${m[1]}`).toBe(
          `${file}: h-${SCALE.includes(Number(m[1])) ? m[1] : "スケール外"}`,
        );
      }
    }
  });
});
