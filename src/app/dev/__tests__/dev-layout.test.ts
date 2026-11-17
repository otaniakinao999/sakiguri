import { describe, expect, it } from "vitest";

import { devScreensOpen } from "../layout";

/**
 * /dev が本番に出ないことを留め具で固定する
 *
 * 外れても**画面は普通に動く**ので、目視では気づけない。気づくのは
 * 本番の URL を誰かが踏んだときになる。構造上の不変条件として留める
 * （CLAUDE.md §2.7 の「再実行回数・導線のような構造的な不変条件」）。
 *
 * ## 退化させない（§2.11）
 *
 * **「塞がる」だけを測ると、常に塞ぐ実装でも通る。** 開発サーバーで
 * 開けることと、明示的に開けられることを**同じ実行で測る。**
 *
 * **1以外の値で開かないことまで測る。** `"0"` や `"false"` で開くと、
 * 「無効にしたつもり」が開いたままになる ―― 倒れる方向が元に戻る。
 */

describe("devScreensOpen", () => {
  it("本番ビルドでは既定で塞ぐ", () => {
    expect(devScreensOpen("production", undefined)).toBe(false);
  });

  it("本番ビルドでも ALLOW_DEV_SCREENS=1 なら開く", () => {
    expect(devScreensOpen("production", "1")).toBe(true);
  });

  it("開発サーバーでは開く", () => {
    expect(devScreensOpen("development", undefined)).toBe(true);
  });

  it("テストでは開く（NODE_ENV が production でない）", () => {
    expect(devScreensOpen("test", undefined)).toBe(true);
  });

  it.each(["0", "false", "", "true", "yes"])(
    "本番ビルドで ALLOW_DEV_SCREENS=%o では開かない",
    (value) => {
      expect(devScreensOpen("production", value)).toBe(false);
    },
  );
});
