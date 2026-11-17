// @vitest-environment jsdom

/**
 * AC-84 いまどの帳にいるかが、全画面で常に読める
 *
 * **切り替えられることではなく、常時表示が守りである** ―― 防ぎたいのは
 * 「代行者が別の顧客の帳に実績を入れてしまう」ことで、入れたあとに
 * 気づくのでは遅い。
 *
 * **付与が1件以上あるデータで測る**（CLAUDE.md §2.11 の3つ目の形）。
 * 0件では「出ないのが正しい」ので、**実装していなくても通る。** 同じ
 * 実行で「出る」と「出ない」の両方を測り、出る側を先に見る。
 *
 * jsdom を使うのは、ここが**帳と表示の対応という構造的な不変条件**だから
 * である（§2.7）。レイアウトは見ていない。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AppDataContext } from "@/components/app-shell/AppDataProvider";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { makeStore, makeData, FIXTURE_USER_ID } from "@/components/app-shell/store-fixture";
import { ownBookOnly, type Book } from "@/lib/sharing";

afterEach(cleanup);

const OTHER = "owner-2";
const LABEL = "kyaku@example.com";

/** 自分の帳と、渡されている帳が1つ。**0件ではない** */
const WITH_GRANT: Book[] = [
  ...ownBookOnly(FIXTURE_USER_ID),
  { ownerId: OTHER, label: LABEL, own: false, level: "edit" },
];

function draw(books: Book[], activeOwnerId: string) {
  render(
    createElement(
      AppDataContext.Provider,
      {
        value: makeStore({
          data: makeData({ asOf: "2026-11-01" }),
          books,
          activeOwnerId,
        }),
      },
      createElement(Sidebar, { currentHref: "/" } as never),
    ),
  );
}

describe("AC-84 帳の常時表示", () => {
  it("他人の帳にいるときは、その帳が読める", () => {
    draw(WITH_GRANT, OTHER);
    expect(screen.getByText(new RegExp(LABEL))).toBeTruthy();
  });

  it("同じデータでも、自分の帳にいるときは何も出ない", () => {
    /* **付与は在るまま。** 付与が0件のデータで測ると、帳を見ていない
       実装でも通る ―― 出すものが無いので */
    draw(WITH_GRANT, FIXTURE_USER_ID);
    expect(screen.queryByText(new RegExp(LABEL))).toBeNull();
    expect(screen.queryByText(/の帳/)).toBeNull();
  });

  it("付与が0件の利用者には、いまの画面と同じに見える", () => {
    draw(ownBookOnly(FIXTURE_USER_ID), FIXTURE_USER_ID);
    expect(screen.queryByText(/の帳/)).toBeNull();
  });

  it("失効されて一覧から消えたら、その帳を指し続けない", () => {
    /* 一覧に無い帳を指した状態。`activeBook` が先頭（自分の帳）に落とす */
    draw(ownBookOnly(FIXTURE_USER_ID), OTHER);
    expect(screen.queryByText(/の帳/)).toBeNull();
  });
});
