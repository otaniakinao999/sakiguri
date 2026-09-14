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
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

const CONTROL =
  "border-border-base-high bg-surface-base-primary text-object-base-high w-full rounded-base border px-8 py-4 text-body-xs leading-normal";

export function SignInScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

    const { error: failed } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    if (failed) {
      setError(failed.message);
    } else if (mode === "signup") {
      setNotice(
        "登録しました。確認メールが届いている場合は、リンクを開いてからサインインしてください。",
      );
    }
    setBusy(false);
  };

  return (
    <Shell>
      <form onSubmit={submit} className="flex flex-col gap-12">
        {error && <Notification variant="error">{error}</Notification>}
        {notice && <Notification>{notice}</Notification>}

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
