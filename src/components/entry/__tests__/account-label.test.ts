// @vitest-environment jsdom

/**
 * 口座欄のラベルが**画面に出ている**こと（FR-52・AC-58e）
 *
 * **定数だけを見ても足りない。** `ACCOUNT_LABEL` が正しくても、画面が
 * それを使わず直書きしたら通る。描いて、出ている文字を読む。
 *
 * **「無いこと」だけを測らない**（CLAUDE.md §2.11）。3つの収支それぞれで
 * 「在ること」を測り、同じ実行で他の2つが出ていないことも測る。片方だけ
 * だと、3つとも同時に出す実装と区別がつかない。
 *
 * jsdom を使うのは、ここが**ラベルと収支の対応という構造的な不変条件**
 * だからである（§2.7）。レイアウトは見ていない。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ACCOUNT_LABEL, ActualForm } from "@/components/entry/ActualForm";
import type { Account, Actual, EntryType } from "@/core/types";

afterEach(cleanup);

const accounts: Account[] = [
  { id: "bank", name: "事業口座", kind: "bank", balance: 0 },
  { id: "cash", name: "現金", kind: "cash", balance: 0 },
];

function formFor(type: EntryType): Actual {
  return {
    id: "x",
    key: null,
    date: "2026-11-11",
    name: "ファクタリング入金",
    type,
    costType: null,
    categoryCode: type === "expense" ? "EXP-01" : "TRF-08",
    amount: 500_000,
    bizRatio: 0,
    accountId: "bank",
    toAccountId: type === "transfer" ? "cash" : undefined,
  };
}

function draw(type: EntryType) {
  render(
    createElement(ActualForm, {
      value: formFor(type),
      accounts,
      mode: "edit",
      onChange: () => {},
      onSubmit: () => {},
      onCancel: () => {},
    }),
  );
}

const ALL = Object.values(ACCOUNT_LABEL);

describe("口座欄のラベル（AC-58e）", () => {
  for (const type of ["expense", "income", "transfer"] as const) {
    it(`${type} は「${ACCOUNT_LABEL[type]}」が画面に出る`, () => {
      draw(type);
      /* 在ること */
      expect(screen.getByText(ACCOUNT_LABEL[type])).toBeTruthy();
      /* 同じ実行で、他の2つが出ていないこと */
      for (const other of ALL.filter((l) => l !== ACCOUNT_LABEL[type])) {
        expect(screen.queryByText(other)).toBeNull();
      }
      /* 直書きが残っていないこと */
      expect(screen.queryByText("支払方法")).toBeNull();
    });
  }

  it("振替は「振替元」と「振替先」が対で出る", () => {
    draw("transfer");
    expect(screen.getByText("振替元")).toBeTruthy();
    expect(screen.getByText("振替先")).toBeTruthy();
  });

  it("収入では振替先の欄が出ない", () => {
    draw("income");
    expect(screen.getByText("入金先")).toBeTruthy();
    expect(screen.queryByText("振替先")).toBeNull();
  });
});
