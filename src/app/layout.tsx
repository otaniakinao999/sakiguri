import type { Metadata, Viewport } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

/* docs/designsystem.md §2.1
   --family-ui：本文、ラベル、ボタン、数値。アプリ画面はほぼすべてこれ。 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/* --family-display-en：ワードマーク「SAKIGURI」のみ */
const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

/* --family-display-jp（Noto Serif JP）は Web フォントとして読み込まない。
   日本語サブセットが数MBあり、非機能要件 5.1（初回表示3秒以内・4G想定）
   と衝突するため。端末にあるときだけ効く。docs/adr/0005 を参照。 */

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
    /* フォント変数は html に置く。tokens.css の --family-* は :root で
       計算されるため、body に置くと :root からは見えず、
       var(--font-inter, "Inter") のフォールバック側に落ちる。 */
    <html lang="ja" className={`${inter.variable} ${cormorantGaramond.variable}`}>
      <body>{children}</body>
    </html>
  );
}
