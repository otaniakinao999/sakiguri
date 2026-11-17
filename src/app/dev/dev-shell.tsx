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

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import type { AppData } from "@/lib/app-data";
import { AppDataContext } from "@/components/app-shell/AppDataProvider";
import { makeStore, FIXTURE_USER_ID } from "@/components/app-shell/store-fixture";
import { ownBookOnly } from "@/lib/sharing";
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
  /* **ルールを1件入れてある。** 0件だと、取込の確認画面の「決まり方」が
     いつも「推定」か「—」になり、**ルールで決まった行を一度も出せない**
     （CLAUDE.md §2.11 の3つ目の形）。`ﾂｳｼﾝﾋ` は import-wired の CSV に
     1行ある。長さ違いの2件目はそちらの画面で足している */
  rules: [
    {
      id: "dev-rule-1",
      pattern: "ﾂｳｼﾝﾋ",
      accountId: null,
      direction: null,
      categoryCode: "EXP-03",
      costType: "fixed",
      bizRatio: 50,
      /* **置き換えを入れてある**（FR-59・AC-66）。2件とも空だと、設定の
         ルール表で「置き換えが入っている行」を一度も出せない
         （CLAUDE.md §2.11）。2件目は空のままにして、両方の見え方を出す */
      replaceName: "通信費（ＮＴＴ）",
    },
    /* **2件目は衝突（AC-57f）を画面で出すために要る。** 1件だと、
       `pattern` を打ち替えても衝突する相手がいない ―― 相手が0件の条項は
       必ず通る（CLAUDE.md §2.11 の3つ目の形）。`ﾂｳｼﾝﾋ` に打ち替えると
       1件目と同じ条件になる */
    {
      id: "dev-rule-2",
      pattern: "ﾖｳﾋﾝ",
      accountId: null,
      direction: null,
      categoryCode: "EXP-09",
      costType: "variable",
      bizRatio: 100,
      replaceName: null,
    },
  ],
};

/** /dev/screens/* と本番のルートの対応。現在地をサイドバーに出すため */
const ROUTES: Array<[RegExp, string]> = [
  [/^\/dev\/screens\/dashboard/, "/"],
  [/^\/dev\/screens\/cashflow/, "/cashflow"],
  [/^\/dev\/screens\/pl/, "/pl"],
  [/^\/dev\/screens\/entry/, "/entry"],
  [/^\/dev\/screens\/actuals/, "/actuals"],
  [/^\/dev\/screens\/import/, "/import"],
  [/^\/dev\/screens\/settings/, "/settings"],
];

/**
 * **`useSearchParams()` を呼ぶので Suspense で包む。**
 *
 * ## 版によって、落ちるか落ちないかが変わる
 *
 * **15.5.25 ではこれが無いと `pnpm build` が `/dev/screens/*` の生成で
 * 落ちた**（prerender の途中で CSR へ退避できない）。実際に一度落とし、
 * **その間 Vercel のデプロイが失敗し続けた。**
 *
 * **15.5.29 では落ちない。** 外して確かめた（2026-11-17）── 包まなくても
 * `/dev/screens/*` は静的に生成され、ビルドは通る。
 *
 * **それでも包んだままにする。** `useSearchParams()` を Suspense の外で
 * 呼ぶのは React の側では依然として正しくない書き方で、**次の版で
 * また落ちる側に戻りうる。** 落ちなくなったことは、要らなくなった
 * ことではない。
 *
 * ## いまはゲートが見ている
 *
 * 当時のゲートは typecheck / test / lint だけで、**ビルドを誰も
 * 測っていなかった。** いまは `pnpm gate` の最後が `pnpm build` なので、
 * この種の失敗は PR の前に落ちる（CLAUDE.md §6）。
 */
export function DevShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <DevShellBody>{children}</DevShellBody>
    </Suspense>
  );
}

function DevShellBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [data, setState] = useState<AppData>(DEV_DATA);

  const currentHref = ROUTES.find(([re]) => re.test(pathname))?.[1];

  /* 検証用の口。本番には無い（/dev は本番で notFound） */
  const search = useSearchParams();
  const label = search.get("book");
  const sharedBook = label
    ? {
        books: [
          ...ownBookOnly(FIXTURE_USER_ID),
          { ownerId: "dev-owner", label, own: false, level: "edit" as const },
        ],
        activeOwnerId: "dev-owner",
      }
    : {};

  return (
    <AppDataContext.Provider
      value={makeStore({
        data,
        setData: (update: (previous: AppData) => AppData) =>
          setState((d) => update(d)),
        today: FIXTURE_TODAY,
        saveState: { status: "saved", seq: 0 },
        /* **`?book=渡された帳` で他人の帳にいる状態を出す**（AC-84）。
           付与が0件だと「何も出ない」が正しいので、**実装していなくても
           通る**（§2.11 の3つ目の形）。実機で見るにはこの口が要る */
        ...sharedBook,
      })}
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
