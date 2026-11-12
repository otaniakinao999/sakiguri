// @vitest-environment jsdom

/**
 * AC-71 口座を選ぶと、日ごとの増減と残高が**画面に**出ること（FR-64）
 *
 * **ビューモデルが作っていることと、画面に出ていることは別の確認である**
 * （CLAUDE.md §2.7 の末尾）。実際、`accountDaily` は props に在って型も
 * 通っていたのに、**画面へ渡す1行を書き忘れていた** ―― 省略できる props
 * なので `tsc` も落ちず、ビューモデルの検査も通っていた。
 *
 * ## 退化させない（§2.11）
 *
 * **同じ実行で「合計のとき」と「口座を選んだとき」の両方を測る。**
 * 片方だけだと、常に出す実装とも常に出さない実装とも区別が付かない。
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
  CashflowView,
  type CashflowDaily,
  type CashflowViewProps,
} from "@/components/cashflow/CashflowView";
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

function draw() {
  return render(createElement(Harness, null, createElement(CashflowScreen)));
}

/** 「口座の日ごとの増減と残高」のパネル */
function dailyPanel(container: HTMLElement): HTMLElement {
  const heading = [...container.querySelectorAll("h1,h2,h3")].find((h) =>
    h.textContent?.includes("口座の日ごとの増減と残高"),
  );
  expect(heading).toBeTruthy();
  return heading!.closest("section") ?? (heading!.parentElement as HTMLElement);
}

/** 口座を選ぶ */
function choose(value: string) {
  fireEvent.change(screen.getByLabelText("見る口座"), { target: { value } });
}

describe("AC-71 日ごとの増減と残高が画面に出る（FR-64）", () => {
  it("合計を見ているときは出さない（口座を選ぶよう案内する）", () => {
    const { container } = draw();
    const panel = dailyPanel(container);
    expect(panel.textContent).toContain("口座を選ぶと");
    /* 表は無い */
    expect(panel.querySelector("table")).toBeNull();
  });

  it("口座を選ぶと、その口座の日ごとの行が出る", () => {
    const { container } = draw();
    choose("a0");

    const panel = dailyPanel(container);
    const text = panel.textContent ?? "";

    /* 現金を動かす2件（10/14 引出し +50,000・10/23 預け入れ −23,000）。
       **入る日と出る日の両方。** 片方だけだと向きを取り違えた実装でも
       合計が合うことがある */
    expect(text).toContain("10/14");
    expect(text).toContain("10/23");
    expect(text).toContain("+¥50,000");
    expect(text).toContain("−¥23,000");

    /* 残高（52,000 → 102,000 → 79,000） */
    expect(text).toContain("¥102,000");
    expect(text).toContain("¥79,000");

    /* **期首と合計の行が表の中に在る。** 下の留め具の文にも同じ数字が
       出るので、表だけを見ないと「表に無くても通る」 */
    const table = dailyPanel(container).querySelector("table")!;
    expect(table.textContent).toContain("期首残高");
    expect(table.textContent).toContain("合計");
    expect(table.textContent).toContain("¥52,000");
  });

  it("**期首 ＋ 増減の合計 ＝ 期末**が画面に出る（AC-71 の留め具）", () => {
    const { container } = draw();
    choose("a0");
    const text = dailyPanel(container).textContent ?? "";

    expect(text).toContain("期首残高 ¥52,000 ＋ 増減の合計 +¥27,000 ＝ 期末残高 ¥79,000");
    /* **合うときに黙らない。** 出ないものだけを見ると、こちらが違う場所を
       見ている場合と区別が付かない（§2.11） */
    expect(text).not.toContain("ずれています");
  });

  it("口座を変えると中身が変わる（ほかの口座の行が出ない）", () => {
    const { container } = draw();
    choose("a2");
    const text = dailyPanel(container).textContent ?? "";

    /* △△信金は 10/9 の両側記録の入金（+77,777）だけが動かす */
    expect(text).toContain("10/9");
    expect(text).toContain("+¥77,777");
    /* **現金の行は出ない。** 選んだ口座に関わらず同じものを出す実装を落とす */
    expect(text).not.toContain("+¥50,000");
    expect(text).not.toContain("−¥23,000");
  });

  it("合計に戻すと、また案内に戻る", () => {
    const { container } = draw();
    choose("a0");
    expect(dailyPanel(container).querySelector("table")).toBeTruthy();
    choose("all");
    expect(dailyPanel(container).querySelector("table")).toBeNull();
  });
});

/* ================= 合わなかったときに黙らない ================= */

/**
 * **`gap !== 0` の分岐は、正しい実装では一度も描かれない。**
 *
 * 描かれない道は、壊れていても誰も気づけない（CLAUDE.md §2.11）。
 * 画面に直接渡して、**出ることと出ないことを同じ実行で**測る。
 */
describe("AC-71 増減の合計が残高の動きと合わないとき", () => {
  const daily = (gap: number): CashflowDaily => ({
    accountName: "現金",
    opening: 52_000,
    closing: 79_000,
    total: 27_000 + gap,
    gap,
    rows: [{ date: "10/14", delta: 27_000 + gap, balance: 79_000, note: "1件" }],
  });

  const tabs = { defaultValue: "all", options: [{ value: "all", label: "すべて" }] };

  const props = (gap: number): CashflowViewProps => ({
    stats: [],
    chart: { points: [], todayT: 0, defenseLine: null },
    trend: {
      defaultValue: "daily",
      options: [{ value: "daily", label: "日次" }],
    },
    monthlyChart: [],
    months: [],
    monthsNote: "",
    accountDaily: daily(gap),
    ledger: [],
    period: tabs,
    categoryFilter: tabs,
    kindFilter: tabs,
  });

  it("ずれていれば、その額を出す", () => {
    const { container } = render(createElement(CashflowView, props(7)));
    const text = dailyPanel(container).textContent ?? "";
    expect(text).toContain("¥7");
    expect(text).toContain("ずれています");
    /* 合っているときの文は出ない（両方出すと、どちらを読むか分からない） */
    expect(text).not.toContain("＝ 期末残高");
  });

  it("合っていれば、その文は出ない（同じ実行で対にして測る）", () => {
    const { container } = render(createElement(CashflowView, props(0)));
    const text = dailyPanel(container).textContent ?? "";
    expect(text).not.toContain("ずれています");
    expect(text).toContain("＝ 期末残高");
  });
});
