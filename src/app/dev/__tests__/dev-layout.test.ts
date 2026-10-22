import { afterEach, describe, expect, it } from "vitest";

import DevLayout from "../layout";

/**
 * /dev が本番に出ないことを留め具で固定する
 *
 * 外れても**画面は普通に動く**ので、目視では気づけない。気づくのは
 * 本番の URL を誰かが踏んだときになる。構造上の不変条件として留める
 * （CLAUDE.md §2.7 の「再実行回数・導線のような構造的な不変条件」）。
 */

const original = process.env.VERCEL_ENV;

afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = original;
});

describe("DevLayout", () => {
  it("本番では 404 にする", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => DevLayout({ children: null })).toThrow();
  });

  it("プレビューでは開ける", () => {
    process.env.VERCEL_ENV = "preview";
    expect(() => DevLayout({ children: null })).not.toThrow();
  });

  it("ローカル（VERCEL_ENV なし）では開ける", () => {
    delete process.env.VERCEL_ENV;
    expect(() => DevLayout({ children: null })).not.toThrow();
  });
});
