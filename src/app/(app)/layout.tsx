/**
 * アプリシェル
 *
 * 一次情報：docs/designsystem.md §5 レイアウト規約
 *   左ナビゲーション + コンテンツ。900px 未満では上部の横並びに切り替える。
 */

import { AppDataProvider } from "@/components/app-shell/AppDataProvider";
import { AuthGate } from "@/components/app-shell/AuthGate";
import { BalanceHeader } from "@/components/app-shell/BalanceHeader";
import { Sidebar } from "@/components/app-shell/Sidebar";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppDataProvider>
      <AuthGate>
        <div className="bg-surface-base-secondary flex min-h-screen flex-col wide:flex-row">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <BalanceHeader />
            <main className="min-w-0 flex-1 px-12 pt-16 pb-64 wide:px-24 wide:pt-24">
              {children}
            </main>
          </div>
        </div>
      </AuthGate>
    </AppDataProvider>
  );
}
