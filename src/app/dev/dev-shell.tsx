"use client";

/**
 * 開発用のアプリシェル
 *
 * **本番（app/(app)/layout.tsx）と同じ組み方にしてある。** 画面だけを
 * 単体で描いていたせいで、ナビと組み合わせた全体を一度も確認しないまま
 * 進めてしまった。シェル側の不具合（Main の二重余白、残高ヘッダーの重複）は
 * 画面単体では見えない。
 *
 * AppDataContext に固定値を流し込む。この中の部品は useAppData を内側で
 * 呼ぶので、文脈ごと差し替えないと Supabase 無しでは開けない。
 */

import { usePathname } from "next/navigation";
import { useState } from "react";

import type { AppData } from "@/lib/app-data";
import { AppDataContext } from "@/components/app-shell/AppDataProvider";
import { Sidebar } from "@/components/app-shell/Sidebar";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";

export const DEV_DATA: AppData = {
  asOf: FIXTURE_ASOF,
  reserveLine: 1_500_000,
  accounts: FIXTURE_ACCOUNTS,
  recurring: FIXTURE_RECURRING,
  oneoffs: FIXTURE_ONEOFFS,
  actuals: FIXTURE_ACTUALS,
  overrides: {},
  lastReconciledAt: null,
};

/** /dev/screens/* と本番のルートの対応。現在地をサイドバーに出すため */
const ROUTES: Array<[RegExp, string]> = [
  [/^\/dev\/screens\/dashboard/, "/"],
  [/^\/dev\/screens\/cashflow/, "/cashflow"],
  [/^\/dev\/screens\/pl/, "/pl"],
  [/^\/dev\/screens\/entry/, "/entry"],
  [/^\/dev\/screens\/import/, "/import"],
  [/^\/dev\/screens\/settings/, "/settings"],
];

export function DevShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [data, setState] = useState<AppData>(DEV_DATA);

  const currentHref = ROUTES.find(([re]) => re.test(pathname))?.[1];

  return (
    <AppDataContext.Provider
      value={{
        data,
        setData: (update) => setState((d) => update(d)),
        today: FIXTURE_TODAY,
        session: null,
        ready: true,
        saveState: { status: "saved", seq: 0 },
        retrySave: () => {},
        loadError: null,
        retryLoad: () => {},
        signOut: async () => {},
      }}
    >
      <div className="flex min-h-screen flex-col bg-muted wide:flex-row">
        {/* Sidebar inset：8px。SideNav 224px と合わせて 240px の列 */}
        <div className="shrink-0 wide:sticky wide:top-0 wide:h-screen wide:p-8">
          <Sidebar currentHref={currentHref} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex min-w-0 flex-1 flex-col pb-64 wide:pb-0">
            {children}
          </main>
        </div>
      </div>
    </AppDataContext.Provider>
  );
}
