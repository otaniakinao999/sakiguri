import { describe, expect, it } from "vitest";

import {
  actualToEvent,
  firstSettleDateOnOrAfter,
  settleDateOf,
  settleKey,
  signedAmount,
  toCashEvents,
} from "../cash";
import type {
  Account,
  Actual,
  CardAccount,
  DepositAccount,
  LedgerEvent,
} from "../types";

/* ========================= 素材 ========================= */

const bank: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 380_000,
};

/** AC-01 のカード：締日15日・翌月・支払日10日 */
function card(over: Partial<CardAccount> = {}): CardAccount {
  return {
    id: "c1",
    name: "メインカード",
    kind: "card",
    balance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 10,
    settleAccountId: "a1",
    ...over,
  };
}

function event(over: Partial<LedgerEvent> & Pick<LedgerEvent, "date">): LedgerEvent {
  return {
    key: `k:${over.date}`,
    name: "買い物",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 10_000,
    bizRatio: 0,
    accountId: "c1",
    src: "oneoff",
    ...over,
  };
}

/* ========================= CL-2 手順2 引落日 ========================= */

describe("settleDateOf（引落日の算出）", () => {
  const c = card();

  it("AC-01: 締日15日・翌月10日払いで 8/20 に使うと 10/10 に落ちる", () => {
    // 20 > 15 なので締め月は9月 → 支払月は10月 → 10/10
    expect(settleDateOf(c, "2026-08-20")).toBe("2026-10-10");
  });

  it("締日以前の利用は当月締めになる", () => {
    // 15 <= 15 なので締め月は8月 → 支払月は9月 → 9/10
    expect(settleDateOf(c, "2026-08-15")).toBe("2026-09-10");
    expect(settleDateOf(c, "2026-08-01")).toBe("2026-09-10");
  });

  it("締日の翌日から翌月締めになる", () => {
    expect(settleDateOf(c, "2026-08-16")).toBe("2026-10-10");
  });

  it("年をまたぐ", () => {
    expect(settleDateOf(c, "2026-11-20")).toBe("2027-01-10");
    expect(settleDateOf(c, "2026-12-20")).toBe("2027-02-10");
  });

  it("payMonthOffset=0（当月払い）", () => {
    const c0 = card({ payMonthOffset: 0, closingDay: 5, payDay: 27 });
    expect(settleDateOf(c0, "2026-08-03")).toBe("2026-08-27");
    expect(settleDateOf(c0, "2026-08-10")).toBe("2026-09-27");
  });

  it("payMonthOffset=2（翌々月払い）", () => {
    const c2 = card({ payMonthOffset: 2 });
    expect(settleDateOf(c2, "2026-08-20")).toBe("2026-11-10");
  });

  it("支払日が月末を超える場合は月末に丸める", () => {
    const c31 = card({ closingDay: 31, payDay: 31 });
    // 2月払いになるケース
    expect(settleDateOf(c31, "2026-01-20")).toBe("2026-02-28");
    expect(settleDateOf(c31, "2028-01-20")).toBe("2028-02-29");
    expect(settleDateOf(c31, "2026-03-20")).toBe("2026-04-30");
  });

  it("締日31は月末締めとして扱う", () => {
    const c31 = card({ closingDay: 31, payDay: 10 });
    // 2月末日は28日。28 <= 31 なので当月締め → 3月10日
    expect(settleDateOf(c31, "2026-02-28")).toBe("2026-03-10");
  });
});

describe("firstSettleDateOnOrAfter", () => {
  const c = card();

  it("当月の引落日がまだ来ていなければ当月", () => {
    expect(firstSettleDateOnOrAfter(c, "2026-04-01")).toBe("2026-04-10");
  });

  it("引落日当日は当月", () => {
    expect(firstSettleDateOnOrAfter(c, "2026-04-10")).toBe("2026-04-10");
  });

  it("引落日を過ぎていれば翌月", () => {
    expect(firstSettleDateOnOrAfter(c, "2026-04-11")).toBe("2026-05-10");
    expect(firstSettleDateOnOrAfter(c, "2026-04-30")).toBe("2026-05-10");
  });

  it("年をまたぐ", () => {
    expect(firstSettleDateOnOrAfter(c, "2026-12-20")).toBe("2027-01-10");
  });

  it("支払日が月末を超える場合は月末に丸める", () => {
    const c31 = card({ payDay: 31 });
    expect(firstSettleDateOnOrAfter(c31, "2026-02-01")).toBe("2026-02-28");
  });
});

/* ========================= CL-2 手順1・3・5 ========================= */

describe("toCashEvents", () => {
  const accounts: Account[] = [bank, card()];

  it("AC-01: カード利用は利用日に残高を動かさず、引落日に1件出金が立つ", () => {
    const got = toCashEvents(
      [event({ date: "2026-08-20", amount: 10_000 })],
      accounts,
      "2026-08-01",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      key: "s:c1|2026-10-10",
      date: "2026-10-10",
      name: "メインカード 引落",
      type: "expense",
      amount: 10_000,
      accountId: "a1", // 引落元口座
      src: "settle",
      cardId: "c1",
    });
    // 8/20 には現金イベントが立たない
    expect(got.some((e) => e.date === "2026-08-20")).toBe(false);
  });

  it("銀行口座の入出金はそのまま通る", () => {
    const got = toCashEvents(
      [event({ date: "2026-08-20", accountId: "a1", amount: 50_000 })],
      accounts,
      "2026-08-01",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ date: "2026-08-20", accountId: "a1", src: "oneoff" });
  });

  it("同じ引落日のカード利用は合算される（手順3）", () => {
    const got = toCashEvents(
      [
        event({ key: "k1", date: "2026-08-20", amount: 10_000 }),
        event({ key: "k2", date: "2026-08-25", amount: 3_000 }),
        event({ key: "k3", date: "2026-09-10", amount: 2_000 }),
      ],
      accounts,
      "2026-08-01",
    );

    // 3件とも締め月9月・支払月10月に入る
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ date: "2026-10-10", amount: 15_000 });
  });

  it("締め期間が違えば別の引落になる", () => {
    const got = toCashEvents(
      [
        event({ key: "k1", date: "2026-08-10", amount: 10_000 }), // 8月締め → 9/10
        event({ key: "k2", date: "2026-08-20", amount: 3_000 }), // 9月締め → 10/10
      ],
      accounts,
      "2026-08-01",
    );

    expect(got.map((e) => [e.date, e.amount])).toEqual([
      ["2026-09-10", 10_000],
      ["2026-10-10", 3_000],
    ]);
  });

  it("カードへの返金は支出と相殺される（手順3）", () => {
    const got = toCashEvents(
      [
        event({ key: "k1", date: "2026-08-20", amount: 10_000 }),
        event({ key: "k2", date: "2026-08-22", amount: 3_000, type: "income" }),
      ],
      accounts,
      "2026-08-01",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "expense", amount: 7_000 });
  });

  it("返金が上回ると引落イベントは income になる（手順5）", () => {
    const got = toCashEvents(
      [
        event({ key: "k1", date: "2026-08-20", amount: 3_000 }),
        event({ key: "k2", date: "2026-08-22", amount: 10_000, type: "income" }),
      ],
      accounts,
      "2026-08-01",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "income", amount: 7_000 });
  });

  it("合算が0なら引落イベントを作らない（手順5）", () => {
    const got = toCashEvents(
      [
        event({ key: "k1", date: "2026-08-20", amount: 10_000 }),
        event({ key: "k2", date: "2026-08-22", amount: 10_000, type: "income" }),
      ],
      accounts,
      "2026-08-01",
    );

    expect(got).toEqual([]);
  });

  it("カードが絡む振替は現金の移動として通す（手順1）", () => {
    const got = toCashEvents(
      [
        event({
          date: "2026-08-20",
          type: "transfer",
          accountId: "a1",
          toAccountId: "c1",
          costType: null,
          categoryCode: "TRF-01",
        }),
      ],
      accounts,
      "2026-08-01",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ date: "2026-08-20", type: "transfer" });
  });

  it("基準日時点の未払残高は最初に到来する引落日に乗る（手順4）", () => {
    const got = toCashEvents([], [bank, card({ balance: 142_000 })], "2026-04-01");

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      date: "2026-04-10",
      amount: 142_000,
      type: "expense",
    });
  });

  it("未払残高は同じ引落日の利用と合算される", () => {
    const got = toCashEvents(
      // 3/20 利用 → 4月締め → 5/10 ではなく、3/20 は 3/15 超えなので4月締め→5/10
      [event({ date: "2026-03-10", amount: 8_000 })], // 3月締め → 4/10
      [bank, card({ balance: 142_000 })],
      "2026-04-01",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ date: "2026-04-10", amount: 150_000 });
  });

  it("未払残高が0のカードは引落を作らない", () => {
    expect(toCashEvents([], [bank, card({ balance: 0 })], "2026-04-01")).toEqual([]);
  });

  it("日付昇順で返す（手順6）", () => {
    const got = toCashEvents(
      [
        event({ key: "k1", date: "2026-09-05", accountId: "a1" }),
        event({ key: "k2", date: "2026-08-10", accountId: "a1" }),
        event({ key: "k3", date: "2026-08-20" }), // → 10/10
      ],
      accounts,
      "2026-08-01",
    );

    expect(got.map((e) => e.date)).toEqual([
      "2026-08-10",
      "2026-09-05",
      "2026-10-10",
    ]);
  });

  it("存在しない口座を指すイベントは投げる", () => {
    expect(() =>
      toCashEvents([event({ date: "2026-08-20", accountId: "zzz" })], accounts, "2026-08-01"),
    ).toThrow(/口座が見つかりません/);
  });

  it("入力を書き換えない", () => {
    const events = [event({ date: "2026-08-20" })];
    const snapshot = structuredClone(events);

    toCashEvents(events, accounts, "2026-08-01");

    expect(events).toEqual(snapshot);
  });
});

/* ========================= 補助 ========================= */

describe("signedAmount", () => {
  it("income は増、expense は減、transfer は0", () => {
    expect(signedAmount({ type: "income", amount: 1_000 })).toBe(1_000);
    expect(signedAmount({ type: "expense", amount: 1_000 })).toBe(-1_000);
    expect(signedAmount({ type: "transfer", amount: 1_000 })).toBe(0);
  });
});

describe("settleKey", () => {
  it("要件定義書 §3.2 の形式", () => {
    expect(settleKey("c1", "2026-09-10")).toBe("s:c1|2026-09-10");
  });
});

describe("actualToEvent", () => {
  it("src を actual にして予定と同じ形にする", () => {
    const actual: Actual = {
      id: "act1",
      key: "r:rh1:2026-04-27",
      date: "2026-04-27",
      name: "家賃",
      type: "expense",
      costType: "fixed",
      categoryCode: "EXP-01",
      amount: 120_000,
      bizRatio: 25,
      accountId: "a1",
    };

    expect(actualToEvent(actual)).toEqual({
      key: "r:rh1:2026-04-27",
      date: "2026-04-27",
      name: "家賃",
      type: "expense",
      costType: "fixed",
      categoryCode: "EXP-01",
      amount: 120_000,
      bizRatio: 25,
      accountId: "a1",
      toAccountId: undefined,
      src: "actual",
      /* 入出金予定表から実績を編集するために id を運ぶ（FR-33）。
         key は予定との紐づけで、突発の実績では null になるため使えない */
      srcId: "act1",
    });
  });

  it("突発の実績（key が null）でも srcId は入る", () => {
    const sudden: Actual = {
      id: "act2",
      key: null,
      date: "2026-04-20",
      name: "スーパー",
      type: "expense",
      costType: "variable",
      categoryCode: "EXP-21",
      amount: 4_820,
      bizRatio: 0,
      accountId: "a1",
    };

    expect(actualToEvent(sudden).key).toBeNull();
    expect(actualToEvent(sudden).srcId).toBe("act2");
  });
});
