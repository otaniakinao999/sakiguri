import { describe, expect, it } from "vitest";

import type { DepositAccount, RecurringItem } from "@/core/types";

import { emptyAppData, type AppData } from "../app-data";
import {
  addAccount,
  addRecurring,
  removeRecurring,
  setOverride,
  setReserveLine,
  updateRecurring,
} from "../mutations";
import { diffAppData } from "../supabase/diff";
import {
  fromAccount,
  fromActual,
  fromOverride,
  fromRecurring,
  toAccount,
  toActual,
  toOverrides,
  toRecurring,
} from "../supabase/rows";

const ASOF = "2026-04-01";
const USER = "11111111-1111-1111-1111-111111111111";

const bank: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 1_000_000,
};

const rent: RecurringItem = {
  id: "rent",
  name: "家賃",
  type: "expense",
  costType: "fixed",
  categoryCode: "EXP-01",
  amount: 120_000,
  bizRatio: 25,
  accountId: "a1",
  day: 27,
  months: null,
  active: true,
};

function base(): AppData {
  return { ...emptyAppData(ASOF), accounts: [bank], recurring: [rent] };
}

/* ========================= 差分 ========================= */

describe("diffAppData", () => {
  it("初回はすべてを送る", () => {
    const diff = diffAppData(null, base());

    expect(diff.settingsChanged).toBe(true);
    expect(diff.accounts.upsert).toHaveLength(1);
    expect(diff.recurring.upsert).toHaveLength(1);
    expect(diff.empty).toBe(false);
  });

  it("何も変わっていなければ何も送らない", () => {
    const data = base();
    const diff = diffAppData(data, data);

    expect(diff.empty).toBe(true);
    expect(diff.settingsChanged).toBe(false);
    expect(diff.accounts.upsert).toEqual([]);
    expect(diff.recurring.upsert).toEqual([]);
  });

  it("同じ中身の別オブジェクトでも送らない", () => {
    const diff = diffAppData(base(), base());
    expect(diff.empty).toBe(true);
  });

  it("変わった行だけを送る", () => {
    const before = base();
    const after = updateRecurring(before, "rent", { amount: 130_000 });
    const diff = diffAppData(before, after);

    expect(diff.recurring.upsert).toHaveLength(1);
    expect(diff.recurring.upsert[0].amount).toBe(130_000);
    /* 触っていない口座は送らない */
    expect(diff.accounts.upsert).toEqual([]);
    expect(diff.settingsChanged).toBe(false);
  });

  it("増えた行を送る", () => {
    const before = base();
    const after = addRecurring(before, { ...rent, id: "sub", name: "サブスク" });
    const diff = diffAppData(before, after);

    expect(diff.recurring.upsert.map((r) => r.id)).toEqual(["sub"]);
    expect(diff.recurring.deleteIds).toEqual([]);
  });

  it("消えた行の id を送る", () => {
    const before = base();
    const after = removeRecurring(before, "rent");
    const diff = diffAppData(before, after);

    expect(diff.recurring.deleteIds).toEqual(["rent"]);
    expect(diff.recurring.upsert).toEqual([]);
  });

  it("設定の変更を拾う", () => {
    const before = base();
    expect(diffAppData(before, setReserveLine(before, 600_000)).settingsChanged).toBe(
      true,
    );
  });

  it("口座の追加を拾う", () => {
    const before = base();
    const after = addAccount(before, { ...bank, id: "a2", name: "事業口座" });

    expect(diffAppData(before, after).accounts.upsert.map((a) => a.id)).toEqual([
      "a2",
    ]);
  });

  it("オーバーライドの追加と解除", () => {
    const before = base();
    const added = setOverride(before, "r:rent:2026-04-27", { skipped: true });

    const addDiff = diffAppData(before, added);
    expect(addDiff.overrides.upsert.map((o) => o.key)).toEqual([
      "r:rent:2026-04-27",
    ]);

    const removeDiff = diffAppData(added, before);
    expect(removeDiff.overrides.deleteIds).toEqual(["r:rent:2026-04-27"]);
  });

  it("オーバーライドの中身の変更を拾う", () => {
    const before = setOverride(base(), "k", { date: "2026-05-08" });
    const after = setOverride(before, "k", { note: "延期" });

    expect(diffAppData(before, after).overrides.upsert).toHaveLength(1);
  });

  it("入力を書き換えない", () => {
    const before = base();
    const after = updateRecurring(before, "rent", { amount: 130_000 });
    const snapshot = structuredClone({ before, after });

    diffAppData(before, after);

    expect({ before, after }).toEqual(snapshot);
  });
});

/* ========================= 行の変換 ========================= */

describe("行とアプリ型の往復", () => {
  it("銀行口座", () => {
    expect(toAccount(fromAccount(bank, USER))).toEqual(bank);
  });

  it("カード", () => {
    const card = {
      id: "c1",
      name: "メインカード",
      kind: "card" as const,
      balance: 142_000,
      closingDay: 15,
      payMonthOffset: 1,
      payDay: 10,
      settleAccountId: "a1",
    };
    expect(toAccount(fromAccount(card, USER))).toEqual(card);
  });

  it("定期項目", () => {
    expect(toRecurring(fromRecurring(rent, USER))).toEqual(rent);
  });

  it("対象月のある定期項目", () => {
    const item = { ...rent, months: [6, 8, 10, 1] };
    expect(toRecurring(fromRecurring(item, USER))).toEqual(item);
  });

  it("振替（振替先つき）", () => {
    const item = {
      ...rent,
      type: "transfer" as const,
      costType: null,
      categoryCode: "TRF-02",
      toAccountId: "a2",
    };
    expect(toRecurring(fromRecurring(item, USER))).toEqual(item);
  });

  it("実績（消し込み済み）", () => {
    const actual = {
      id: "x1",
      key: "r:rent:2026-04-27",
      date: "2026-04-27",
      name: "家賃",
      type: "expense" as const,
      costType: "fixed" as const,
      categoryCode: "EXP-01",
      amount: 118_000,
      bizRatio: 25,
      accountId: "a1",
      toAccountId: undefined,
    };
    expect(toActual(fromActual(actual, USER))).toEqual(actual);
  });

  it("実績（突発。キーが null）", () => {
    const actual = {
      id: "x2",
      key: null,
      date: "2026-04-10",
      name: "突発",
      type: "expense" as const,
      costType: "variable" as const,
      categoryCode: "EXP-20",
      amount: 5_000,
      bizRatio: 0,
      accountId: "a1",
      toAccountId: undefined,
    };
    expect(toActual(fromActual(actual, USER))).toEqual(actual);
  });

  it("オーバーライド（変えた項目だけが残る）", () => {
    const rows = [
      fromOverride("k1", { date: "2026-05-08", note: "延期" }, USER),
      fromOverride("k2", { skipped: true }, USER),
      fromOverride("k3", { amount: 0 }, USER),
    ];

    expect(toOverrides(rows)).toEqual({
      k1: { date: "2026-05-08", note: "延期" },
      k2: { skipped: true },
      k3: { amount: 0 },
    });
  });

  it("user_id を必ず入れる", () => {
    expect(fromAccount(bank, USER).user_id).toBe(USER);
    expect(fromRecurring(rent, USER).user_id).toBe(USER);
    expect(fromOverride("k", { skipped: true }, USER).user_id).toBe(USER);
  });
});
