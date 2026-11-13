// @vitest-environment jsdom

/**
 * AC-72・AC-73 が**画面に出ていること**
 *
 * **集合が正しいことと、画面に出ていることは別の確認である**
 * （CLAUDE.md §2.7 の末尾）。`lib/__tests__/unrecorded-list.test.ts` は
 * 集合を測っている。`isToday` を1つ落としても、あちらは通る。
 *
 * ここで測るのは**導線**だけである。位置・余白・折り返しは jsdom では
 * 測れないので実機で見る（§2.7）。
 *
 * ## 退化させない（§2.11）
 *
 * **「無いこと」を測る行は、同じ実行で「在ること」も測る。** 今日の組が
 * 出ていないことを測る検査は、**別の画面を見ていても通る。**
 */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import {
  DashboardView,
  type DashboardTodo,
  type DashboardViewProps,
} from "@/components/dashboard/DashboardView";
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

/** 今日の組だけに出る語。期日を過ぎた組の注記には無い */
const TODAY_NOTE = "実績が分かったら消し込んでください";
/** 期日を過ぎた組だけに出る語。今日の予定に当てると言い過ぎになる */
const OVERDUE_NOTE = "支払日をずらしてください";

describe("AC-72 今日の予定が一覧に出る", () => {
  it("ダッシュボード：今日の組と、期日を過ぎた組が両方出る", () => {
    render(createElement(Harness, null, createElement(DashboardScreen)));

    /* 今日の予定（フィクスチャの o3。10/18） */
    expect(screen.getAllByText("今日の予定").length).toBeGreaterThan(0);
    expect(screen.getAllByText("電気代").length).toBeGreaterThan(0);

    /* **同じ画面に、期日を過ぎた組も出ていること。** 片方だけだと
       「全部を今日に入れる実装」と区別が付かない */
    expect(screen.getAllByText("期日を過ぎた予定").length).toBeGreaterThan(0);
    expect(screen.getAllByText("事務所家賃").length).toBeGreaterThan(0);

    /* 注記も2つとも出ている */
    const text = document.body.textContent ?? "";
    expect(text).toContain(TODAY_NOTE);
    expect(text).toContain(OVERDUE_NOTE);
  });

  it("今日の組の中に、期日を過ぎた組の注記が入らない", () => {
    render(createElement(Harness, null, createElement(DashboardScreen)));

    /* 見出しから組をたどる。見出しは `<span>`、その親が見出しの行、
       さらにその親が組の `<div>`（DashboardView の `TODO_SECTIONS`） */
    const section = screen.getByText("今日の予定").parentElement?.parentElement;
    expect(section).toBeTruthy();
    const inside = section?.textContent ?? "";

    /* **在ることを先に見る。** 空の要素を見ていたら下は必ず通る */
    expect(inside).toContain("電気代");
    expect(inside).toContain(TODAY_NOTE);

    expect(inside).not.toContain(OVERDUE_NOTE);
    expect(inside).not.toContain("事務所家賃");
  });
});

/** 今日の組が空のときは、その見出しも注記も出ない */
describe("AC-72 組が空なら出さない", () => {
  const base: DashboardViewProps = {
    today: FIXTURE_TODAY,
    balance: 1_000_000,
    unrecorded: -50_000,
    chart: { points: [], todayT: 0, defenseLine: 0, markers: [] },
    lowPoint: null,
    todos: [],
    todoCount: 0,
    accounts: [{ label: "○○銀行 普通", value: 1_000_000 }],
    cards: [],
    total: { label: "現預金 合計", value: 1_000_000 },
  };

  const row = (id: string, isToday: boolean): DashboardTodo => ({
    id,
    date: isToday ? "10/18" : "10/5",
    title: isToday ? "電気代" : "外注費",
    amount: 31_500,
    display: { value: -31_500, signed: true, type: "expense" },
    isToday,
    category: "変動費",
  });

  it("期日を過ぎた行だけなら、今日の見出しと注記が出ない", () => {
    const todos = [row("a", false)];
    render(
      createElement(DashboardView, { ...base, todos, todoCount: todos.length }),
    );

    const text = document.body.textContent ?? "";
    /* **在ること。** 期日を過ぎた組は出ている */
    expect(text).toContain("期日を過ぎた予定");
    expect(text).toContain(OVERDUE_NOTE);
    expect(text).toContain("外注費");

    /* 無いこと */
    expect(text).not.toContain("今日の予定");
    expect(text).not.toContain(TODAY_NOTE);
  });

  it("今日の行だけなら、期日を過ぎた見出しと注記が出ない", () => {
    const todos = [row("b", true)];
    render(
      createElement(DashboardView, { ...base, todos, todoCount: todos.length }),
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain("今日の予定");
    expect(text).toContain(TODAY_NOTE);
    expect(text).toContain("電気代");

    expect(text).not.toContain("期日を過ぎた予定");
    expect(text).not.toContain(OVERDUE_NOTE);
  });

  it("`isToday` を渡さない行は、期日を過ぎた扱いになる", () => {
    /* 既定で従来の見え方になること（/dev/screens/dashboard の固定値） */
    const todos: DashboardTodo[] = [
      {
        id: "c",
        date: "10/5",
        title: "外注費",
        amount: 140_000,
        display: { value: -140_000, signed: true, type: "expense" },
        category: "変動費",
      },
    ];
    render(
      createElement(DashboardView, { ...base, todos, todoCount: todos.length }),
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain("期日を過ぎた予定");
    expect(text).not.toContain("今日の予定");
  });
});

describe("AC-73 どの残高に含まれているかを正しく言う", () => {
  it("口座の数に依存する言い方をしない", () => {
    render(createElement(Harness, null, createElement(DashboardScreen)));
    const text = document.body.textContent ?? "";

    /* **在ること。** 正しい言い方が出ている */
    expect(text).toContain(
      "その予定に設定した口座の残高と、現預金 合計に含まれています。",
    );
    /* **無いこと。** 口座が2つのときだけ成り立つ言い方 */
    expect(text).not.toContain("どちらにも");
    expect(text).not.toContain("上の残高");
  });

  it("合計の行を出していないときは、その語を使わない", () => {
    const props: DashboardViewProps = {
      today: FIXTURE_TODAY,
      balance: 1_000_000,
      unrecorded: -50_000,
      chart: { points: [], todayT: 0, defenseLine: 0, markers: [] },
      lowPoint: null,
      todos: [],
      todoCount: 0,
      accounts: [{ label: "○○銀行 普通", value: 1_000_000 }],
      cards: [],
      total: null,
    };
    render(createElement(DashboardView, props));
    const text = document.body.textContent ?? "";

    expect(text).toContain("その予定に設定した口座の残高に含まれています。");
    /* 出していない行の名前を言わない */
    expect(text).not.toContain("現預金 合計");
  });
});
