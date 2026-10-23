import { describe, expect, it } from "vitest";

import type { Actual } from "@/core/types";
import { buildHeaderStats } from "@/lib/header-stats";

import { isSubmittable } from "../ActualForm";

import {
  buildEntryFixture,
  buildEntrySeries,
  FIXTURE_ACCOUNTS,
  FIXTURE_TODAY,
} from "../entry-fixture";
import {
  amountTypeOf,
  buildEntryActualRows,
  buildEntryMonths,
  buildEntryTodoRows,
  futureNoteOf,
} from "../entry-view-model";

/**
 * SC-05 の配線
 *
 * **行の id が操作の宛先になる。** ここがずれると「予定どおり」を押した
 * のに別の行が消し込まれる。目視では気づけない。
 */

const fixture = buildEntryFixture();
const todos = buildEntryTodoRows(fixture.todo);

describe("要対応の行", () => {
  it("フィクスチャに2種類の行が揃っている（検査の前提）", () => {
    expect(todos.some((r) => r.kind === "plan")).toBe(true);
    expect(todos.some((r) => r.kind === "candidate")).toBe(true);
  });

  it("**id は操作の宛先。** 予定はキー、実績は実績の id", () => {
    for (const [i, row] of todos.entries()) {
      const source = fixture.todo[i];
      expect(row.id).toBe(
        source.kind === "plan" ? source.plan.key : source.actual.id,
      );
    }
  });

  it("id が重複しない", () => {
    const ids = todos.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("候補の行は候補を全件持つ（AC-39）", () => {
    const candidates = todos.filter((r) => r.kind === "candidate");
    expect(candidates.length).toBeGreaterThan(0);
    for (const row of candidates) {
      const source = fixture.todo.find(
        (s) => s.kind === "candidate" && s.actual.id === row.id,
      );
      expect(source?.kind).toBe("candidate");
      if (source?.kind !== "candidate") return;
      expect(row.candidates).toHaveLength(source.plans.length);
      /* 候補の id は予定のキー。照合の宛先になる */
      expect(row.candidates.map((c) => c.id)).toEqual(
        source.plans.map((c) => c.plan.key),
      );
    }
  });

  it("候補に挙がっている予定は、予定の行として重ねて出さない", () => {
    /* 同じ課題が2件に見えないこと（buildTodoList の仕様） */
    const planIds = new Set(todos.filter((r) => r.kind === "plan").map((r) => r.id));
    for (const row of todos) {
      if (row.kind !== "candidate") continue;
      for (const c of row.candidates) expect(planIds.has(c.id)).toBe(false);
    }
  });
});

describe("金額の向き", () => {
  it("振替は neutral。収入は income、費用は expense", () => {
    expect(amountTypeOf("transfer", "振替")).toBe("neutral");
    expect(amountTypeOf("income", "収入")).toBe("income");
    expect(amountTypeOf("expense", "固定費")).toBe("expense");
    /* 区分が決まらなくても、種別で向きは決まる */
    expect(amountTypeOf("expense", null)).toBe("expense");
  });
});

describe("実績一覧", () => {
  const list = fixture.list;

  it("月のタブは選択中・過去・未来を区別する", () => {
    const months = buildEntryMonths(list, FIXTURE_TODAY);
    expect(months.length).toBe(list.months.length);
    expect(months.filter((m) => m.state === "active")).toHaveLength(1);
    expect(months.find((m) => m.state === "active")?.value).toBe(list.yearMonth);

    const thisMonth = FIXTURE_TODAY.slice(0, 7);
    for (const m of months) {
      if (m.state === "future") expect(m.value > thisMonth).toBe(true);
      if (m.state === "inactive") expect(m.value <= thisMonth).toBe(true);
    }
  });

  it("注記は未来の月を見ているときだけ", () => {
    expect(futureNoteOf(list, FIXTURE_TODAY)).toBeNull();
    const future = { ...list, yearMonth: "2027-01" };
    expect(futureNoteOf(future, FIXTURE_TODAY)).toContain("前払い");
  });

  it("行は実績そのまま。id は実績の id", () => {
    const rows = buildEntryActualRows(list.rows);
    expect(rows.map((r) => r.id)).toEqual(list.rows.map((a) => a.id));
  });
});

describe("PageHeader", () => {
  it("ほかの画面と同じ4つを出す", () => {
    const stats = buildHeaderStats(
      buildEntrySeries(),
      FIXTURE_ACCOUNTS,
      FIXTURE_TODAY,
    );
    expect(stats.map((s) => s.label)).toEqual([
      "今日の残高",
      "30日後",
      "90日後",
      "カード未払",
    ]);
  });
});

describe("isSubmittable — 振替先の検査", () => {
  /**
   * **振替先が無いまま保存できてはいけない。**
   * 保存できると、残高から出ていく側だけが効いて受ける側に入らず、
   * 合計が金額ぶん減る。画面には「振替」と出るので辻褄が合わない。
   * 実際に14件そうなった（2026-09-02〜10-02、¥2,389,980）。
   *
   * 手入力とインライン編集が同じ関数を使っているので、ここで両方を留める。
   */
  const base: Actual = {
    id: "a",
    key: null,
    unplanned: false,
    date: "2026-10-05",
    name: "振替",
    type: "transfer",
    costType: null,
    categoryCode: "TRF-01",
    amount: 50_000,
    bizRatio: 0,
    accountId: "bank",
  };

  it("振替で振替先が無ければ保存できない", () => {
    expect(isSubmittable({ ...base, toAccountId: undefined })).toBe(false);
    expect(isSubmittable({ ...base, toAccountId: "" })).toBe(false);
  });

  it("振替先があれば保存できる", () => {
    expect(isSubmittable({ ...base, toAccountId: "cash" })).toBe(true);
  });

  it("振替以外は振替先を要求しない", () => {
    const expense: Actual = {
      ...base,
      type: "expense",
      costType: "variable",
      categoryCode: "EXP-20",
    };
    expect(isSubmittable({ ...expense, toAccountId: undefined })).toBe(true);
  });

  it("名前と金額の検査は残っている", () => {
    expect(isSubmittable({ ...base, toAccountId: "cash", name: "  " })).toBe(false);
    expect(isSubmittable({ ...base, toAccountId: "cash", amount: 0 })).toBe(false);
  });
});
