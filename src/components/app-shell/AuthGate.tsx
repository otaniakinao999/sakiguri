"use client";

/**
 * サインインしていなければアプリを出さない（FR-17）。
 *
 * 認証の確認とデータの読み込みが終わるまでは、どちらとも決めずに待つ。
 * 先にアプリを出すと、空のデータが一瞬見えて「消えた」と誤解させる。
 */

import { SignInScreen } from "@/components/auth/SignInScreen";
import { Button } from "@/components/ui/Button";
import { Notification } from "@/components/ui/Notification";

import { useAppData } from "./AppDataProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, ready, loadError, retryLoad, signOut } = useAppData();

  if (!ready) {
    return (
      <div className="bg-surface-base-secondary text-object-base-mid flex min-h-screen items-center justify-center text-body-sm">
        読み込み中…
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  /**
   * 読み込みに失敗したらアプリを出さない（FR-47、AC-35）。
   *
   * 一部だけ取得できたデータで計算すると、残高も防衛ラインの警告も値は
   * 出てしまうが静かに間違う。**間違った残高を見せるより、読み込めなかった
   * ことを伝えて止めるほうが安全である**（§5.1.2）。
   */
  if (loadError) {
    return (
      <div className="bg-surface-base-secondary flex min-h-screen items-center justify-center p-16">
        <div className="bg-surface-base-primary border-border-base-low rounded-base w-full max-w-[var(--layout-signin-width)] border p-24">
          <h1 className="text-object-base-high mb-12 text-body-lg font-semibold">
            データを読み込めませんでした
          </h1>
          <Notification variant="error">
            一部しか読み込めなかったため、残高を表示していません。途中まで
            のデータで計算すると、残高と警告が実際と違う値になります。
          </Notification>
          <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
            通信が不安定なときに起こります。もう一度お試しください。
            繰り返す場合はサインインし直してください。
          </p>
          <div className="mt-16 flex flex-wrap gap-8">
            <Button color="black" onClick={retryLoad}>
              もう一度読み込む
            </Button>
            <Button onClick={() => void signOut()}>サインアウト</Button>
          </div>
          <p className="text-object-base-low mt-16 text-body-xxs break-words">
            {loadError}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
