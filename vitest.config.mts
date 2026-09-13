import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /* テストの対象は src/core/ だけ。
       CLAUDE.md §2.3 のとおり core は純関数であり、DOM を必要としない。
       画面のテストを足すときは環境を分ける。 */
    include: ["src/core/**/*.test.ts"],
    environment: "node",
  },
});
