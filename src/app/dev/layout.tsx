/**
 * /dev 配下を本番から外す
 *
 * この下のページは **AuthGate の外**に置いてある。Supabase に繋がらない
 * 環境でも開けるようにするためで（確認用）、本番に出す意図はない。
 * リポジトリも Vercel の本番 URL も公開なので、ここで塞がないと
 * URL を知っている人は誰でも開ける。中身は架空の数字だけだが、出さない。
 *
 * ## **倒れる方向を逆にした**（2026-11-17）
 *
 * 前は `VERCEL_ENV === "production"` のときだけ塞いでいた。これは
 * **開く方向に倒れる** ―― preview では生きているし、この変数が無い
 * 場所（別のホスティング、手で動かした本番ビルド）でも生きる。
 *
 * いまは**本番ビルドでは既定で塞ぎ**、要るときだけ `ALLOW_DEV_SCREENS=1`
 * で明示的に開ける。開発サーバー（`pnpm dev`）はそのまま開く。
 *
 * **この判定はビルド時に焼き付く**（/dev 配下は全部 prerender される）。
 * 確かめた：
 *
 * | ビルド | /dev/screens/* |
 * |---|---|
 * | `pnpm build` | **404**（3ページとも） |
 * | `ALLOW_DEV_SCREENS=1 pnpm build` | 200（3ページとも） |
 *
 * **`pnpm start` に付けても効かない。** 焼かれた後なので、付け忘れでは
 * なく**ビルドのやり直し**が要る：
 *
 *     ALLOW_DEV_SCREENS=1 pnpm build && pnpm start -p 3100
 */

import { notFound } from "next/navigation";

/** 本番ビルドで /dev を開けてよいか。**既定は閉じている** */
export function devScreensOpen(
  nodeEnv: string | undefined,
  allow: string | undefined,
): boolean {
  if (nodeEnv !== "production") return true;
  return allow === "1";
}

export default function DevLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (
    !devScreensOpen(process.env.NODE_ENV, process.env.ALLOW_DEV_SCREENS)
  ) {
    notFound();
  }
  return <>{children}</>;
}
