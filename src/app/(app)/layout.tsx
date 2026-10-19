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
            <BalanceHeader />
            <main className="min-w-0 flex-1 px-12 pt-16 pb-64 wide:px-24 wide:pt-24">
              {children}
            </main>
          </div>
        </div>
        <SaveToast />
      </AuthGate>
    </AppDataProvider>
  );
}
