/**
 * メールのリンクをどう処理するかを決める（AC-52）
 *
 * 一次情報：docs/要件定義書.md §5.3
 *
 * ## 2つの機構が同じ対象に当たる
 *
 * 受け口はリンクを2通りの形で受けうる。
 *
 * | 形 | いつ来るか |
 * |---|---|
 * | クエリの `token_hash` | メールテンプレートを書き換えたとき（SMTP 導入後） |
 * | 断片の `access_token` | `emailRedirectTo` で既定のテンプレートを使うとき（いま） |
 *
 * **順位を書かないと、実装は「両方を独立に動かす」を選ぶ**（CLAUDE.md §2.9）。
 * 順位はこう決める。
 *
 * 1. クエリに `token_hash` があれば、**そちらで検証する**
 * 2. なければ、断片の値で処理する
 * 3. どちらも無い、または種別が未知なら、**何もせずエラー**
 *
 * **いま実際に使われるのは2だけで、1は使われない。** 1を残す価値は
 * 「SMTP を入れてテンプレートを書き換えたときに移せる」ことだが、
 * **移すときに壊れていたら価値がない。** だから順位そのものを対象にした
 * テストを置く（`auth-link.test.ts`）。各経路を別々に試すだけでは、
 * **順位が入れ替わっても落ちない。**
 *
 * ## 既定で通さない
 *
 * 知らない種別、欠けた値、断片の `error=` は、**何も実行せずに拒む。**
 *
 * この層は純関数。`window` も Supabase も触らない。
 */

/** 受ける種別。**ここに無いものは実行しない** */
export const ALLOWED_TYPES = ["signup", "recovery"] as const;
export type AuthLinkType = (typeof ALLOWED_TYPES)[number];

export type AuthLink =
  /** クエリの `token_hash` を `verifyOtp` に渡す */
  | { kind: "verify"; tokenHash: string; type: AuthLinkType }
  /** 断片のトークンを `setSession` に渡す */
  | { kind: "session"; accessToken: string; refreshToken: string; type: AuthLinkType }
  /** 何も実行しない。`reason` は記録用で、画面には出さない */
  | { kind: "reject"; reason: RejectReason };

export type RejectReason =
  /** 断片に `error=` が入っていた（期限切れなど） */
  | "linkError"
  /** 種別が `ALLOWED_TYPES` に無い */
  | "unknownType"
  /** 値が足りない、またはリンクの形ではない */
  | "missing";

function isAllowed(value: string | null): value is AuthLinkType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

/**
 * クエリと断片から、何をするかを決める。
 *
 * @param search `window.location.search`（`?` 付きでもなくてもよい）
 * @param hash   `window.location.hash`（`#` 付きでもなくてもよい）
 */
export function resolveAuthLink(search: string, hash: string): AuthLink {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));

  /* ---------- 1. クエリの token_hash が最優先 ---------- */
  const tokenHash = query.get("token_hash");
  if (tokenHash) {
    const type = query.get("type");
    /* **断片に落とさない。** 落とすと2つの機構が競う */
    return isAllowed(type)
      ? { kind: "verify", tokenHash, type }
      : { kind: "reject", reason: "unknownType" };
  }

  /* ---------- 2. 断片 ---------- */

  /* 期限切れなどはここに来る。**既定で通さない** */
  if (fragment.get("error") || fragment.get("error_code")) {
    return { kind: "reject", reason: "linkError" };
  }

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken) {
    const type = fragment.get("type");
    return isAllowed(type)
      ? { kind: "session", accessToken, refreshToken, type }
      : { kind: "reject", reason: "unknownType" };
  }

  /* ---------- 3. どちらでもない ---------- */
  return { kind: "reject", reason: "missing" };
}
