/**
 * Playwright（AC-28a / AC-28b のためだけ）
 *
 *     pnpm e2e
 *
 * **既定のゲートには入れない。** `pnpm typecheck && pnpm test && pnpm lint`
 * からは切り離してある。本番ビルドの起動と実サーバーへの通信を伴うので、
 * 毎回のテスト実行に混ぜる理由がない（CLAUDE.md §2.7）。
 *
 * ## 本番ビルドで測る
 *
 * `next dev` は毎リクエストでコンパイルするので、初回表示の時間が本番と
 * まったく違う。**測るなら `next build` → `next start`。**
 *
 * `pnpm build` は dev サーバーが動いていると `.next` を壊す。
 * **先に dev を止めること。**
 *
 * ## データ
 *
 * `scripts/loadtest/` が作った負荷試験アカウントと、そこに入れた実績を
 * 使う。spec はデータを作らない。
 *
 *     pnpm loadtest:account
 *     pnpm loadtest:seed -- --rows=3000 --span=550   # AC-28b
 *     pnpm loadtest:seed -- --rows=3000 --span=90    # AC-28a
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  /* 時間を測るので並列にしない。同時に動かすと互いに遅くする */
  workers: 1,
  fullyParallel: false,
  /* **再試行しない。** 遅いから落ちたのか、たまたま遅かったのかを
     再試行で覆い隠すと、測定にならない */
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },

  webServer: {
    /* 本番ビルドで起動する。`.env.local` は next が読む */
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
