// @vitest-environment jsdom

/**
 * 明細の予定の行から、元の設定へ飛べること（FR-57・AC-63）
 *
 * 条項は3つある。
 *
 *   1. 明細の予定の行から、その元の設定へ飛べること
 *   2. **飛んだ先で当の項目が特定できること**（一覧の先頭に戻すだけに
 *      しないこと）
 *   3. この回だけの変更と、項目そのものの変更を取り違えないこと
 *
 * **2が肝である。** リンクを作る側と、飛び先に id を付ける側が別々に
 * 文字列を組み立てると、**押しても何も起きないリンク**ができる。押した
 * 結果が出ないので画面を見ても気づけない（`unplanned` の取りこぼしと
 * 同じ形）。だから**2つの画面を描いて、片方の href が指す id が
 * もう片方に実在することを突き合わせる。**
 *
 * **3は向きが逆の条項である。** 予定の行はリンク（項目の設定）、実績の
 * 行はボタン（その実績の編集）。同じ実行で両方を測る ―― 片方だけだと、
 * 全部をリンクにする実装とも全部をボタンにする実装とも区別がつかない。
 *
 * 位置（画面に送られたか）はレイアウトなので測れない（§2.7）。測るのは
 * **`scrollIntoView` が当の要素に対して呼ばれること**で、ここが
 * 「一覧の先頭のまま」と「当の行」を分ける。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { CashflowScreen } from "@/components/cashflow/CashflowScreen";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { planAnchorId } from "@/lib/plan-anchor";
import type { AppData } from "@/lib/app-data";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

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

function draw(component: () => ReactNode) {
  return render(createElement(Harness, null, createElement(component)));
}

/** 明細の予定の行が指している飛び先（`/settings#…` の `#` から後ろ） */
function planTargets(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/settings#"]')].map(
    (a) => a.getAttribute("href")!.split("#")[1],
  );
}

beforeEach(() => {
  window.location.hash = "";
});
afterEach(cleanup);

describe("AC-63 明細の予定の行から元の設定へ飛べる（FR-57）", () => {
  it("予定の行にリンクが在り、定期項目と単発予定の両方が出ている", () => {
    const { container } = draw(CashflowScreen);
    const targets = planTargets(container);

    /* **0件なら、下の `it` は何も確かめない** */
    expect(targets.length).toBeGreaterThan(0);
    /* 片方だけだと、もう片方で id の作り方が違っていても通る */
    expect(targets.some((t) => t.startsWith("plan-recurring-"))).toBe(true);
    expect(targets.some((t) => t.startsWith("plan-oneoff-"))).toBe(true);
  });

  it("飛び先の id が、予定の設定に実在する", () => {
    const cashflow = draw(CashflowScreen);
    const targets = new Set(planTargets(cashflow.container));
    expect(targets.size).toBeGreaterThan(0);
    cleanup();

    const settings = draw(SettingsScreen);
    const ids = new Set(
      [...settings.container.querySelectorAll<HTMLElement>("[id^='plan-']")].map(
        (el) => el.id,
      ),
    );
    expect(ids.size).toBeGreaterThan(0);

    const missing = [...targets].filter((t) => !ids.has(t));
    expect(missing).toEqual([]);
  });

  it("飛び先が、当の項目を指している（別の行ではない）", () => {
    const { container } = draw(CashflowScreen);
    const known = new Set([
      ...FIXTURE_RECURRING.map((r) => planAnchorId("recurring", r.id)),
      ...FIXTURE_ONEOFFS.map((o) => planAnchorId("oneoff", o.id)),
    ]);
    for (const target of planTargets(container)) {
      expect(known.has(target)).toBe(true);
    }
  });

  it("ハッシュで指された行が画面に送られる（先頭のままにしない）", () => {
    const item = FIXTURE_RECURRING[0];
    const anchor = planAnchorId("recurring", item.id);
    window.location.hash = `#${anchor}`;

    const spy = vi.fn();
    /* jsdom は `scrollIntoView` を持たない。呼ばれた相手を見るために置く */
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: spy,
      configurable: true,
      writable: true,
    });

    draw(SettingsScreen);

    expect(spy).toHaveBeenCalledTimes(1);
    const self = spy.mock.instances[0] as HTMLElement;
    expect(self.id).toBe(anchor);
  });

  it("飛んだ先の行に色が付く（どれを指しているか分かる）", () => {
    const item = FIXTURE_RECURRING[0];
    const anchor = planAnchorId("recurring", item.id);
    window.location.hash = `#${anchor}`;

    const { container } = draw(SettingsScreen);

    const rows = [...container.querySelectorAll<HTMLElement>("[id^='plan-']")];
    /* 行が在ること。0件なら下の2つは何も確かめない */
    expect(rows.length).toBeGreaterThan(1);

    const marked = rows.filter((r) =>
      / bg-primary-subtle /.test(` ${r.getAttribute("class") ?? ""} `),
    );
    /* **当の1行だけ** ―― 全部に色を付ける実装と区別する */
    expect(marked.map((r) => r.id)).toEqual([anchor]);
  });

  it("ハッシュが無ければ何も動かさない", () => {
    const spy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: spy,
      configurable: true,
      writable: true,
    });

    const { container } = draw(SettingsScreen);

    expect(spy).not.toHaveBeenCalled();
    /* 色も付かない */
    const marked = [...container.querySelectorAll<HTMLElement>("[id^='plan-']")].filter(
      (r) => / bg-primary-subtle /.test(` ${r.getAttribute("class") ?? ""} `),
    );
    expect(marked).toEqual([]);
  });

  it("予定の行はリンク、実績の行はボタン（取り違えない）", () => {
    const { container } = draw(CashflowScreen);

    /* 実績の行 ―― その実績の編集を開く。設定へは飛ばない */
    const names = new Set(FIXTURE_ACTUALS.map((a) => a.name));
    const actualRows = screen
      .getAllByRole("button")
      .filter((b) => names.has(b.textContent?.trim() ?? ""));
    expect(actualRows.length).toBeGreaterThan(0);

    fireEvent.click(actualRows[0]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    /* 予定の行 ―― 設定へ飛ぶ。編集の画面は開かない */
    const planLinks = [...container.querySelectorAll<HTMLAnchorElement>(
      'a[href^="/settings#"]',
    )];
    expect(planLinks.length).toBeGreaterThan(0);
    /* jsdom は本当に遷移しようとして「Not implemented」を吐く。押した
       ことは変わらないので、既定の動作だけ止める */
    document.addEventListener("click", (e) => e.preventDefault(), {
      capture: true,
      once: true,
    });
    fireEvent.click(planLinks[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
