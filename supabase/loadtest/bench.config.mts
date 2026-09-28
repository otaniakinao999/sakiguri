/**
 * ローカル再現ベンチ専用の Vitest 設定。
 *
 *     pnpm bench
 *
 * 通常のテスト（`vitest.config.mts`）は `src/**` だけを見るので、この
 * ファイルは `pnpm test` では動かない。10万件を作るのに数百ミリ秒かかり、
 * 毎回のテスト実行に混ぜる理由がないため分けてある。
 *
 * ここで測るのは**実機ではない**。実機（ブラウザ）から取れるのは通信まで
 * で、`JSON.parse` から先は resource timing に出ない。その内側を同じ
 * マシン上で再現して、内訳の桁を出すためのもの。
 */

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  test: {
    include: ["supabase/loadtest/*.test.ts"],
    environment: "node",
    testTimeout: 600_000,
    /* 計測結果を素通しで出す。まとめられると読めない */
    disableConsoleIntercept: true,
    reporters: ["verbose"],
  },
});
