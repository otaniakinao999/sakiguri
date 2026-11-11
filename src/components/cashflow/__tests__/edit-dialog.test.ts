// @vitest-environment jsdom

/**
 * 入出金予定表の明細から実績を編集する経路も、同じ出し方を通ること
 * （FR-55・AC-60）
 *
 * **3つめの経路。** やることの2経路は
 * `src/components/entry/__tests__/edit-dialog.test.ts` で測っている。
 * ここは**別の画面**なので、同じ条項をもう一度測る ―― AC-60 は
 * 「どの経路でも効くこと」であり、1経路だけに付いていたのが
 * もとの欠陥である。
 *
 * この経路は**開いてはいた。** 表の上端に箱を出していたので、下のほうの
 * 行を押すと開いた画面が画面の外にあった。「期間絞り込みでリンクが
 * 動作しない」という報告の正体がこれである。したがって「開くこと」だけ
 * では足りず、覆い・背後のスクロール固定・Esc を測る。
 *
 * 位置と重なりは測れない（レイアウトエンジンが無い）。実機で見る。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { CashflowScreen } from "@/components/cashflow/CashflowScreen";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import type { AppData } from "@/lib/app-data";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

afterEach(cleanup);

const INITIAL: AppData = {
  asOf: FIXTURE_ASOF,
  reserveLine: FIXTURE_RESERVE_LINE,
  lastReconciledAt: null,
  accounts: FIXTURE_ACCOUNTS,
  recurring: FIXTURE_RECURRING,
  oneoffs: FIXTURE_ONEOFFS,
  actuals: FIXTURE_ACTUALS,
  overrides: {},
  rules: [],
};

function Harness({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(INITIAL);
  const store: AppDataStore = {
    data,
    setData: (update) => setData((previous) => update(previous)),
    today: FIXTURE_TODAY,
    session: null,
    ready: true,
    saveState: { status: "idle", seq: 0 },
    retrySave: () => {},
    loadError: null,
    retryLoad: () => {},
    signOut: async () => {},
  };
  return createElement(AppDataContext.Provider, { value: store }, children);
}

/**
 * 明細で押せる行（実績の行）。
 *
 * 名前で引く。**0件なら下の `it` は一度も確かめない**ので、件数を
 * 先に見る（CLAUDE.md §2.11 の3つ目の形）。
 */
function clickableRows() {
  const names = new Set(FIXTURE_ACTUALS.map((a) => a.name));
  return screen
    .getAllByRole("button")
    .filter((b) => names.has(b.textContent?.trim() ?? ""));
}

describe("AC-60 明細から実績を編集する経路（FR-55）", () => {
  it("押せる実績の行が明細に在る（測る対象がある）", () => {
    render(createElement(Harness, null, createElement(CashflowScreen)));
    expect(clickableRows().length).toBeGreaterThan(0);
  });

  it("覆いの中に開き、Esc で閉じる", () => {
    render(createElement(Harness, null, createElement(CashflowScreen)));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");

    fireEvent.click(clickableRows()[0]);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  /**
   * **保存で項目が落ちていないこと**（§2.8）。
   *
   * 編集できる項目を2箇所が手で並べていて、`unplanned` を一覧側だけが
   * 渡していた。そのため**この経路では「『予定にない支出』を取り消す」が
   * 押せるのに何も起きなかった。** ボタンの有無ではなく、押した結果が
   * 残ることを測る。
   */
  it("「予定にない支出」の取り消しが保存される", () => {
    render(createElement(Harness, null, createElement(CashflowScreen)));

    const target = FIXTURE_ACTUALS.find(
      (a) => a.unplanned === true && a.key === null,
    );
    /* 対象が0件なら、この `it` は何も確かめない */
    expect(target).toBeTruthy();
    const name = target!.name;

    const open = () =>
      fireEvent.click(
        screen.getAllByRole("button").filter((b) => b.textContent?.trim() === name)[0],
      );

    open();
    /* 在ること ―― 取り消し前はボタンが出ている */
    fireEvent.click(
      screen.getByRole("button", { name: "「予定にない支出」を取り消す" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    open();
    /* 無いこと ―― 取り消しが保存されたので、もう出ない */
    expect(
      screen.queryByRole("button", { name: "「予定にない支出」を取り消す" }),
    ).toBeNull();
  });

  it("押した行の実績が入っている（別の行の値で開かない）", () => {
    render(createElement(Harness, null, createElement(CashflowScreen)));

    const row = clickableRows()[0];
    const name = row.textContent?.trim();
    fireEvent.click(row);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("内容") as HTMLInputElement).value).toBe(name);
  });
});
