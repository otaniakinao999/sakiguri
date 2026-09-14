"use client";

/**
 * サインインしていなければアプリを出さない（FR-17）。
 *
 * 認証の確認とデータの読み込みが終わるまでは、どちらとも決めずに待つ。
 * 先にアプリを出すと、空のデータが一瞬見えて「消えた」と誤解させる。
 */

import { SignInScreen } from "@/components/auth/SignInScreen";

import { useAppData } from "./AppDataProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAppData();

  if (!ready) {
    return (
      <div className="bg-surface-base-secondary text-object-base-mid flex min-h-screen items-center justify-center text-body-sm">
        読み込み中…
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <>{children}</>;
}
