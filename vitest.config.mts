import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  /**
   * JSX の変換。
   *
   * tsconfig は `jsx: "preserve"`（Next がコンパイルする）ので、
   * そのままだと `.tsx` を読み込んだ時点で構文エラーになる。テストの
   * ためだけに tsconfig を変えたくないので、ここで指定する。
   */
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  resolve: {
    alias: {
      /* tsconfig の paths と揃える。揃っていないと import が解決できない */
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    /**
     * 既定は node。**DOM を要るテストだけがファイル先頭で切り替える。**
     *
     *     // @vitest-environment jsdom
     *
     * ほとんどは純関数（`src/core/` の計算、`src/lib/` の整形・集計）で
     * DOM を必要としない。全体を jsdom にすると、その大半が理由なく
     * 遅くなる。
     *
     * jsdom を使うのは、再実行回数・呼び出し回数・導線のような**構造的な
     * 不変条件**を固定する場合に限る（CLAUDE.md §2.7）。レイアウトは
     * 検証できない。
     */
    /**
     * **`.tsx` も集める。**
     *
     * 末尾を `.test.ts` に限ると、`.tsx` で置いたテストが
     * **黙って集められない。** 0件のテストが通ったのと見分けがつかず、
     * 単体で流さない限り気づけない（CLAUDE.md §2.11 の「留め具が
     * 見ている先が死んでいる」形）。拡張子は何も強制していなかった
     * ―― jsdom を使うテストは `.ts` でも書ける（`createElement`）。
     *
     * **JSX を書いてよくなったわけではない。** jsdom を使う範囲は
     * §2.7 のままで、これは置き場所を間違えたときに**落ちる**ように
     * しただけである（2026-11-11）。
     */
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
