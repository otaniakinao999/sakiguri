// @vitest-environment jsdom

/**
 * AC-69 件数が**画面に**出ること（FR-62）
 *
 * **数が正しいことと、画面に出ていることは別の確認である**（§2.7）。
 * `applyNameSource` が2つ返していても、画面が片方しか出さなければ
 * 利用者は毎月その件数ぶん無駄に探す。
 *
 * **この画面は本番だけにある。** 取込の確認は Supabase に繋がないと
 * 開けないので、`/dev/screens/import-wired` には知らせの行が無い。
 * **ここが唯一の自動の確認である。**
 *
 * ## 退化させない（§2.11）
 *
 * データに3つの形を入れる ―― 置き換わる行・明細に店名が無い行・相手が
 * いない行。**後ろの2つは行だけを見ると区別が付かない**ので、文が両者を
 * 分けていることを測る。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { ImportScreen } from "@/components/import/ImportScreen";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ASOF,
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
  recurring: [],
  oneoffs: [],
  actuals: [],
  overrides: {},
  rules: [],
};

/** 銀行明細。摘要は取引ごとの番号 */
const BANK = [
  "日付,摘要,出金,入金",
  "2026/10/20,デビット　４１２６６９,3212,",
  "2026/10/21,デビット　５１１１１１,1200,",
  /* 相手がいない */
  "2026/10/23,デビット　７３３３３３,9999,",
  /* 相手の店名が空 */
  "2026/10/24,デビット　８４４４４４,7000,",
].join("\n");

/** デビット明細。1件だけ店名が空 */
const DEBIT = [
  "利用日,利用店名,利用金額,海外事務手数料",
  "2026/10/20,FIGMA,3134,78",
  "2026/10/21,SEVEN,1200,0",
  "2026/10/24,,7000,0",
].join("\n");

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

/** 摘要の出どころを選ぶ。隠した `<input type="file">` の2つめ */
async function pickNameSource(container: HTMLElement, csv: string) {
  const inputs = container.querySelectorAll('input[type="file"]');
  expect(inputs).toHaveLength(2);
  const file = new File([csv], "デビット明細.csv", { type: "text/csv" });
  fireEvent.change(inputs[1], { target: { files: [file] } });
  /* 読み取りは非同期（`file.arrayBuffer()`） */
  await waitFor(() =>
    expect(document.body.textContent).toContain("摘要の出どころを"),
  );
}

function read(csv: string) {
  fireEvent.click(screen.getByRole("button", { name: "中身を貼りつける" }));
  fireEvent.change(screen.getByLabelText("CSVの中身"), { target: { value: csv } });
  fireEvent.click(screen.getByRole("button", { name: "読み取る" }));
}

describe("AC-69 件数を2つ出す", () => {
  it("置き換えた件数と、明細に店名が無かった件数が両方出る", async () => {
    const { container } = render(
      createElement(Harness, null, createElement(ImportScreen)),
    );

    await pickNameSource(container, DEBIT);
    read(BANK);

    const text = (document.body.textContent ?? "").replace(/\s+/g, "");

    /* 置き換わったのは FIGMA と SEVEN の2行。店名が空の相手に当たったのが
       1行、相手がいないのが1行 */
    expect(text).toContain("2件の摘要を店名に置き換えました");
    expect(text).toContain("1件は明細に店名が無いので番号のままです");

    /* **在ること。** 置き換えが画面の表にも出ている */
    expect(screen.getAllByText("FIGMA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SEVEN").length).toBeGreaterThan(0);

    /* **相手がいない行は番号のまま。** 店名が無い行と見た目は同じで、
       区別は上の文にしかない */
    /* 全角の空白は読み上げ用に詰められるので、番号で探す */
    expect(screen.getAllByText(/７３３３３３/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/８４４４４４/).length).toBeGreaterThan(0);
  });

  it("店名が無かった行が0件なら、その文は出ない", async () => {
    const { container } = render(
      createElement(Harness, null, createElement(ImportScreen)),
    );

    /* 店名が空の相手を外した明細 */
    await pickNameSource(
      container,
      ["利用日,利用店名,利用金額", "2026/10/21,SEVEN,1200"].join("\n"),
    );
    read(BANK);

    const text = (document.body.textContent ?? "").replace(/\s+/g, "");
    expect(text).toContain("1件の摘要を店名に置き換えました");
    expect(text).not.toContain("明細に店名が無いので");
  });
});
