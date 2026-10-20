/**
 * アプリシェル
 *
 * 一次情報：docs/design/screens.md §0 共通レイアウト（Figma 2029:178）
 *   画面の地は bg-muted。左に 8px のインセットを取って SideNav を置き、
 *   Main だけがスクロールする。
 *
 * 900px 未満では上部の横並びに切り替える。v0.6.0 に記述がないため、
 * 既存の挙動（非機能要件 5.5：375px 以上に対応）をそのまま残している。
 */

import { AppDataProvider } from "@/components/app-shell/AppDataProvider";
import { AuthGate } from "@/components/app-shell/AuthGate";
import { BalanceHeader } from "@/components/app-shell/BalanceHeader";
import { SaveToast } from "@/components/app-shell/SaveToast";
import { Sidebar } from "@/components/app-shell/Sidebar";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppDataProvider>
      <AuthGate>
        <div className="flex min-h-screen flex-col bg-muted wide:flex-row">
          {/* Sidebar inset：8px。SideNav 224px と合わせて 240px の列になる。 */}
          <div className="shrink-0 wide:sticky wide:top-0 wide:h-screen wide:p-8">
            <Sidebar />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* **広いときは出さない。** PageHeader の残高サマリーが同じ値を
                出すので二重になる（Figma 2030:97 の Main は PageHeader から
                始まっていて、この帯は無い）。狭いときは PageHeader の
                サマリーが折り返して消えるため、こちらが受け持つ */}
            <div className="wide:hidden">
              <BalanceHeader />
            </div>
            {/* **余白を持たせない。** PageHeader が自前で px-32 と下辺の
                罫線を持っていて、外から足すと罫線が端まで届かず、
                余白も二重になる */}
            <main className="flex min-w-0 flex-1 flex-col pb-64 wide:pb-0">
              {children}
            </main>
          </div>
        </div>
        <SaveToast />
      </AuthGate>
    </AppDataProvider>
  );
}
