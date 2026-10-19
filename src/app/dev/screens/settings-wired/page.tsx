"use client";

/**
 * 予定の設定の確認（開発用）
 *
 * **AppDataContext に固定値を流し込んでいる。** この画面の表は
 * useAppData を内側で呼ぶので、文脈ごと差し替えないと開けない。
 * Supabase には触らない。
 *
 * 保存はしない（setData は state に積むだけ）。基準日を変えると
 * 確認ダイアログ（06b）が出る。
 */

import { useState } from "react";

import type { AppData } from "@/lib/app-data";
import { AppDataContext } from "@/components/app-shell/AppDataProvider";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";

const INITIAL: AppData = {
  asOf: FIXTURE_ASOF,
  reserveLine: 1_500_000,
  accounts: FIXTURE_ACCOUNTS,
  recurring: FIXTURE_RECURRING,
  oneoffs: FIXTURE_ONEOFFS,
  actuals: FIXTURE_ACTUALS,
  overrides: {},
  lastReconciledAt: null,
};

export default function DevSettingsWiredPage() {
  const [data, setState] = useState<AppData>(INITIAL);

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
      <div className="min-h-screen bg-muted">
        <div className="mx-auto flex min-h-screen w-full max-w-main flex-col">
          <SettingsScreen />
        </div>
      </div>
    </AppDataContext.Provider>
  );
}
