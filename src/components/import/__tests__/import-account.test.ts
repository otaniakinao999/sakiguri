// @vitest-environment jsdom

/**
 * AC-67 取込先の口座を前回のまま開く（FR-60）
 *
 * ## 退化させない（CLAUDE.md §2.11）
 *
 * **覚えた口座を「いちばん上」にしない。** 口座一覧の先頭を覚えさせると、
 * `accounts[0]` を返すだけの実装（＝直す前の実装）でも通る。ここでは
 * **3番目の口座**（`a2` △△信金）を覚えさせる。
 *
 * **「覚えている」と「覚えていない」を同じ実行で測る。** 覚えている場合
 * だけだと、常に覚えた値を返す実装と区別が付かない ―― 覚えていないときは
 * いちばん上に戻るのが正しい。
 *
 * **画面まで測る。** 純関数が正しいことと、画面がそれを使っていることは
 * 別の確認である（§2.7 末尾）。`<select>` の値を見る。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { ImportScreen } from "@/components/import/ImportScreen";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import type { AppData } from "@/lib/app-data";
import {
  pickImportAccount,
  readImportAccount,
  writeImportAccount,
} from "@/lib/import-account";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

const USER = "11111111-1111-4111-8111-000000000001";
/** **いちばん上ではない口座**（先頭は `a0` 現金） */
const REMEMBERED = "a2";

const INITIAL: AppData = {
  asOf: FIXTURE_ASOF,
  reserveLine: FIXTURE_RESERVE_LINE,
  lastReconciledAt: null,
  accounts: FIXTURE_ACCOUNTS,
  recurring: FIXTURE_RECURRING,
  oneoffs: FIXTURE_ONEOFFS,
  actuals: [],
  overrides: {},
  rules: [],
};

function Harness({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(INITIAL);
  const store: AppDataStore = {
    data,
    setData: (update) => setData((previous) => update(previous)),
    today: FIXTURE_TODAY,
    session: {
      user: { id: USER },
    } as unknown as AppDataStore["session"],
    ready: true,
    saveState: { status: "idle", seq: 0 },
    retrySave: () => {},
    loadError: null,
    retryLoad: () => {},
    signOut: async () => {},
  };
  return createElement(AppDataContext.Provider, { value: store }, children);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

function openScreen() {
  render(createElement(Harness, null, createElement(ImportScreen)));
  return screen.getByLabelText("どの口座の明細か") as HTMLSelectElement;
}

describe("AC-67 覚える／読み出す", () => {
  it("書いた口座を読み出せる", () => {
    writeImportAccount(USER, REMEMBERED);
    expect(readImportAccount(USER)).toBe(REMEMBERED);
  });

  it("覚えていなければ null", () => {
    expect(readImportAccount(USER)).toBeNull();
  });

  it("別の利用者の口座は読み出さない（鍵を分けている）", () => {
    writeImportAccount(USER, REMEMBERED);
    expect(readImportAccount("22222222-2222-4222-8222-000000000002")).toBeNull();
  });

  it("サインインしていなければ覚えない（鍵が作れない）", () => {
    writeImportAccount(null, REMEMBERED);
    expect(readImportAccount(null)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("AC-67 どの口座を開くか", () => {
  it("覚えた口座を開く。いちばん上には戻らない", () => {
    expect(pickImportAccount("", REMEMBERED, FIXTURE_ACCOUNTS)).toBe(REMEMBERED);
    /* **在ること（覚えた口座）と、戻らないこと（いちばん上でない）を
       同じ実行で測る。** 先頭を覚えさせると、戻る実装でも通る */
    expect(FIXTURE_ACCOUNTS[0].id).not.toBe(REMEMBERED);
  });

  it("覚えていなければ、いちばん上の口座", () => {
    expect(pickImportAccount("", null, FIXTURE_ACCOUNTS)).toBe(
      FIXTURE_ACCOUNTS[0].id,
    );
  });

  it("覚えた口座が消えていたら、いちばん上の口座", () => {
    expect(pickImportAccount("", "消えた口座", FIXTURE_ACCOUNTS)).toBe(
      FIXTURE_ACCOUNTS[0].id,
    );
  });

  it("画面で選び直したものが、覚えた口座より強い", () => {
    expect(pickImportAccount("a1", REMEMBERED, FIXTURE_ACCOUNTS)).toBe("a1");
  });

  it("口座が1件も無ければ空", () => {
    expect(pickImportAccount("", REMEMBERED, [])).toBe("");
  });
});

describe("AC-67 画面がそれを使っている", () => {
  it("覚えた口座が選ばれた状態で開く", () => {
    writeImportAccount(USER, REMEMBERED);
    expect(openScreen().value).toBe(REMEMBERED);
  });

  it("覚えていなければ、いちばん上の口座で開く", () => {
    expect(openScreen().value).toBe(FIXTURE_ACCOUNTS[0].id);
  });

  it("選び直すと覚える（次に開いたときその口座）", () => {
    const select = openScreen();
    expect(select.value).toBe(FIXTURE_ACCOUNTS[0].id);

    /* **`change` で測る。** `onChange` を呼ぶのが画面の仕事で、
       そこで覚えなければ次回に残らない */
    select.value = REMEMBERED;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(readImportAccount(USER)).toBe(REMEMBERED);

    cleanup();
    expect(openScreen().value).toBe(REMEMBERED);
  });
});
