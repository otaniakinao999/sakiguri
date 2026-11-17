import type { NextConfig } from "next";

/**
 * 応答ヘッダ ―― CSP はまず **report-only** で入れる
 *
 * ## なぜ段を踏むか
 *
 * 本番で実データを運用中なので、**黙って壊れるのがいちばん重い。**
 * 強制で入れると、違反した読み込みは**コンソールにだけ出て**画面は
 * 静かに欠ける。だから `Content-Security-Policy-Report-Only` から
 * 始め、**全画面を踏んで違反が0になってから** `ENFORCE` を立てる。
 *
 * ## 測るときの注意（CLAUDE.md §2.11）
 *
 * **このヘッダは本番ビルドにしか付かない**（下の `isProd`）。`pnpm dev`
 * は HMR が `eval` を使うので、開発サーバーで測ると出るはずのない違反が
 * 並び、**本物の違反が埋もれる。** 測るときは：
 *
 *     pnpm build && pnpm start -p 3100
 *
 * **ビルドを忘れると `.next` の前回ぶんが配られる。** 起動も表示も
 * 成功するので、「確かめた」と記録できてしまう。
 *
 * ## `script-src` に `'unsafe-inline'` が入っている理由と、その代償
 *
 * Next の App Router は RSC のペイロードを**inline script で流す**ので、
 * `'self'` だけでは本文が出ない。nonce を使うには middleware が必要で、
 * **20ルート全部が静的生成から外れる**（`pnpm build` の ○ の数）。
 *
 * 代償は正直に書く。`'unsafe-inline'` があると、**差し込まれたスクリプトの
 * 実行は止められない** ―― `docs/セキュリティの状況.md` の2行目の守りは
 * ほぼ無くなる。残るのは「**出て行けない**」側で、こちらは効く：
 *
 * | 止まるもの | 効いている指定 |
 * |---|---|
 * | 別の宛先への fetch / XHR / WebSocket | `connect-src` |
 * | 画像ビーコンでの持ち出し | `img-src` |
 * | 別の宛先への form 送信 | `form-action` |
 * | 外部スクリプトの読み込み | `script-src` の宛先 |
 * | iframe への埋め込み（クリックジャック） | `frame-ancestors`＋`X-Frame-Options` |
 *
 * **「実行を止める」から「持ち出しを止める」に下がる。** 消えるわけでは
 * ないが、半分である。nonce に進むかは静的生成20ルートとの取引。
 */

/** `true` にすると強制になる。**全画面で違反0を確かめてから立てる。** */
const ENFORCE = false;

const isProd = process.env.NODE_ENV === "production";

/**
 * Supabase の宛先は**環境変数から引く。写し取らない**（CLAUDE.md §2.8）。
 * project ref は元から公開なのでヘッダに出して差し支えない。
 */
const supabaseOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
})();

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  /* Recharts が inline style を出す。inline script とは重さが違うので
     ここは妥協する ―― 持ち出しの経路にならない */
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  /* 書体は自前（@fontsource）。/_next/static から出るので 'self' */
  "font-src 'self'",
  ["connect-src 'self'", supabaseOrigin].filter(Boolean).join(" "),
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  /**
   * 画像の最適化を止める ―― **この口を開けている理由が1つも無い。**
   *
   * `next/image` の呼び出しが0件、`public/` も無く、SVG も持っていない。
   * それでも `/_next/image` は 200 を返していた（本番・ローカルの両方で
   * 確かめた）。いま `next` には**この口の critical が出ている**
   * （Image Optimization API ＋ SVG で未認証の RCE。`pnpm audit`）。
   *
   * 版を上げるのとは別に、**使っていない口を閉じる。** 版を上げても
   * 次の穴はまた同じ口に出る。
   */
  images: { unoptimized: true },

  async headers() {
    if (!isProd) return [];
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: ENFORCE
              ? "Content-Security-Policy"
              : "Content-Security-Policy-Report-Only",
            value: csp,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          /* 外に出る宛先が1つも無いので、送らないことに代償が無い */
          { key: "Referrer-Policy", value: "no-referrer" },
          /* **report-only の `frame-ancestors` は効かない。** 強制に
             するまでのクリックジャックはこの1本が止める */
          { key: "X-Frame-Options", value: "DENY" },
          /* どれも使っていない。盗まれたセッションから使われる口を消す */
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=()",
          },
          /* Strict-Transport-Security は **Vercel が既に付けている**
             （max-age=63072000; includeSubDomains; preload）。二重に
             しない ―― 確かめ方は `curl -D - -o /dev/null <本番>` */
        ],
      },
    ];
  },
};

export default nextConfig;
