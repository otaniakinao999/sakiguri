/**
 * AC-70 資金移動の行から、どちらからどちらへ動いたかが読めること（FR-63）
 *
 * 利用者の報告：
 *
 * > SAKIGURIでは資金移動に符号が表示されないので、この2件が計算上
 * > マイナスになっているのか、こちらからは判断できませんでした。
 *
 * ## 退化させない（CLAUDE.md §2.11）
 *
 * **向きが出る行だけを測ると、「全部の行に向きを出す実装」と区別が
 * 付かない。** 同じ実行の中で、出る行（`type = transfer`）と出ない行
 * （両側記録・通常の支出）の両方を数える。
 */

import { describe, expect, it } from "vitest";

import {
  accountNames,
  formatTransferDirection,
  NO_DESTINATION,
  UNKNOWN_ACCOUNT,
} from "../transfer-direction";
import { touchesAccount, transferEnds } from "../types";
import type { Account, Actual, EntryType } from "../types";

const ACCOUNTS: Account[] = [
  { id: "cash", name: "現金", kind: "cash", balance: 52_000 },
  { id: "bank", name: "○○銀行", kind: "bank", balance: 1_000_000 },
  {
    id: "card",
    name: "××カード",
    kind: "card",
    balance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 10,
    settleAccountId: "bank",
  },
];

const NAMES = accountNames(ACCOUNTS);

const row = (over: Partial<Actual> = {}): Actual => ({
  id: "x1",
  key: null,
  unplanned: true,
  name: "ＡＴＭ　ローソン",
  type: "transfer",
  costType: null,
  categoryCode: "TRF-01",
  amount: 23_000,
  bizRatio: 0,
  accountId: "cash",
  toAccountId: "bank",
  date: "2026-10-23",
  ...over,
});

describe("AC-70 向きの表示", () => {
  it("移動元 → 移動先 が出る", () => {
    expect(formatTransferDirection(row(), NAMES)).toBe("現金 → ○○銀行");
  });

  it("**逆向きの行は逆に出る**（これが読めなかったので 46,000円 ずれた）", () => {
    /* 実データの形。17件は銀行→現金の引出しで、1件だけが現金→銀行の
       預け入れだった。名前はどちらも「ＡＴＭ　…」で並ぶ */
    const withdraw = row({ accountId: "bank", toAccountId: "cash" });
    expect(formatTransferDirection(withdraw, NAMES)).toBe("○○銀行 → 現金");
    expect(formatTransferDirection(row(), NAMES)).toBe("現金 → ○○銀行");
    /* **同じ実行で両方を見る。** 片方だけだと、移動元を2回出す実装
       （「現金 → 現金」）でも通る */
    expect(formatTransferDirection(withdraw, NAMES)).not.toBe(
      formatTransferDirection(row(), NAMES),
    );
  });

  it("振替先が未設定なら、移動元と「未設定」が出る", () => {
    const got = formatTransferDirection(row({ toAccountId: undefined }), NAMES);
    expect(got).toBe(`現金 → ${NO_DESTINATION}`);
  });

  it("振替先がカードでも向きは出る（残高に反映されない行）", () => {
    expect(formatTransferDirection(row({ toAccountId: "card" }), NAMES)).toBe(
      "現金 → ××カード",
    );
  });

  it("口座が見つからなくても向きは出る", () => {
    expect(formatTransferDirection(row({ toAccountId: "gone" }), NAMES)).toBe(
      `現金 → ${UNKNOWN_ACCOUNT}`,
    );
  });
});

describe("AC-70 向きが出ない行", () => {
  /**
   * **両側記録の行には出さない**（適用規則5a・FR-51）。
   *
   * `toAccountId` を持たないので相手が分からない。そのうえ、あの行は
   * 口座を1つしか動かすので**合計の範囲でも符号が付く**（AC-58b）。
   * AC-70 が埋めるのは「符号が付かないのに向きも読めない」行だけで、
   * そこは `transfer` に限られる。
   */
  it("両側記録（income / expense に TRF の費目）には出ない", () => {
    expect(
      formatTransferDirection(
        row({ type: "expense", categoryCode: "TRF-01", toAccountId: undefined }),
        NAMES,
      ),
    ).toBeNull();
    expect(
      formatTransferDirection(
        row({ type: "income", categoryCode: "TRF-01", toAccountId: undefined }),
        NAMES,
      ),
    ).toBeNull();
  });

  it("通常の支出・収入には出ない", () => {
    expect(
      formatTransferDirection(
        row({ type: "expense", categoryCode: "EXP-01", toAccountId: undefined }),
        NAMES,
      ),
    ).toBeNull();
  });

  /**
   * **収支を切り替えた残りかすを読まない**（AC-58d）。
   *
   * 振替で入れて振替先を選んだあと収入に変えると、画面から欄は消えるが
   * 値が残る。向きを出すと「入金なのに → 現金」と出て、**残高が動いて
   * いない口座が行から読める**ことになる。
   */
  it("振替でない行に振替先が残っていても読まない", () => {
    expect(
      formatTransferDirection(row({ type: "income", toAccountId: "bank" }), NAMES),
    ).toBeNull();
  });

  it("出る行と出ない行が同じ実行で混ざる（AC-70 の条項）", () => {
    const rows: Actual[] = [
      row({ id: "t", type: "transfer" }),
      row({ id: "out", type: "expense", toAccountId: undefined }),
      row({ id: "in", type: "income", toAccountId: undefined }),
    ];
    const shown = rows.map((r) => formatTransferDirection(r, NAMES) !== null);
    /* **全部 true / 全部 false のどちらでもないこと。** 片側だけ数えると
       「全部に出す」実装とも「どれにも出さない」実装とも区別が付かない */
    expect(shown).toEqual([true, false, false]);
  });
});

describe("transferEnds は toAccountId を読む唯一の判定（§2.8）", () => {
  const TYPES: EntryType[] = ["income", "expense", "transfer"];

  /**
   * **`toAccountId` を読む経路を数える。** 2026-11-11 の欠陥は、
   * 残高（`accountDelta`）は正しいのに**一覧の絞り込みと口座削除**
   * （`touchesAccount`）だけが振替以外の `toAccountId` を見ていたもの。
   * 条項が値の名前を挙げていても、読む経路の全部を測ったことには
   * ならない（CLAUDE.md §2.11）。
   *
   * ここでは**読む側が同じ判定を使っていること**を固定する。
   * `transferEnds` の gate を外すと、両方が同時に落ちる。
   */
  it("touchesAccount と向きの表示が、同じ gate を通る", () => {
    for (const type of TYPES) {
      const r = row({ type, toAccountId: "bank" });
      const hasEnds = transferEnds(r) !== null;
      expect(touchesAccount(r, "bank")).toBe(hasEnds);
      expect(formatTransferDirection(r, NAMES) !== null).toBe(hasEnds);
      /* 自分の口座は type に関わらず拾う（こちらは gate の外） */
      expect(touchesAccount(r, "cash")).toBe(true);
    }
  });

  it("移動元は常に accountId、移動先は未設定なら null", () => {
    expect(transferEnds(row())).toEqual({ fromId: "cash", toId: "bank" });
    expect(transferEnds(row({ toAccountId: undefined }))).toEqual({
      fromId: "cash",
      toId: null,
    });
  });
});
