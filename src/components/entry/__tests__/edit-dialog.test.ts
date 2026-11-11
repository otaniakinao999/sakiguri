// @vitest-environment jsdom

/**
 * 編集と「この回だけ」の操作が、同じ出し方を通ること（FR-55・AC-60）
 * ［実際の金額］に打った額が繰延に引き継がれること（FR-07・AC-59）
 *
 * **画面を描いて測る。** 「どこに開くか」は props や定数を読んでも
 * 分からない。以前は3経路に3つの出し方があり、繰延はページの末尾、
 * 明細の編集は表の上端に開いていた。**開いてはいたので、「開く」ことだけ
 * を測ると全部通る**（CLAUDE.md §2.11）。測るのは
 *
 *   - 覆い（`role="dialog"` / `aria-modal`）が出ること
 *   - 開いているあいだ背後がスクロールしないこと
 *   - Esc で閉じ、背後のスクロールが戻ること
 *
 * の3つで、どれも `Modal` を通らないと成り立たない。
 *
 * **「無いこと」だけを測らない。** 押す前に覆いが無いことを先に見てから、
 * 押して出ることを見る。片方だけだと、常に出ている実装や、こちらが
 * 違う要素を見ている場合と区別できない。
 *
 * jsdom を使うのは、ここが**どの経路でも同じ画面を通るという構造的な
 * 不変条件**だからである（CLAUDE.md §2.7）。位置や重なりは測れない
 * （レイアウトエンジンが無い）。画面のどこに出るかは実機で見る。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { ActualsScreen } from "@/components/entry/ActualsScreen";
import { EntryScreen } from "@/components/entry/EntryScreen";
import {
  ENTRY_ACTUALS,
  FIXTURE_ACCOUNTS,
  FIXTURE_TODAY,
} from "@/components/entry/entry-fixture";
import {
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_RESERVE_LINE,
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
  actuals: ENTRY_ACTUALS,
  overrides: {},
  rules: [],
};

/**
 * 本番と同じ経路で描く。
 *
 * `AppDataContext` をそのまま使う（`/dev/screens/*` と同じ口）。
 * `useAppData` を差し替えてしまうと、画面がどの値を読んでいるかを
 * 測らないことになる。
 */
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
 * 画面を描く。
 *
 * **2つある。** FR-54 でやること（`EntryScreen`）と実績一覧
 * （`ActualsScreen`）を別のページに分けた。編集の入口は一覧側である。
 */
function draw(screenComponent: () => ReactNode = EntryScreen) {
  render(createElement(Harness, null, createElement(screenComponent)));
}

/** 最初の予定の行で［ほかの操作］を開く */
function openOtherActions() {
  const buttons = screen.getAllByRole("button", { name: "ほかの操作" });
  /* **退化の見張り。** 予定の行が0件だと下の `it` が一度も確かめない */
  expect(buttons.length).toBeGreaterThan(0);
  fireEvent.click(buttons[0]);
}

describe("AC-60 編集の画面の出し方が1本に揃っている（FR-55）", () => {
  it("やることに予定の行が在り、一覧に実績の行が在る（測る対象がある）", () => {
    draw(EntryScreen);
    expect(
      screen.getAllByRole("button", { name: "ほかの操作" }).length,
    ).toBeGreaterThan(0);
    cleanup();

    draw(ActualsScreen);
    expect(screen.getAllByRole("button", { name: "編集" }).length).toBeGreaterThan(0);
  });

  for (const route of [
    {
      label: "払えなかった（繰延）",
      screen: EntryScreen,
      open: () => {
        openOtherActions();
        fireEvent.click(screen.getByRole("button", { name: "払えなかった" }));
      },
    },
    {
      label: "実績を手入力",
      screen: EntryScreen,
      open: () => {
        fireEvent.click(
          screen.getByRole("button", { name: "手入力する（例外のときだけ）" }),
        );
      },
    },
    {
      label: "実績を編集（実績一覧）",
      screen: ActualsScreen,
      open: () => {
        fireEvent.click(screen.getAllByRole("button", { name: "編集" })[0]);
      },
    },
  ]) {
    it(`${route.label} は覆いの中に開き、Esc で閉じる`, () => {
      draw(route.screen);

      /* 在ること／無いことの両方を測る。まず無いこと */
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.body.style.overflow).not.toBe("hidden");

      route.open();

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      /* 題が付いている（どの操作の画面か分かる） */
      expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
      /* 開いているあいだ背後はスクロールしない */
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.body.style.overflow).not.toBe("hidden");
    });
  }
});

describe("AC-59 ［実際の金額］に打った額を繰延に引き継ぐ（FR-07）", () => {
  it("打った額が繰延の金額欄に出る", () => {
    draw();
    openOtherActions();

    const typed = screen.getByLabelText("実際の金額") as HTMLInputElement;
    /* 予定の額と違う額を打つ。同じだと引き継いだかどうかが読めない */
    const planAmount = Number(typed.value.replace(/[^0-9-]/g, ""));
    expect(planAmount).toBeGreaterThan(0);
    const partial = planAmount - 1_000;
    fireEvent.change(typed, { target: { value: String(partial) } });

    fireEvent.click(screen.getByRole("button", { name: "払えなかった" }));

    const amount = screen.getByLabelText("金額を変更") as HTMLInputElement;
    expect(amount.value).toBe(String(partial));
    expect(amount.value).not.toBe(String(planAmount));
  });

  it("打っていなければ予定の額が出る", () => {
    draw();
    openOtherActions();

    const typed = screen.getByLabelText("実際の金額") as HTMLInputElement;
    const planAmount = Number(typed.value.replace(/[^0-9-]/g, ""));
    expect(planAmount).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "払えなかった" }));

    const amount = screen.getByLabelText("金額を変更") as HTMLInputElement;
    expect(amount.value).toBe(String(planAmount));
  });
});
