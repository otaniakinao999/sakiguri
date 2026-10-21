import type { Metadata, Viewport } from "next";

/* 書体 ── docs/design/tokens.css §2.1 / HANDOFF_CLAUDE.md
   Inter（数字と記号）／Noto Sans JP（和文）／JetBrains Mono（コード）。

   HANDOFF_CLAUDE.md は next/font/google を指定しているが、この開発環境からは
   fonts.googleapis.com に到達できないため、同じ3書体を npm から自己ホストする。
   tokens.css が var(--font-inter, "Inter") の形で書かれているため、
   変数を与えなくても実体名で解決する（ADR-0023）。

   @fontsource は unicode-range で分割して配信するので、和文でも実際に使う字だけが
   落ちてくる。ADR-0005 が避けたかった「数MBの一括ダウンロード」は起きない。 */
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/jetbrains-mono/400.css";
/* ワードマーク「SAKIGURI」のみ。正式なロゴ画像は未支給（decisions.md 未決2）。 */
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sakiguri",
  description: "個人事業主と小規模法人のための資金繰り予測",
};

/* 非機能要件 5.5：画面幅 375px 以上に対応する */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
