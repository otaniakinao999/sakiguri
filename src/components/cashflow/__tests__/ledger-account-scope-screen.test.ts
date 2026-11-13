// @vitest-environment jsdom

/**
 * AC-74 入出金予定表が口座で絞られ、資金移動が両端に出ること（FR-65）
 *
 * **ビューモデルが絞っていることと、画面が絞って出していることは別の
 * 確認である**（CLAUDE.md §2.7 の末尾）。実際、FR-64 では `accountDaily`
 * が props に在って型も通っていたのに**画面へ渡す1行が抜けていた。**
 *
 * ## 退化させない（§2.11）
 *
 * **同じ実行で、合計のときと口座を選んだときの両方を測る。** 片方だけ
 * だと、常に全部出す実装とも区別が付かない。
 *
 * **移動先の側を測る。** 移動元だけに出す実装は、移動元の側だけ見ている
 * かぎり正しく見える。
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

function draw() {
  return render(createElement(Harness, null, createElement(CashflowScreen)));
}

/** 「入出金予定表」のパネル。ほかのパネルの文字を拾わないため */
function ledgerPanel(container: HTMLElement): HTMLElement {
  const heading = [...container.querySelectorAll("h1,h2,h3")].find((h) =>
    h.textContent?.includes("入出金予定表"),
  );
  expect(heading).toBeTruthy();
  return heading!.closest("section") ?? (heading!.parentElement as HTMLElement);
}

function choose(value: string) {
  fireEvent.change(screen.getByLabelText("見る口座"), { target: { value } });
}

describe("AC-74 口座で明細を絞る", () => {
  it("合計のときは全部出て、現金を選ぶと銀行だけの行が消える", () => {
    const { container } = draw();
    /* **在ること。** 合計では両方出ている */
    const all = ledgerPanel(container).textContent ?? "";
    expect(all).toContain("ＡＴＭ　セブン銀行");
    expect(all).toContain("事務所家賃");

    choose("a0");
    const cash = ledgerPanel(container).textContent ?? "";

    /* 現金を動かす行は残る */
    expect(cash).toContain("ＡＴＭ　セブン銀行");
    /* 銀行だけの行は消える */
    expect(cash).not.toContain("事務所家賃");
  });
});

describe("AC-74 資金移動は両端に出る", () => {
  it("移動先の口座にも行が出て、符号が逆になる", () => {
    const { container } = draw();
    /* 移動元（○○銀行 a1）：ＡＴＭ　セブン銀行は −¥50,000 */
    choose("a1");
    const bank = ledgerPanel(container).textContent ?? "";
    expect(bank).toContain("ＡＴＭ　セブン銀行");
    expect(bank).toContain("−¥50,000");

    /* 移動先（現金 a0）：**同じ行が出て、符号が逆** */
    choose("a0");
    const cash = ledgerPanel(container).textContent ?? "";
    expect(cash).toContain("ＡＴＭ　セブン銀行");
    expect(cash).toContain("+¥50,000");
  });

  it("予定の資金移動も、移動先に出る", () => {
    const { container } = draw();
    /* △△信金（a2）は、この予定（10/15・200,000）でしか動かない。
       **落とすと残高だけが上がって理由の行が無い画面になる**（AC-71） */
    choose("a2");
    const to = ledgerPanel(container).textContent ?? "";
    expect(to).toContain("△△信金へ資金移動");
    expect(to).toContain("+¥200,000");
  });

  it("絞ったときに「合計残高は増減なし」と書かない", () => {
    const { container } = draw();

    /* **在ること。** 合計の範囲では、閉じる振替は残高を動かさない */
    expect(ledgerPanel(container).textContent).toContain("合計残高は増減なし");

    /* **無いこと。** 口座を絞ると、その行は残高を +¥50,000 動かす。
       「振替だから増減なし」と書くと、**金額の列と残高の列に矛盾する
       文が並ぶ**（2026-11-13 に実機で見つけた） */
    choose("a0");
    const cash = ledgerPanel(container).textContent ?? "";
    expect(cash).toContain("ＡＴＭ　セブン銀行");
    expect(cash).not.toContain("合計残高は増減なし");
  });

  it("合計のときは、閉じる振替に符号が付かない（AC-58b）", () => {
    const { container } = draw();
    const all = ledgerPanel(container).textContent ?? "";
    expect(all).toContain("ＡＴＭ　セブン銀行");
    /* **同じ実行で、絞ったときに符号が付くことは上の検査が見ている。**
       ここでは合計の範囲で付かないことを見る */
    expect(all).not.toContain("+¥50,000");
    expect(all).not.toContain("−¥50,000");
  });
});
