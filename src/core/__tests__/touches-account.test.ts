import { describe, expect, it } from "vitest";

import { touchesAccount } from "../types";
import type { EntryType } from "../types";

/**
 * 口座に関わる行の判定（要望2・AC-58d）
 *
 * **振替は2つの口座に関わる。** 出す側だけで判定すると、その口座へ
 * 入ってきた振替が落ちる。一覧から消えるだけなので、**画面を見ても
 * 「もともと無い」としか分からない。**
 *
 * 同じ判定を口座の削除（`removeAccount` の道連れの範囲）も使う。
 * 片方にだけ条件が増えると「一覧には出ないのに、口座を消すと
 * 道連れになる」行ができる（CLAUDE.md §2.8）。
 *
 * **AC-58d：`toAccountId` を見るのは振替のときだけ。** 収支を振替から
 * 変えると画面から振替先の欄が消えるが、以前は値が残っていた（AC-58c）。
 * 残っている行をここが拾うと、**残高は1円も動かないのに、その口座の
 * 一覧に出て、その口座を消すと道連れになる。** 実際に本番でそうなった。
 *
 * **「見ない」だけを測らない**（CLAUDE.md §2.11）。全部の `toAccountId`
 * を無視する実装でも「見ない」は通る。**同じ組のデータで、振替の行が
 * ちゃんと拾われることも測る。**
 */

const row = (type: EntryType, toAccountId?: string) => ({
  type,
  accountId: "bank",
  toAccountId,
});

describe("touchesAccount", () => {
  it("出す側で拾う", () => {
    expect(touchesAccount(row("expense"), "bank")).toBe(true);
  });

  it("無関係な口座は拾わない", () => {
    expect(touchesAccount(row("transfer", "cash"), "shinkin")).toBe(false);
  });

  it("振替先が無い行でも落ちない", () => {
    expect(touchesAccount(row("expense", undefined), "bank")).toBe(true);
    expect(touchesAccount(row("expense", undefined), "cash")).toBe(false);
  });

  describe("AC-58d 振替先を見るのは振替のときだけ", () => {
    /* **在ることを先に測る。** これが無いと、`toAccountId` を一切見ない
       実装と区別がつかない（CLAUDE.md §2.11） */
    it("振替は受ける側でも拾う（ここが落ちやすい）", () => {
      expect(touchesAccount(row("transfer", "cash"), "cash")).toBe(true);
    });

    it("収入・支出の行は、振替先が残っていても拾わない", () => {
      expect(touchesAccount(row("income", "cash"), "cash")).toBe(false);
      expect(touchesAccount(row("expense", "cash"), "cash")).toBe(false);
    });

    it("拾わなくなるのは振替先の側だけ。自分の口座は変わらず拾う", () => {
      expect(touchesAccount(row("income", "cash"), "bank")).toBe(true);
    });

    /**
     * **収支のどれで変わるかを、`EntryType` の全体と突き合わせる。**
     * 収支が増えたときに、この表の漏れで落ちるようにしてある
     * （CLAUDE.md §2.8 の「列挙は集合と突き合わせる」）。
     */
    it("振替先を見る収支は transfer だけ", () => {
      const types: EntryType[] = ["income", "expense", "transfer"];
      const seen = types.filter((t) => touchesAccount(row(t, "cash"), "cash"));
      expect(seen).toEqual(["transfer"]);
    });
  });
});
