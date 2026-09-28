// @vitest-environment jsdom

/**
 * 読み込みが何回走るか（FR-17、AC-28b）
 *
 * **依存配列そのものを検査しない。** 検査するのは不変条件
 * 「同じ利用者でいる限り、データは1回しか読まない」である。実装を
 * 変えても意味が保たれる形にしてある（CLAUDE.md §2.8）。
 *
 * これは純関数のテストでは絶対に捕まらない。`loadAppData` は正しく、
 * `diffAppData` も正しく、それでも**3回呼ばれていた。** 実績10万件の
 * 利用者で起動時に24.4秒かかっていた原因である。
 *
 * jsdom を使うのは、こういう再実行回数・呼び出し回数のような構造的な
 * 不変条件を固定する場合に限る（CLAUDE.md §2.7）。レイアウトは検証
 * できないし、既存画面への網羅的なテストの後付けもしない。
 */

import type { Session } from "@supabase/supabase-js";
import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyAppData } from "@/lib/app-data";

/* ---------- 差し替え ---------- */

const loadAppData = vi.fn();
const saveDiff = vi.fn();

vi.mock("@/lib/supabase/storage", () => ({
  loadAppData: (...a: unknown[]) => loadAppData(...a),
  saveDiff: (...a: unknown[]) => saveDiff(...a),
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => fakeSupabase,
}));

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

/** `onAuthStateChange` に渡されたコールバック。テストから発火させる */
let authListener: ((event: string, session: Session | null) => void) | null = null;
let initialSession: Session | null = null;

const fakeSupabase = {
  auth: {
    getSession: async () => ({ data: { session: initialSession } }),
    onAuthStateChange: (cb: (e: string, s: Session | null) => void) => {
      authListener = cb;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signOut: async () => {},
  },
};

/**
 * 同じ利用者の、**別オブジェクト**のセッション。
 *
 * supabase-js は `getSession()` と `onAuthStateChange`（`INITIAL_SESSION`、
 * `SIGNED_IN`、`TOKEN_REFRESHED`）で、その都度あたらしいオブジェクトを
 * 渡す。中身が同じでも `Object.is` は false になる。
 */
const sessionFor = (userId: string, token = "t1"): Session =>
  ({ access_token: token, user: { id: userId } }) as unknown as Session;

/* ---------- 本体 ---------- */

const { AppDataProvider } = await import("../AppDataProvider");

beforeEach(() => {
  loadAppData.mockReset();
  loadAppData.mockResolvedValue(emptyAppData("2026-09-28"));
  saveDiff.mockReset();
  authListener = null;
  initialSession = null;
});

afterEach(() => {
  vi.useRealTimers();
});

/* JSX を使わない。tsconfig が jsx: preserve（Next がコンパイルする）なので、
   テストのためだけに変換の設定を足さずに済ませる */
const mount = () => render(createElement(AppDataProvider, null, null));

describe("AC-28b 読み込みは利用者ごとに1回", () => {
  it("サインインしていなければ読まない", async () => {
    mount();
    await waitFor(() => expect(authListener).not.toBeNull());

    expect(loadAppData).not.toHaveBeenCalled();
  });

  /**
   * ここが肝。**起動時に別オブジェクトが3回来ても1回しか読まない。**
   * 実測ではこれが3回走り、小さいテーブルも3往復していた。
   */
  it("同じ利用者の別オブジェクトが3回来ても1回しか読まない", async () => {
    initialSession = sessionFor("u1");
    mount();

    await waitFor(() => expect(loadAppData).toHaveBeenCalledTimes(1));

    /* getSession のあとに来る INITIAL_SESSION と SIGNED_IN */
    await act(async () => {
      authListener?.("INITIAL_SESSION", sessionFor("u1"));
      authListener?.("SIGNED_IN", sessionFor("u1"));
    });

    expect(loadAppData).toHaveBeenCalledTimes(1);
  });

  /**
   * **トークン更新のほうが状況が悪い。** 起動時と違って、利用者が画面を
   * 触っている最中に起きる。実績10万件なら24秒固まる。
   */
  it("トークンが更新されても読み直さない", async () => {
    initialSession = sessionFor("u1", "old");
    mount();
    await waitFor(() => expect(loadAppData).toHaveBeenCalledTimes(1));

    await act(async () => {
      authListener?.("TOKEN_REFRESHED", sessionFor("u1", "new"));
      authListener?.("TOKEN_REFRESHED", sessionFor("u1", "newer"));
    });

    expect(loadAppData).toHaveBeenCalledTimes(1);
  });

  it("別の利用者に変わったら読み直す", async () => {
    initialSession = sessionFor("u1");
    mount();
    await waitFor(() => expect(loadAppData).toHaveBeenCalledTimes(1));

    await act(async () => {
      authListener?.("SIGNED_IN", sessionFor("u2"));
    });

    await waitFor(() => expect(loadAppData).toHaveBeenCalledTimes(2));
  });

  it("サインアウトしてから同じ利用者で入り直したら読み直す", async () => {
    initialSession = sessionFor("u1");
    mount();
    await waitFor(() => expect(loadAppData).toHaveBeenCalledTimes(1));

    await act(async () => {
      authListener?.("SIGNED_OUT", null);
    });
    await act(async () => {
      authListener?.("SIGNED_IN", sessionFor("u1"));
    });

    await waitFor(() => expect(loadAppData).toHaveBeenCalledTimes(2));
  });
});
