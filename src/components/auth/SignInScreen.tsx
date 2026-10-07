"use client";

/**
 * サインイン・登録（FR-17）
 *
 * 一次情報：docs/要件定義書.md §5.3
 *   メール＋パスワード（ハッシュは Argon2id 以上）、または OAuth。
 *   2要素認証は v1.5。
 *
 * パスワードのハッシュ化と保管は Supabase Auth が受け持つ。
 * このアプリはパスワードを保存しない（要件定義書 §5.3）。
 */

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/inputs";
import { Notification } from "@/components/ui/Notification";
import {
  ACTION_LABEL,
  resendNotice,
  signInFailure,
  signUpFailure,
  signUpNotice,
  type AuthAction,
  type AuthMessage,
} from "@/lib/auth-messages";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

const CONTROL =
  "border-border-base-high bg-surface-base-primary text-object-base-high w-full rounded-base border px-8 py-4 text-body-xs leading-normal";

export function SignInScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /** 失敗の案内。導線つき（AC-53） */
  const [error, setError] = useState<AuthMessage | null>(null);
  /** 成否に触れない案内。導線つき（AC-51） */
  const [notice, setNotice] = useState<AuthMessage | null>(null);

  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <Notification variant="error">
          Supabase の設定がありません。`.env.local` に
          NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を
          設定してください。
        </Notification>
      </Shell>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = getSupabase();
    const credentials = { email: email.trim(), password };

    if (mode === "signin") {
      const { error: failed } = await supabase.auth.signInWithPassword(credentials);
      if (failed) setError(signInFailure(failed.code));
      setBusy(false);
      return;
    }

    const { error: failed } = await supabase.auth.signUp(credentials);
    if (failed) {
      setError(signUpFailure(failed.code));
    } else {
      /**
       * **応答の中身で分岐しない（AC-51）。**
       *
       * 既存のアドレスだと `data.user.identities` が空配列で返るが、
       * **それを見て文面を変えてはならない。** 変えた瞬間に、任意の
       * アドレスを入れて登録の有無を調べられる。
       *
       * `signUpNotice()` が引数を取らないのは、**分岐しようがない形に
       * してある**ため。
       */
      setNotice(signUpNotice());
    }
    setBusy(false);
  };

  /** 確認メールの再送。**送ったという動作だけを伝える**（AC-51 と同じ原則） */
  const resend = async () => {
    setBusy(true);
    setError(null);
    const { error: failed } = await getSupabase().auth.resend({
      type: "signup",
      email: email.trim(),
    });
    /* 失敗しても「そのアドレスは無い」とは言わない。送信の制限だけ伝える */
    setNotice(failed ? signUpFailure(failed.code) : resendNotice());
    setBusy(false);
  };

  /**
   * パスワード再設定のメールを送る。
   *
   * **認証基盤は、そのアドレスが存在してもしなくても成功を返す。**
   * こちらも成否に触れず「送った」とだけ書く（AC-51 と同じ原則）。
   *
   * **このメールのリンクの着地点は、確認メールと同じ問題を抱えている。**
   * いまは `detectSessionInUrl: false` なので、リンクを踏んでもセッションが
   * 張られない（AC-52）。**確認メールも同じ状態なので、ここだけ止めても
   * 揃わない。** AC-52 の経路を作るときに、`type=recovery` も同じ経路で
   * 受けて新しいパスワードを設定する画面につなぐ。
   */
  const resetPassword = async () => {
    setBusy(true);
    setError(null);
    const { error: failed } = await getSupabase().auth.resetPasswordForEmail(
      email.trim(),
    );
    setNotice(
      failed
        ? signUpFailure(failed.code)
        : {
            text:
              "このメールアドレス宛にパスワード再設定のメールをお送りしました。" +
              "メールのリンクを開いて、新しいパスワードを設定してください。",
            actions: [],
          },
    );
    setBusy(false);
  };

  const runAction = (action: AuthAction) => {
    if (action === "signin" || action === "signup") {
      setMode(action === "signin" ? "signin" : "signup");
      setError(null);
      setNotice(null);
      return;
    }
    if (action === "resend") void resend();
    if (action === "reset") void resetPassword();
  };

  return (
    <Shell>
      <form onSubmit={submit} className="flex flex-col gap-12">
        {error && (
          <Notification variant="error">
            <Guidance message={error} onAction={runAction} busy={busy} />
          </Notification>
        )}
        {notice && (
          <Notification>
            <Guidance message={notice} onAction={runAction} busy={busy} />
          </Notification>
        )}

        <Field label="メールアドレス">
          {(id) => (
            <input
              id={id}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={CONTROL}
            />
          )}
        </Field>

        <Field
          label="パスワード"
          hint={mode === "signup" ? "6文字以上" : undefined}
        >
          {(id) => (
            <input
              id={id}
              type="password"
              required
              minLength={6}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={CONTROL}
            />
          )}
        </Field>

        <Button type="submit" color="black" size="lg" disabled={busy}>
          {busy ? "処理中…" : mode === "signin" ? "サインイン" : "登録する"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="text-object-accent-dim text-body-xs underline"
        >
          {mode === "signin"
            ? "はじめての方はこちら（登録）"
            : "すでに登録済みの方はこちら（サインイン）"}
        </button>
      </form>

      <p className="text-object-base-mid mt-24 text-body-xxs leading-normal">
        口座番号・カード番号・金融機関の認証情報は保存しません。CSVファイル
        そのものもサーバーに送りません（要件定義書 §5.3、§5.1.1）。
      </p>
    </Shell>
  );
}

/**
 * 案内と、その**同じ場所**に置く導線（AC-51・AC-53）。
 *
 * **導線を別の場所に置かない。** 状態を言わない代わりに利用者が自力で
 * 選べるようにするのが導線の役目なので、文面から離すと意味が薄れる。
 */
function Guidance({
  message,
  onAction,
  busy,
}: {
  message: AuthMessage;
  onAction: (action: AuthAction) => void;
  busy: boolean;
}) {
  return (
    <>
      {message.text}
      {message.actions.length > 0 && (
        <span className="mt-8 flex flex-wrap gap-8">
          {message.actions.map((action) => (
            <Button
              key={action}
              size="sm"
              disabled={busy}
              onClick={() => onAction(action)}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
        </span>
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-base-secondary flex min-h-screen items-center justify-center p-24">
      <div className="bg-surface-base-primary border-border-base-low rounded-base w-full max-w-[var(--layout-signin-width)] border p-24">
        <div className="mb-24">
          <p className="font-display-en text-object-base-high text-headline-md tracking-wide leading-none font-bold">
            SAKIGURI
          </p>
          <p className="font-display-jp text-object-base-mid mt-4 text-body-xxs">
            個人事業主の資金繰り帳
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
