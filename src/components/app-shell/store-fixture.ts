/**
 * `AppDataStore` を組み立てる（検証用のページと検査から使う）
 *
 * **項目を10箇所に並べない**（CLAUDE.md §2.8）。`AppDataStore` に項目が
 * 増えるたび、`/dev/screens/*` と各検査の計10箇所で同じ初期値を足すことに
 * なる。1箇所に置いて、足りないものはここが埋める。
 *
 * **本番は使わない。** 値を入れるのは `AppDataProvider` だけである。
 */

import type { AppData } from "@/lib/app-data";
import { ownBookOnly } from "@/lib/sharing";
import type { AppDataStore } from "./AppDataProvider";

/** 検証用の利用者 id。**自分の帳の id でもある** */
export const FIXTURE_USER_ID = "fixture-user";

export function makeStore(
  over: Partial<AppDataStore> & Pick<AppDataStore, "data">,
): AppDataStore {
  return {
    setData: () => {},
    today: null,
    session: null,
    ready: true,
    saveState: { status: "idle", seq: 0 },
    retrySave: () => {},
    loadError: null,
    retryLoad: () => {},
    signOut: async () => {},
    books: ownBookOnly(FIXTURE_USER_ID),
    activeOwnerId: FIXTURE_USER_ID,
    setActiveOwnerId: () => {},
    ...over,
  };
}

/** `AppData` の既定。検査が一部だけ差し替えられるように */
export function makeData(over: Partial<AppData> & Pick<AppData, "asOf">): AppData {
  return {
    reserveLine: 0,
    lastReconciledAt: null,
    accounts: [],
    recurring: [],
    oneoffs: [],
    actuals: [],
    overrides: {},
    rules: [],
    ...over,
  };
}
