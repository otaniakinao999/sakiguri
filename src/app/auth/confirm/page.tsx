"use client";

/**
 * メールのリンクの受け口（AC-52）
 *
 * 一次情報：docs/要件定義書.md §5.3、AC-52
 *
 * ## リンクの形はアプリ側が決める
 *
 * Supabase のメールテンプレートを書き換えて、リンクをここに向けている。
 *
 *     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
 *     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
 *
 * **既定の形（`/auth/v1/verify` → Site URL に `#access_token=…` で戻る）に
 * 合わせない。** 理由は3つ。
 *
 * - アクセストークンが URL の断片に乗り、ブラウザの履歴に残る
 * - `detectSessionInUrl: true` にすると、**全ページの読み込みで URL を
 *   認証情報として検査する**ことになる。認証情報を扱う場所は1本に閉じたい
 * - リンクの形を確かめるために、毎回メールを開くことになる
 *
 * 登録の確認（`signup`）とパスワード再設定（`recovery`）を同じ受け口で受ける。
 *
 * ## 既定で通さない
 *
 * `type` が想定の2つ以外なら、**何も実行せずに**エラーを出す。知らない種類の
 * 検証を走らせない。
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/inputs";
import { Notification } from "@/components/ui/Notification";
import {
  confirmFailure,
  confirmTypeUnknown,
  passwordUpdated,
  type AuthMessage,
} from "@/lib/auth-messages";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

/** 受ける種類。**ここに無いものは実行しない** */
const ALLOWED = ["signup", "recovery"] as const;
type AllowedType = (typeof ALLOWED)[number];

const CONTROL =
  "border-border-base-high bg-surface-base-primary text-object-base-high w-full rounded-base border px-8 py-4 text-body-xs leading-normal";

type Phase =
  | { kind: "working" }
  | { kind: "failed"; message: AuthMessage }
  | { kind: "recovery" }
  | { kind: "done"; message: AuthMessage };

function Confirm() {
  const params = useSearchParams();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * **1回だけ実行する。**
   *
   * トークンは1回で使い切られる。開発時の StrictMode は effect を2回
   * 走らせるので、素直に書くと**2回目が必ず失敗する**（1回目で消費済み）。
   * 画面には失敗だけが出て、原因が分からない。
   */
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      if (!isSupabaseConfigured()) {
        setPhase({ kind: "failed", message: confirmTypeUnknown() });
        return;
      }

      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      /* 既定で通さない。知らない種類は実行しない */
      if (!tokenHash || !ALLOWED.includes(type as AllowedType)) {
        setPhase({ kind: "failed", message: confirmTypeUnknown() });
        return;
      }

      const { error } = await getSupabase().auth.verifyOtp({
        token_hash: tokenHash,
        type: type as AllowedType,
      });

      if (error) {
        setPhase({ kind: "failed", message: confirmFailure(error.code) });
        return;
      }

      /* ここでセッションが張られている。
         登録の確認なら、そのままアプリに入る（AC-52） */
      if (type === "signup") {
        router.replace("/");
        return;
      }
      setPhase({ kind: "recovery" });
    })();
  }, [params, router]);

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) {
      setPhase({ kind: "failed", message: confirmFailure(error.code) });
      setBusy(false);
      return;
    }
    setPhase({ kind: "done", message: passwordUpdated() });
    setBusy(false);
    router.replace("/");
  };

  if (phase.kind === "working") {
    return <p className="text-object-base-mid text-body-xs">確認しています…</p>;
  }

  if (phase.kind === "failed" || phase.kind === "done") {
    return (
      <>
        <Notification variant={phase.kind === "failed" ? "error" : "info"}>
          {phase.message.text}
        </Notification>
        <div className="mt-16">
          <Link href="/">
            <Button color="black">サインインの画面へ</Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submitPassword} className="flex flex-col gap-12">
      <p className="text-object-base-high text-body-xs leading-normal">
        新しいパスワードを設定してください。
      </p>
      <Field label="新しいパスワード" hint="6文字以上">
        {(id) => (
          <input
            id={id}
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={CONTROL}
          />
        )}
      </Field>
      <Button type="submit" color="black" size="lg" disabled={busy}>
        {busy ? "設定中…" : "このパスワードにする"}
      </Button>
    </form>
  );
}

export default function ConfirmPage() {
  return (
    <div className="bg-surface-base-secondary flex min-h-screen items-center justify-center p-24">
      <div className="bg-surface-base-primary border-border-base-low rounded-base w-full max-w-[var(--layout-signin-width)] border p-24">
        <div className="mb-24">
          <p className="font-display-en text-object-base-high text-headline-md tracking-wide leading-none font-bold">
            SAKIGURI
          </p>
        </div>
        <Suspense
          fallback={
            <p className="text-object-base-mid text-body-xs">確認しています…</p>
          }
        >
          <Confirm />
        </Suspense>
      </div>
    </div>
  );
}
