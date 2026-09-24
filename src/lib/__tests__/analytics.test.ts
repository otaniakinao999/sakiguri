import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_PROP_KEYS,
  hasForbiddenKey,
  type EventMap,
  type EventProps,
} from "../analytics/events";

/**
 * docs/adr/0013-利用イベントに金額を入れない.md を機械で守る。
 *
 * 型で防いでいるが、型はいつでも緩められる。緩めたことに気づけるよう、
 * 検査をここに置く。
 */

describe("ADR-0013 イベントに資金繰りの中身を入れない", () => {
  it("禁止キーを弾く", () => {
    expect(hasForbiddenKey({ amount: 120_000 })).toBe("amount");
    expect(hasForbiddenKey({ rows: 3, balance: 1_000 })).toBe("balance");
    expect(hasForbiddenKey({ accountName: 1 })).toBe("accountName");
  });

  it("問題ない props は通す", () => {
    expect(hasForbiddenKey({ rows: 3, matched: 1 })).toBeNull();
    expect(hasForbiddenKey({ recurring: true })).toBeNull();
    expect(hasForbiddenKey({})).toBeNull();
  });

  it("金額・名称・端末情報が禁止キーに入っている", () => {
    for (const key of [
      "amount",
      "balance",
      "name",
      "categoryName",
      "accountName",
      "counterparty",
      "filename",
      "ip",
      "userAgent",
      "email",
    ]) {
      expect(FORBIDDEN_PROP_KEYS).toContain(key);
    }
  });

  /**
   * props に文字列を入れられないこと。
   *
   * 型の話なので実行時には確かめられない。@ts-expect-error が外れたら
   * （＝代入が通るようになったら）コンパイルが失敗する。
   */
  it("props に自由入力の文字列を入れられない", () => {
    // @ts-expect-error 文字列は EventProps に入らない
    const bad: EventProps = { name: "スーパー" };
    expect(bad).toBeDefined();
  });

  it("定義済みイベントの props はすべて数値か真偽値", () => {
    /* 実際の値で型が通ることを確かめる。ここに文字列を足そうとすると
       コンパイルが失敗する */
    const samples: { [K in keyof EventMap]: EventMap[K] } = {
      signed_in: {},
      plan_created: { recurring: true },
      actual_recorded: {
        settled: true,
        fromCsv: false,
        fromCandidate: true,
        unplanned: false,
      },
      csv_imported: { rows: 12, matched: 3 },
      shortfall_warned: { shortfall: false, daysAhead: 41 },
      shortfall_acted: { toEntry: true },
      plan_deferred: { skipped: false },
      load_incomplete: { expected: 3_000, received: 1_000 },
      forecast_horizon: { months: 8, accounts: 3 },
    };

    for (const [event, props] of Object.entries(samples)) {
      expect(hasForbiddenKey(props as EventProps), event).toBeNull();
      for (const value of Object.values(props)) {
        expect(["number", "boolean"]).toContain(typeof value);
      }
    }
  });

  it("イベント名に金額や名称を思わせるものが無い", () => {
    const names: (keyof EventMap)[] = [
      "signed_in",
      "plan_created",
      "actual_recorded",
      "csv_imported",
      "shortfall_warned",
      "shortfall_acted",
      "plan_deferred",
      "load_incomplete",
      "forecast_horizon",
    ];
    for (const name of names) {
      expect(name).not.toMatch(/amount|balance|yen|金額/);
    }
  });
});
