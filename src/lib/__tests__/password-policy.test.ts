/**
 * パスワードの最低文字数が**1箇所しか無い**ことを固定する（CLAUDE.md §2.8）
 *
 * ## なぜ要るか
 *
 * 直前まで、同じ数字が**5箇所に書き写されていた** ―― 2つの画面の
 * `minLength` と脇の文言、それに失敗の文面。**片方だけ直せる形**で、
 * 文面と `minLength` が食い違っても誰も気づかない。
 *
 * ## 「在ること」と「無いこと」を同じ実行で測る（CLAUDE.md §2.11）
 *
 * 「リテラルの数字が無い」だけを測る検査は、**見る先が間違っていても
 * 通る。** ファイルの名前を列挙していれば、その画面が消えた日にも
 * 緑で出る（§2.11 の4つ目）。
 *
 * そこで**列挙しない。** `src/` の中からパスワードの入力欄を探し、
 * **1つ以上見つかることを先に確かめてから**、見つかった全部が定数を
 * 見ていることを測る。**新しい画面にパスワード欄を足したら落ちる**
 * （§2.8 の「集合の全体と突き合わせる」）。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  signUpFailure,
} from "@/lib/auth-messages";

const ROOT = "src";
/** 定数の出どころ自身。ここだけは数字を持っていてよい */
const SOURCE = "src/lib/auth-messages.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const FILES = walk(ROOT).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

/** パスワードの入力欄を持つファイル。**手で列挙しない** */
const WITH_PASSWORD_INPUT = FILES.filter(
  (f) => f.text.includes('type="password"') && !f.path.includes("__tests__"),
);

describe("パスワードの最低文字数", () => {
  it("突き合わせる両側が空でない ―― 入力欄が実在する", () => {
    /* **0件だとこの下の全部が必ず通る。** 先にここで落とす（§2.11） */
    expect(WITH_PASSWORD_INPUT.length).toBeGreaterThanOrEqual(2);
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(WITH_PASSWORD_INPUT.map((f) => f.path))(
    "%s が定数を見ている",
    (path) => {
      const { text } = WITH_PASSWORD_INPUT.find((f) => f.path === path)!;
      expect(text).toContain("minLength={PASSWORD_MIN_LENGTH}");
      expect(text).toContain("PASSWORD_HINT");
    },
  );

  it("`minLength` にリテラルの数字を書いていない", () => {
    const literals = FILES.filter(
      (f) => /minLength=\{\s*\d/.test(f.text) || /minLength="\d/.test(f.text),
    ).map((f) => f.path);
    expect(literals).toEqual([]);
  });

  it("「N文字以上」を書き写していない ―― 出どころ以外に数字が無い", () => {
    const literals = FILES.filter(
      (f) => f.path !== SOURCE && /\d+\s*文字以上/.test(f.text),
    ).map((f) => f.path);
    expect(literals).toEqual([]);
  });

  it("出どころの側には数字が在る ―― 文言が定数から作られている", () => {
    /* 上2つは「無いこと」の検査。**同じ実行で「在ること」も見る**（§2.11） */
    expect(PASSWORD_HINT).toBe(`${PASSWORD_MIN_LENGTH}文字以上`);
    expect(PASSWORD_HINT).toMatch(/^\d+文字以上$/);
  });

  it("弱いパスワードの文面が、同じ数字を出す", () => {
    /* **文面と `minLength` が食い違ったら落ちる**形にするための1本 */
    const message = signUpFailure("weak_password");
    expect(message.text).toContain(`${PASSWORD_MIN_LENGTH}文字以上`);
  });

  it("本番の設定より厳しいか、同じである", () => {
    /**
     * 本番（Supabase の dashboard）は**まだ6文字**
     * （`pnpm loadtest:auth` で測った。`docs/セキュリティの状況.md` §3）。
     *
     * **画面のほうが緩いと、画面が通して本番が弾く窓が開く。**
     * dashboard を上げたらこの数字も上げる ―― 下げるときは、
     * **先に dashboard を下げること。**
     */
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(6);
  });
});
