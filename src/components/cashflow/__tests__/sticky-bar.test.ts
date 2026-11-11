// @vitest-environment jsdom

/**
 * 追従する領域に「見ている口座」と「月の切り替え」が入ること（FR-56・AC-62）
 *
 * **レイアウトは測れない**（jsdom にレイアウトエンジンが無い。
 * CLAUDE.md §2.7）。だから「重なっていないこと」をピクセルで確かめること
 * はできない。代わりに**重なりの原因になる構造**を固定する ――
 * 上辺に追従する要素が1つしか無いこと。2つ置いた時点で、下の要素の
 * `top` に上の要素の高さを定数で書くしかなくなり、折り返す幅でずれる。
 * 実際の欠陥は、月の見出し（z-30）が残高ヘッダー（z-10）を覆っていた形
 * である。
 *
 * **クラス名を読んでいる。** Tailwind のクラスが追従そのものの仕組みな
 * ので、ここは実装を読んでいることになる。**位置と重なりは実機で見る。**
 */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { BalanceHeader } from "@/components/app-shell/BalanceHeader";
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
 * クラス名を1語ずつ引ける形に直す。
 *
 * **改行を潰してから見る。** テンプレートリテラルで複数行に書かれた
 * `className` をそのまま空白区切りで見ると、改行の隣の語を取り落とす。
 * 取り落とすと「無いこと」の検査が**見張る先を失ったまま通る。**
 */
function classes(el: Element): string {
  return ` ${el.className.replace(/\s+/g, " ").trim()} `;
}

/** 上辺に追従している要素。`sticky` かつ `top-0` を持つもの */
function stickyTop(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("*")].filter((el) => {
    const cls = classes(el);
    return / sticky /.test(cls) && / top-0 /.test(cls);
  });
}

describe("AC-62 追従する領域（FR-56）", () => {
  it("上辺に追従する要素は1つだけ（重なる余地が無い）", () => {
    const { container } = render(
      createElement(Harness, null, createElement(CashflowScreen)),
    );
    expect(stickyTop(container).length).toBe(1);
  });

  it("そのバーに「見ている口座」と「月の切り替え」が両方入っている", () => {
    const { container } = render(
      createElement(Harness, null, createElement(CashflowScreen)),
    );
    const bar = stickyTop(container)[0];
    expect(bar).toBeTruthy();

    /* 在ること ―― どちらも画面に出ている。月の見出しは2ヶ月以上
       ないと描かれないので、出ていることを先に確かめる */
    const account = screen.getByLabelText("見る口座");
    const months = screen.getByRole("navigation", { name: "月へ移動" });
    expect(months.querySelectorAll("a").length).toBeGreaterThan(1);

    expect(bar.contains(account)).toBe(true);
    expect(bar.contains(months)).toBe(true);
  });

  it("月の見出しは自分で追従しない（ヘッダーを覆わない）", () => {
    render(createElement(Harness, null, createElement(CashflowScreen)));
    const months = screen.getByRole("navigation", { name: "月へ移動" });
    expect(classes(months)).not.toMatch(/ sticky /);
  });

  it("残高ヘッダーは追従しない（狭い幅でバーと同じ上辺に来るため）", () => {
    const { container } = render(
      createElement(Harness, null, createElement(BalanceHeader)),
    );
    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    expect(classes(header!)).not.toMatch(/ sticky /);
    expect(stickyTop(container).length).toBe(0);
  });
});
