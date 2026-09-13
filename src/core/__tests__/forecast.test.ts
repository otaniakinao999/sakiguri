import { describe, expect, it } from "vitest";

import {
  buildForecast,
  expandRecurring,
  oneoffKey,
  recurringKey,
  type ForecastInput,
} from "../forecast";
import type { OneoffItem, RecurringItem } from "../types";

/* ========================= 素材 ========================= */

function recurring(
  over: Partial<RecurringItem> & Pick<RecurringItem, "id" | "day">,
): RecurringItem {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    category: "住居費",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    months: null,
    active: true,
    ...over,
  };
}

function oneoff(
  over: Partial<OneoffItem> & Pick<OneoffItem, "id" | "date">,
): OneoffItem {
  return {
    name: "PC買い替え",
    type: "expense",
    costType: "variable",
    category: "消耗品費",
    amount: 268_000,
    bizRatio: 80,
    accountId: "c1",
    ...over,
  };
}

function input(over: Partial<ForecastInput> = {}): ForecastInput {
  return { recurring: [], oneoffs: [], ...over };
}

const dates = (items: { date: string }[]) => items.map((i) => i.date);

/* ========================= CL-1 手順1〜2 ========================= */

describe("CL-1 定期項目の展開", () => {
  it("AC-02: day=31 の定期項目は、2月は28日、4月は30日に発生する", () => {
    const item = recurring({ id: "rh5", day: 31, name: "国民健康保険" });

    const got = dates(expandRecurring(item, "2026-01-01", "2026-12-31"));

    expect(got).toEqual([
      "2026-01-31",
      "2026-02-28", // 2026年は平年
      "2026-03-31",
      "2026-04-30", // 30日しかない月
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ]);
  });

  it("AC-02: 閏年の2月は29日に発生する", () => {
    const item = recurring({ id: "rh5", day: 31 });

    expect(dates(expandRecurring(item, "2028-02-01", "2028-02-29"))).toEqual([
      "2028-02-29",
    ]);
  });

  it("day が月末以内ならその日に発生する", () => {
    const item = recurring({ id: "rh1", day: 27 });

    expect(dates(expandRecurring(item, "2026-01-01", "2026-04-30"))).toEqual([
      "2026-01-27",
      "2026-02-27",
      "2026-03-27",
      "2026-04-27",
    ]);
  });

  it("day=30 も2月は月末に寄る", () => {
    const item = recurring({ id: "r1", day: 30 });

    expect(dates(expandRecurring(item, "2026-02-01", "2026-03-31"))).toEqual([
      "2026-02-28",
      "2026-03-30",
    ]);
  });

  it("months を指定した月にだけ発生する（住民税）", () => {
    const item = recurring({
      id: "rh7",
      day: 31,
      name: "住民税",
      months: [6, 8, 10, 1],
    });

    expect(dates(expandRecurring(item, "2026-01-01", "2026-12-31"))).toEqual([
      "2026-01-31",
      "2026-06-30",
      "2026-08-31",
      "2026-10-31",
    ]);
  });

  it("months が空配列なら発生しない", () => {
    const item = recurring({ id: "r1", day: 10, months: [] });

    expect(expandRecurring(item, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("active が false の項目は展開しない", () => {
    const item = recurring({ id: "r1", day: 10, active: false });

    expect(expandRecurring(item, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("生成元の属性を引き継ぐ", () => {
    const item = recurring({
      id: "rb1",
      day: 25,
      name: "A社 業務委託料",
      type: "income",
      costType: null,
      category: "事業売上",
      amount: 450_000,
      bizRatio: 100,
      accountId: "a2",
    });

    const [got] = expandRecurring(item, "2026-05-01", "2026-05-31");

    expect(got).toEqual({
      key: "r:rb1:2026-05-25",
      date: "2026-05-25",
      name: "A社 業務委託料",
      type: "income",
      costType: null,
      category: "事業売上",
      amount: 450_000,
      bizRatio: 100,
      accountId: "a2",
      toAccountId: undefined,
      src: "recurring",
      srcId: "rb1",
    });
  });

  it("振替は toAccountId を保持する", () => {
    const item = recurring({
      id: "rt1",
      day: 26,
      type: "transfer",
      costType: null,
      category: null,
      toAccountId: "a1",
      accountId: "a2",
    });

    const [got] = expandRecurring(item, "2026-05-01", "2026-05-31");

    expect(got.type).toBe("transfer");
    expect(got.accountId).toBe("a2");
    expect(got.toAccountId).toBe("a1");
  });
});

/* ========================= キーの規約 ========================= */

describe("予定インスタンスキー", () => {
  it("定期項目は r:{id}:{発生日}", () => {
    expect(recurringKey("rh5", "2026-08-31")).toBe("r:rh5:2026-08-31");
  });

  it("単発予定は o:{id}", () => {
    expect(oneoffKey("o4")).toBe("o:o4");
  });

  it("キーはオーバーライド適用前の日付で作る", () => {
    const item = recurring({ id: "rh5", day: 31 });
    const original = "2026-08-31";
    const overrides = { [recurringKey("rh5", original)]: { date: "2026-09-14" } };

    const [got] = buildForecast(
      input({ recurring: [item], overrides }),
      "2026-08-01",
      "2026-09-30",
    );

    // 日付は動いても、キーは元の 8/31 のまま
    expect(got.key).toBe("r:rh5:2026-08-31");
    expect(got.date).toBe("2026-09-14");
  });
});

/* ========================= CL-1 手順3 ========================= */

describe("CL-1 単発予定", () => {
  it("そのまま1件になる", () => {
    const item = oneoff({ id: "o2", date: "2026-09-15" });

    const got = buildForecast(
      input({ oneoffs: [item] }),
      "2026-01-01",
      "2026-12-31",
    );

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      key: "o:o2",
      date: "2026-09-15",
      src: "oneoff",
      srcId: "o2",
      amount: 268_000,
      bizRatio: 80,
    });
  });

  it("書式の壊れた日付は投げる", () => {
    const item = oneoff({ id: "o1", date: "2026/09/15" });

    expect(() =>
      buildForecast(input({ oneoffs: [item] }), "2026-01-01", "2026-12-31"),
    ).toThrow(RangeError);
  });
});

/* ========================= CL-1 手順4 ========================= */

describe("CL-1 オーバーライド", () => {
  const item = recurring({ id: "rh5", day: 31, amount: 38_200 });
  const key = "r:rh5:2026-08-31";

  it("skipped なら発生しない", () => {
    const got = buildForecast(
      input({ recurring: [item], overrides: { [key]: { skipped: true } } }),
      "2026-08-01",
      "2026-08-31",
    );

    expect(got).toEqual([]);
  });

  it("date があれば日付を差し替え、元の日付を origDate に残す", () => {
    const got = buildForecast(
      input({
        recurring: [item],
        overrides: { [key]: { date: "2026-09-14", note: "資金繰りの都合で延期" } },
      }),
      "2026-08-01",
      "2026-09-30",
    );

    // 8/31 の回が 9/14 に動き、9/30 の回はそのまま残る
    expect(dates(got)).toEqual(["2026-09-14", "2026-09-30"]);

    const moved = got[0];
    expect(moved.key).toBe(key);
    expect(moved.origDate).toBe("2026-08-31");
    expect(moved.override).toEqual({
      date: "2026-09-14",
      note: "資金繰りの都合で延期",
    });

    // 動いていない回にはオーバーライドが付かない
    expect(got[1].origDate).toBeUndefined();
    expect(got[1].override).toBeUndefined();
  });

  it("amount があれば金額を差し替える", () => {
    const got = buildForecast(
      input({ recurring: [item], overrides: { [key]: { amount: 40_000 } } }),
      "2026-08-01",
      "2026-08-31",
    );

    expect(got[0].amount).toBe(40_000);
  });

  it("金額だけを変えたときは origDate を付けない", () => {
    const got = buildForecast(
      input({ recurring: [item], overrides: { [key]: { amount: 40_000 } } }),
      "2026-08-01",
      "2026-08-31",
    );

    expect(got[0].origDate).toBeUndefined();
    expect(got[0].override).toEqual({ amount: 40_000 });
  });

  it("金額0のオーバーライドも適用される", () => {
    const got = buildForecast(
      input({ recurring: [item], overrides: { [key]: { amount: 0 } } }),
      "2026-08-01",
      "2026-08-31",
    );

    expect(got[0].amount).toBe(0);
  });

  it("日付と金額を同時に変えられる", () => {
    const got = buildForecast(
      input({
        recurring: [item],
        overrides: { [key]: { date: "2026-09-14", amount: 40_000 } },
      }),
      "2026-08-01",
      "2026-09-30",
    );

    expect(got[0]).toMatchObject({
      date: "2026-09-14",
      origDate: "2026-08-31",
      amount: 40_000,
    });
  });

  it("同じ日付への変更では origDate を付けない", () => {
    const got = buildForecast(
      input({ recurring: [item], overrides: { [key]: { date: "2026-08-31" } } }),
      "2026-08-01",
      "2026-08-31",
    );

    expect(got[0].origDate).toBeUndefined();
  });

  it("他の回には影響しない", () => {
    const got = buildForecast(
      input({ recurring: [item], overrides: { [key]: { skipped: true } } }),
      "2026-07-01",
      "2026-09-30",
    );

    expect(dates(got)).toEqual(["2026-07-31", "2026-09-30"]);
  });

  it("単発予定にも適用される", () => {
    const got = buildForecast(
      input({
        oneoffs: [oneoff({ id: "o2", date: "2026-09-15" })],
        overrides: { "o:o2": { date: "2026-10-05" } },
      }),
      "2026-09-01",
      "2026-10-31",
    );

    expect(got[0]).toMatchObject({ date: "2026-10-05", origDate: "2026-09-15" });
  });

  it("書式の壊れたオーバーライド日付は投げる", () => {
    expect(() =>
      buildForecast(
        input({ recurring: [item], overrides: { [key]: { date: "2026-02-30" } } }),
        "2026-08-01",
        "2026-08-31",
      ),
    ).toThrow(RangeError);
  });
});

/* ========================= CL-1 手順5 ========================= */

describe("CL-1 期間の絞り込みと整列", () => {
  it("期間の両端を含む", () => {
    const item = recurring({ id: "r1", day: 15 });

    expect(
      dates(buildForecast(input({ recurring: [item] }), "2026-04-15", "2026-06-15")),
    ).toEqual(["2026-04-15", "2026-05-15", "2026-06-15"]);
  });

  it("期間の外にある回は落とす", () => {
    const item = recurring({ id: "r1", day: 15 });

    expect(
      dates(buildForecast(input({ recurring: [item] }), "2026-04-16", "2026-06-14")),
    ).toEqual(["2026-05-15"]);
  });

  it("オーバーライドで期間外に出た回は落とす", () => {
    const item = recurring({ id: "r1", day: 15 });
    const overrides = { "r:r1:2026-06-15": { date: "2026-07-15" } };

    expect(
      dates(
        buildForecast(
          input({ recurring: [item], overrides }),
          "2026-04-01",
          "2026-06-30",
        ),
      ),
    ).toEqual(["2026-04-15", "2026-05-15"]);
  });

  /**
   * 期間外の回を、オーバーライドで期間内に引き込んだ場合。
   *
   * CL-1 の字面どおり「対象期間の各月について1件生成する」とし、期間の外の月は
   * 生成しない。結果として、7月の回を6月に前倒ししても6月の一覧には現れない。
   *
   * これは意図した挙動である。詳細と却下した案は
   * docs/adr/0008-CL-1は対象期間の月だけを生成する.md を参照。
   */
  it("期間外の回を前倒ししても現れない（ADR-0008）", () => {
    const item = recurring({ id: "r1", day: 15 });
    const overrides = { "r:r1:2026-07-15": { date: "2026-06-20" } };

    expect(
      dates(
        buildForecast(
          input({ recurring: [item], overrides }),
          "2026-06-01",
          "2026-06-30",
        ),
      ),
    ).toEqual(["2026-06-15"]);
  });

  it("日付の昇順に並ぶ", () => {
    const got = buildForecast(
      input({
        recurring: [
          recurring({ id: "r1", day: 27, name: "家賃" }),
          recurring({ id: "r2", day: 5, name: "クラウド" }),
          recurring({ id: "r3", day: 15, name: "食費" }),
        ],
        oneoffs: [oneoff({ id: "o1", date: "2026-04-20" })],
      }),
      "2026-04-01",
      "2026-04-30",
    );

    expect(dates(got)).toEqual([
      "2026-04-05",
      "2026-04-15",
      "2026-04-20",
      "2026-04-27",
    ]);
  });

  it("同じ日付は内容で並ぶ", () => {
    const got = buildForecast(
      input({
        recurring: [
          recurring({ id: "r1", day: 10, name: "サブスク各種" }),
          recurring({ id: "r2", day: 10, name: "クラウド・SaaS" }),
          recurring({ id: "r3", day: 10, name: "広告費" }),
        ],
      }),
      "2026-04-01",
      "2026-04-30",
    );

    expect(got.map((e) => e.name)).toEqual([
      "クラウド・SaaS",
      "サブスク各種",
      "広告費",
    ]);
  });

  it("同じ日付・同じ内容ならキーで並ぶ（順序が入力順に依存しない）", () => {
    const a = recurring({ id: "aaa", day: 10, name: "同名" });
    const b = recurring({ id: "bbb", day: 10, name: "同名" });

    const forward = buildForecast(
      input({ recurring: [a, b] }),
      "2026-04-01",
      "2026-04-30",
    );
    const backward = buildForecast(
      input({ recurring: [b, a] }),
      "2026-04-01",
      "2026-04-30",
    );

    expect(forward.map((e) => e.key)).toEqual(["r:aaa:2026-04-10", "r:bbb:2026-04-10"]);
    expect(backward.map((e) => e.key)).toEqual(forward.map((e) => e.key));
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("入力を書き換えない", () => {
    const items = [recurring({ id: "r1", day: 31 })];
    const oneoffs = [oneoff({ id: "o1", date: "2026-04-20" })];
    const overrides = { "r:r1:2026-04-30": { date: "2026-05-02" } };
    const snapshot = structuredClone({ items, oneoffs, overrides });

    buildForecast(
      input({ recurring: items, oneoffs, overrides }),
      "2026-04-01",
      "2026-05-31",
    );

    expect({ items, oneoffs, overrides }).toEqual(snapshot);
  });

  it("同じ入力なら同じ出力を返す", () => {
    const args: [ForecastInput, string, string] = [
      input({
        recurring: [recurring({ id: "r1", day: 31 })],
        oneoffs: [oneoff({ id: "o1", date: "2026-04-20" })],
      }),
      "2026-01-01",
      "2026-12-31",
    ];

    expect(buildForecast(...args)).toEqual(buildForecast(...args));
  });

  it("予定が無ければ空配列", () => {
    expect(buildForecast(input(), "2026-01-01", "2026-12-31")).toEqual([]);
  });
});
