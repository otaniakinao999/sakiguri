// @vitest-environment jsdom

/**
 * AC-70 向きが**画面に出ていること**（FR-63）
 *
 * **行が向きを持っていることと、向きが画面に出ていることは別の確認で
 * ある**（CLAUDE.md §2.7 の末尾）。`transfer-direction-screens.test.ts`
 * はビューモデルを測っている。`detail={row.direction}` を1つ落としても
 * あちらは通るので、**4つの画面を描いて文字列を探す。**
 *
 * 測るのは**導線**（向きが行に届いているか）だけである。見た目・位置・
 * 折り返しは jsdom では測れないので実機で見る（§2.7）。
 *
 * ## 退化させない（§2.11）
 *
 * **同じ実行で「在る」と「無い」の両方を測る。** 向きを持つ行と持たない
 * 行が同じ画面に出ているので、片方だけだと**違う要素を見ている場合**と
 * 区別が付かない。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppDataContext,
  type AppDataStore,
} from "@/components/app-shell/AppDataProvider";
import { CashflowScreen } from "@/components/cashflow/CashflowScreen";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { ActualsScreen } from "@/components/entry/ActualsScreen";
import { EntryScreen } from "@/components/entry/EntryScreen";
import { ENTRY_ACTUALS } from "@/components/entry/entry-fixture";
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

/** 実績の2件。向きが逆の組（a1 → a0 と a0 → a1） */
const WITHDRAW_WAY = "○○銀行 普通 → 現金";
const DEPOSIT_WAY = "現金 → ○○銀行 普通";
/** 予定の1件（単発 o2） */
const PLAN_WAY = "○○銀行 普通 → △△信金 普通";

describe("AC-70 向きが画面に出ている", () => {
  it("実績一覧：逆向きの2件が、向きで見分けられる", () => {
    draw(ActualsScreen);

    /* **2件とも出ていること。** 片方だけだと、同じ向きを2回出す実装でも
       通る ―― それが 46,000円 ずれたときの見え方である */
    expect(screen.getAllByText(WITHDRAW_WAY).length).toBeGreaterThan(0);
    expect(screen.getAllByText(DEPOSIT_WAY).length).toBeGreaterThan(0);

    /* **向きを持たない行も同じ画面に出ていること。** 両側記録の2件は
       向きを持たないので、その名前は在るのに矢印は無い */
    expect(screen.getAllByText("△△信金へ移動").length).toBeGreaterThan(0);
    expect(screen.queryByText(/△△信金へ移動 →/)).toBeNull();
  });

  it("入出金予定表：実績の2件と予定の1件に向きが出る", () => {
    draw(CashflowScreen);
    expect(screen.getAllByText(WITHDRAW_WAY).length).toBeGreaterThan(0);
    expect(screen.getAllByText(DEPOSIT_WAY).length).toBeGreaterThan(0);
    expect(screen.getAllByText(PLAN_WAY).length).toBeGreaterThan(0);
  });

  it("やること：予定の行に向きが出る", () => {
    draw(EntryScreen);
    expect(screen.getAllByText(PLAN_WAY).length).toBeGreaterThan(0);
    /* 同じ画面に、向きを持たない予定も出ている */
    expect(screen.getAllByText("事務所家賃").length).toBeGreaterThan(0);
  });

  it("ダッシュボードの要対応：予定の行に向きが出る", () => {
    draw(DashboardScreen);
    expect(screen.getAllByText(PLAN_WAY).length).toBeGreaterThan(0);
  });
});
