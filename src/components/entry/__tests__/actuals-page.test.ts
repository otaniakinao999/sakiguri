// @vitest-environment jsdom

/**
 * やることと実績一覧が別のページにあること（FR-54・AC-61）
 *
 * 条項は3つある。
 *
 *   1. 2つが別のページにあること
 *   2. 照合の候補がやること側にあること
 *   3. **実績一覧から照合の導線が消えても、未照合の実績に辿り着けること**
 *
 * **3つめが退化しやすい。** 「辿り着けないものが無い」という形なので、
 * 未照合の実績が0件のデータで測ると必ず通る（CLAUDE.md §2.11 の3つ目の
 * 形）。だから**未照合の実績を実際に作ってから数える。** さらに、
 * 既定で出る月とは別の月にも1件あることを確かめる ―― 全部が既定の月に
 * あると、月を切り替えなくても見えてしまい、**月で区切った一覧の到達性を
 * 何も測らない**（AC-28）。
 *
 * **2と3は向きが逆の条項である。** 2は「在ること」、3は「導線が無くても
 * 辿り着けること」。片方だけだと、こちらが違う要素を見ている場合と
 * 区別できない。同じ実行で両方測る。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toYearMonth } from "@/core/date";
import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { NAV_ITEMS } from "@/components/app-shell/navigation";
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
import { buildActualList } from "@/lib/actual-list";
import { formatYearMonthLabel } from "@/lib/format";
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

/** 未照合の実績 ―― 予定に紐づいておらず、「予定にない」でもない */
const UNMATCHED = ENTRY_ACTUALS.filter(
  (a) => a.key === null && a.unplanned !== true,
);

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

function draw(screenComponent: () => ReactNode) {
  render(createElement(Harness, null, createElement(screenComponent)));
}

describe("AC-61 やることと実績一覧が別のページ（FR-54）", () => {
  it("未照合の実績が在り、既定の月の外にも在る（測る対象がある）", () => {
    expect(UNMATCHED.length).toBeGreaterThan(0);

    /* 既定で出る月。`yearMonth: null` は最も新しい月 */
    const shown = buildActualList({ actuals: ENTRY_ACTUALS, yearMonth: null });
    expect(shown.months.length).toBeGreaterThan(1);
    expect(
      UNMATCHED.some((a) => toYearMonth(a.date) !== shown.yearMonth),
    ).toBe(true);
  });

  it("2つのページが画面の一覧にある", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(hrefs).toContain("/entry");
    expect(hrefs).toContain("/actuals");
    /* 同じ href が2つ並んでいないこと */
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("やることに照合の候補が在り、実績一覧には無い", () => {
    draw(EntryScreen);
    /* 在ること。候補が0件だと下の「無いこと」は何も意味しない */
    expect(
      screen.getAllByRole("button", { name: "この予定と照合" }).length,
    ).toBeGreaterThan(0);
    /* やることの画面に一覧は出ていない（別のページなので） */
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    cleanup();

    draw(ActualsScreen);
    /* 無いこと */
    expect(screen.queryByRole("button", { name: "この予定と照合" })).toBeNull();
    /* 一覧の画面にやることは出ていない */
    expect(screen.queryByRole("button", { name: "ほかの操作" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "編集" }).length).toBeGreaterThan(0);
  });

  it("やることから実績一覧へ辿れる", () => {
    draw(EntryScreen);
    const link = screen.getByRole("link", { name: "実績一覧" });
    expect(link.getAttribute("href")).toBe("/actuals");
  });

  it("未照合の実績すべてに、実績一覧から辿り着ける", () => {
    draw(ActualsScreen);

    for (const actual of UNMATCHED) {
      /* その実績の月へ切り替える。既定の月なら切り替えは要らないが、
         同じ手順で通す（月タブは全件ぶん出ている＝AC-28） */
      const tab = screen.getByRole("button", {
        name: formatYearMonthLabel(toYearMonth(actual.date)),
      });
      fireEvent.click(tab);
      expect(screen.getByText(actual.name)).toBeTruthy();
    }
  });
});
