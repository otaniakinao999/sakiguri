// @vitest-environment jsdom

/**
 * CL-7 確認画面で固定変動・事業割合を**画面から**直せること
 *
 * **「直せること」と「直した値が取り込まれること」は別の確認である**
 * （CLAUDE.md §2.7）。core の検査（`core/__tests__/import-row-edit.test.ts`）
 * は編集の関数を測っている。**画面が呼んでいなければ通る。**
 *
 * ここでは本番の画面を描いて、
 *
 *   1. 欄が在ること（費用の行）と、無いこと（収入の行）
 *   2. 直した値が画面に残ること
 *   3. **登録したあとの実績にその値が入っていること**
 *
 * を同じ実行で測る。3が本体で、1・2だけだと「画面では直せるが保存は
 * されない」実装と区別が付かない。
 *
 * 位置・幅・折り返しは jsdom では測れないので実機で見る（§2.7）。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/**
 * **予定も実績も空にしてある。** 自動照合が成立すると費目・固定変動・
 * 事業割合が予定から来るので（AC-45）、「手で直したか」を測る邪魔になる。
 * 引き継ぎの規則はこの依頼では触っていない。
 */
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

/** 出金（固定変動を持つ）と入金（持たない）を1行ずつ */
const CSV = [
  "日付,摘要,入金,出金",
  "2026/10/01,ﾃﾞﾝｷﾀﾞｲ,,5000",
  "2026/10/02,ｳﾘｱｹﾞ ﾆｭｳｷﾝ,30000,",
].join("\n");

let saved: AppData = INITIAL;

function Harness({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(INITIAL);
  saved = data;
  const store: AppDataStore = {
    data,
    setData: (update) =>
      setData((previous) => {
        const next = update(previous);
        saved = next;
        return next;
      }),
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

/** 貼り付けて読み取り、確認画面まで進める */
function openPreview() {
  saved = INITIAL;
  render(createElement(Harness, null, createElement(ImportScreen)));
  fireEvent.click(screen.getByRole("button", { name: "中身を貼りつける" }));
  fireEvent.change(screen.getByLabelText("CSVの中身"), {
    target: { value: CSV },
  });
  fireEvent.click(screen.getByRole("button", { name: "読み取る" }));
}

describe("CL-7 確認画面で固定変動を直せる", () => {
  it("費用の行には欄が在り、収入の行には無い", () => {
    openPreview();

    /* **在ること** */
    const select = screen.getByLabelText("ﾃﾞﾝｷﾀﾞｲ の固定変動");
    expect(select).toBeTruthy();

    /* **無いこと。** 収入には固定／変動が無い（適用規則6）。
       同じ画面に両方の行が出ているので、「どの行にも出さない実装」とは
       区別が付く */
    expect(screen.queryByLabelText("ｳﾘｱｹﾞ ﾆｭｳｷﾝ の固定変動")).toBeNull();
    expect(screen.getAllByText("ｳﾘｱｹﾞ ﾆｭｳｷﾝ").length).toBeGreaterThan(0);
  });

  it("直した値が登録される", () => {
    openPreview();

    const select = screen.getByLabelText("ﾃﾞﾝｷﾀﾞｲ の固定変動") as HTMLSelectElement;
    /* **既定と違う値に変える。** 既定と同じ値にすると、編集を捨てる
       実装でも通る（§2.11 の4つ目の形） */
    const before = select.value;
    const after = before === "fixed" ? "variable" : "fixed";
    fireEvent.change(select, { target: { value: after } });
    expect(select.value).toBe(after);

    fireEvent.click(screen.getByRole("button", { name: "2件を登録する" }));

    const actual = saved.actuals.find((a) => a.sourceName === "ﾃﾞﾝｷﾀﾞｲ");
    expect(actual).toBeTruthy();
    expect(actual?.costType).toBe(after);
  });
});

describe("CL-7 確認画面で事業割合を直せる", () => {
  it("費用の行には欄が在り、資金移動の行には無い", () => {
    openPreview();

    /* **在ること** */
    expect(screen.getByLabelText("ﾃﾞﾝｷﾀﾞｲ の事業割合")).toBeTruthy();

    /* 費目を資金移動に変えると欄が消える（適用規則6）。**在ることを
       先に見てから無くなることを見る** */
    fireEvent.change(screen.getByLabelText("ﾃﾞﾝｷﾀﾞｲ の費目"), {
      target: { value: "TRF-01" },
    });
    expect(screen.queryByLabelText("ﾃﾞﾝｷﾀﾞｲ の事業割合")).toBeNull();
    expect(screen.queryByLabelText("ﾃﾞﾝｷﾀﾞｲ の固定変動")).toBeNull();
  });

  it("直した値が登録される", () => {
    openPreview();

    const input = screen.getByLabelText("ﾃﾞﾝｷﾀﾞｲ の事業割合") as HTMLInputElement;
    const before = Number(input.value);
    fireEvent.change(input, { target: { value: "40" } });
    expect(input.value).toBe("40");
    expect(before).not.toBe(40);

    fireEvent.click(screen.getByRole("button", { name: "2件を登録する" }));

    const actual = saved.actuals.find((a) => a.sourceName === "ﾃﾞﾝｷﾀﾞｲ");
    expect(actual?.bizRatio).toBe(40);

    /* **直していない行は動いていない。** 全行に同じ値を書く実装と
       区別する */
    const other = saved.actuals.find((a) => a.sourceName === "ｳﾘｱｹﾞ ﾆｭｳｷﾝ");
    expect(other?.bizRatio).not.toBe(40);
  });
});
