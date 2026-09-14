import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      /* tsconfig の paths と揃える。揃っていないと import が解決できない */
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    /**
     * 対象は純関数だけ。
     *
     * `src/core/` の計算ロジックと、`src/lib/` の表示整形・集計。
     * どちらも DOM を必要としない。画面のテストを足すときは環境を分ける。
     */
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
