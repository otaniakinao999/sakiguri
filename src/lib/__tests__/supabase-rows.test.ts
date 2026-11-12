/**
 * 実績の行とアプリの型の往復（AC-64）
 *
 * **ここが落ちると FR-58 が丸ごと効かない。** 原文を保存しない／読まないと、
 * `matchNameOf` は表示名に落ちるので、**摘要を直した行は二度と「登録済み」に
 * ならない。** しかも画面は普通に動くので、次の取込まで誰も気づけない。
 *
 * 壊して測ったとき、`fromActual` と `toActual` から原文を落とす2通りは
 * **どのテストも割らなかった**（取込側のテストは DB を通らない）。
 * この検査はその穴を埋めるために足した（CLAUDE.md §2.11）。
 *
 * **取る列（`SELECT_COLUMNS`）の守りは型が持っている。** `columns<Row>()` は
 * `Record<keyof Row, true>` を要求するので、列を1つ落とすと `pnpm typecheck`
 * が落ちる（§2.8）。vitest では測れないので、ここでは測らない。
 */

import { describe, expect, it } from "vitest";

import { duplicateKeyOf } from "@/core/csv";
import type { Actual } from "@/core/types";

import { fromActual, toActual, type ActualRow } from "../supabase/rows";

const USER = "11111111-1111-4111-8111-000000000001";

const IMPORTED: Actual = {
  id: "a-1",
  key: null,
  date: "2026-10-20",
  name: "振込＊カ）ラボル",
  sourceName: "振込＊カ）ラボル",
  type: "income",
  costType: null,
  categoryCode: "INC-01",
  amount: 200_000,
  bizRatio: 100,
  accountId: "bank",
};

/**
 * 0009 より前に取り込んだ実績、または手入力の実績（原文を持たない）。
 *
 * **分解で落とさない。** 使わない変数が残り、lint が警告する。
 */
function withoutSourceName(a: Actual): Actual {
  const copy = { ...a };
  delete copy.sourceName;
  return copy;
}

describe("AC-64 原文が DB を往復する", () => {
  it("保存する行に原文が入る", () => {
    expect(fromActual(IMPORTED, USER).source_name).toBe("振込＊カ）ラボル");
  });

  it("原文を持たない実績は null で保存される（手入力）", () => {
    expect(fromActual(withoutSourceName(IMPORTED), USER).source_name).toBeNull();
  });

  it("読んだ行の原文がアプリ側に入る", () => {
    const row = fromActual(IMPORTED, USER);
    expect(toActual(row).sourceName).toBe("振込＊カ）ラボル");
  });

  it("null は undefined に寄る（「持たない」を1つの形で表す）", () => {
    const row: ActualRow = { ...fromActual(IMPORTED, USER), source_name: null };
    expect(toActual(row).sourceName).toBeUndefined();
    expect("sourceName" in toActual(row)).toBe(false);
  });

  /**
   * **これが肝。** 往復しても重複判定の鍵が変わらないこと ―― しかも
   * **表示名を直したあとで**変わらないこと。
   *
   * 直す前だけで測ると、原文を落としていても表示名が同じなので通る
   * （§2.11。利用者が指示に書いた「名前を直した行を混ぜる」と同じ形）。
   */
  it("表示名を直しても、往復後の鍵が変わらない", () => {
    const edited: Actual = { ...IMPORTED, name: "㈱ラボル" };
    expect(edited.name).not.toBe(edited.sourceName);

    const back = toActual(fromActual(edited, USER));
    expect(duplicateKeyOf(back)).toBe(duplicateKeyOf(IMPORTED));
  });

  it("原文を持たない実績の表示名を直すと、鍵は変わる（仕様どおり）", () => {
    /* 既存データはこうなる。**黙って消えない** ―― AC-65 が
       「似た行があります」として出す */
    const edited = { ...withoutSourceName(IMPORTED), name: "㈱ラボル" };

    const back = toActual(fromActual(edited, USER));
    expect(duplicateKeyOf(back)).not.toBe(duplicateKeyOf(IMPORTED));
  });
});
