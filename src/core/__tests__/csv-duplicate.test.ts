import { describe, expect, it } from "vitest";

import { buildImportRows, duplicateKeyOf, parseCsv, type ColumnMapping } from "../csv";
import type { Actual } from "../types";

/**
 * FR-50 CSV取込の重複検出。
 *
 * **外す側に倒す。** 同じ日に同じ額の取引が2件あるのは普通のことなので、
 * ゆるく当てると**本物のデータが消える。** 取りこぼしは「外し忘れた行が
 * 1つ混じる」で済む。
 */

const mapping = (over: Partial<ColumnMapping> = {}): ColumnMapping => ({
  date: 0,
  name: 1,
  inflow: 2,
  outflow: 3,
  amount: -1,
  sign: "outMinus",
  hasHeader: true,
  ...over,
});

function actual(over: Partial<Actual> & Pick<Actual, "id">): Actual {
  return {
    key: null,
    date: "2026-04-25",
    name: "ｽｰﾊﾟｰ",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 4820,
    bizRatio: 0,
    accountId: "a1",
    ...over,
  };
}

/** 1行のCSV。摘要と金額を変えられる */
const csv = (lines: Array<[string, string, string]>) =>
  parseCsv(
    ["日付,摘要,入金,出金", ...lines.map(([d, n, out]) => `${d},${n},,${out}`)].join("\n"),
  );

const ONE = csv([["2026/04/25", "ｽｰﾊﾟｰ", "4820"]]);

describe("FR-50 既に保存されている実績との突き合わせ", () => {
  it("**`existing` を渡さなければ、これまでどおり全部取り込む**", () => {
    /* 既存の呼び出しが変わらないことを固定する */
    const got = buildImportRows({ rows: ONE, mapping: mapping(), accountId: "a1" });

    expect(got.map((r) => [r.alreadyRegistered, r.include])).toEqual([[false, true]]);
  });

  it("同じ行が既に保存されていれば、印が付いて既定で外れる", () => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x" })],
    });

    expect(got.map((r) => [r.alreadyRegistered, r.include])).toEqual([[true, false]]);
  });

  it("保存されていなければ印は付かない", () => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x", date: "2026-04-26" })],
    });

    expect(got.map((r) => [r.alreadyRegistered, r.include])).toEqual([[false, true]]);
  });
});

describe("FR-50 個数を合わせる", () => {
  const TWO_SAME = csv([
    ["2026/04/25", "ｽｰﾊﾟｰ", "4820"],
    ["2026/04/25", "ｽｰﾊﾟｰ", "4820"],
  ]);

  it("**同じファイルの中の同一行どうしは当てない**（実在の2件）", () => {
    /* 明細に同じ行が2つ並ぶのは、同じ店で2回買ったということ */
    const got = buildImportRows({ rows: TWO_SAME, mapping: mapping(), accountId: "a1" });

    expect(got.map((r) => r.alreadyRegistered)).toEqual([false, false]);
  });

  it("**保存済み1件・CSV2件なら、1件だけ外して1件は通す**", () => {
    /* 「キーがあるか」で見ると2件とも外れ、**新しい取引が落ちる** */
    const got = buildImportRows({
      rows: TWO_SAME,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x" })],
    });

    expect(got.map((r) => r.alreadyRegistered)).toEqual([true, false]);
    expect(got.map((r) => r.include)).toEqual([false, true]);
  });

  it("保存済み2件・CSV2件なら両方とも外れる", () => {
    const got = buildImportRows({
      rows: TWO_SAME,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x" }), actual({ id: "y" })],
    });

    expect(got.map((r) => r.alreadyRegistered)).toEqual([true, true]);
  });

  it("保存済み2件・CSV1件でも、外れるのは1件ぶん", () => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x" }), actual({ id: "y" })],
    });

    expect(got.map((r) => r.alreadyRegistered)).toEqual([true]);
  });
});

describe("FR-50 一致の厳しさ", () => {
  const cases: Array<[string, Partial<Actual>]> = [
    ["口座が違う", { accountId: "a2" }],
    ["日付が違う", { date: "2026-04-26" }],
    ["金額が違う", { amount: 4821 }],
    ["摘要が違う", { name: "ｺﾝﾋﾞﾆ" }],
    ["収支が違う", { type: "income", costType: null }],
  ];

  it.each(cases)("%s だけで当てない", (_label, over) => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x", ...over })],
    });

    expect(got[0].alreadyRegistered).toBe(false);
    expect(got[0].include).toBe(true);
  });

  it("**同じ日・同じ額でも、摘要が違えばどれも当たらない**", () => {
    /* **保存済みの摘要を、CSVのどの行とも違うものにする。**
       保存済みを `ｺﾝﾋﾞﾆA`、CSVを A と B にすると、摘要を見ない実装でも
       「1件ぶん消費して [true, false]」になり、**厳しさの差が出ない**
       （最初に書いたテストがそれだった）。どちらとも違う `ｺﾝﾋﾞﾆC` なら、
       厳しければ0件、ゆるければ1件が外れて**本物の取引が落ちる** */
    const rows = csv([
      ["2026/04/25", "ｺﾝﾋﾞﾆA", "500"],
      ["2026/04/25", "ｺﾝﾋﾞﾆB", "500"],
    ]);

    const got = buildImportRows({
      rows,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x", name: "ｺﾝﾋﾞﾆC", amount: 500 })],
    });

    expect(got.map((r) => [r.name, r.alreadyRegistered])).toEqual([
      ["ｺﾝﾋﾞﾆA", false],
      ["ｺﾝﾋﾞﾆB", false],
    ]);
    expect(got.every((r) => r.include)).toBe(true);
  });

  it("ほかの口座の実績は数えない", () => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x", accountId: "a2" }), actual({ id: "y" })],
    });

    /* a2 のぶんは数えないので、消費できるのは a1 の1件だけ */
    expect(got[0].alreadyRegistered).toBe(true);
  });
});

describe("FR-50 照合とは別の軸", () => {
  it("重複の行でも照合の結果は出る", () => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      existing: [actual({ id: "x" })],
    });

    expect(got[0].alreadyRegistered).toBe(true);
    /* 予定を渡していないので候補なし。重複印に引きずられない */
    expect(got[0].matchHint).toBe("noCandidate");
  });

  it("照合できた行でも、重複でなければ外さない", () => {
    const got = buildImportRows({
      rows: ONE,
      mapping: mapping(),
      accountId: "a1",
      candidates: [
        {
          key: "p1",
          date: "2026-04-25",
          name: "食費",
          type: "expense",
          costType: "variable",
          categoryCode: "EXP-21",
          amount: 4820,
          bizRatio: 0,
          accountId: "a1",
          src: "recurring",
          srcId: "r1",
        },
      ],
    });

    expect(got[0].matchHint).toBe("matched");
    expect(got[0].alreadyRegistered).toBe(false);
    expect(got[0].include).toBe(true);
  });
});

describe("duplicateKeyOf", () => {
  it("5つの値が全部同じときだけ同じキーになる", () => {
    const base = {
      accountId: "a1",
      date: "2026-04-25",
      type: "expense" as const,
      amount: 4820,
      name: "ｽｰﾊﾟｰ",
    };

    expect(duplicateKeyOf(base)).toBe(duplicateKeyOf({ ...base }));
    expect(duplicateKeyOf(base)).not.toBe(duplicateKeyOf({ ...base, amount: 4821 }));
    expect(duplicateKeyOf(base)).not.toBe(duplicateKeyOf({ ...base, name: "ｽｰﾊﾟｰ " }));
  });

  it("**値の切れ目が曖昧にならない**", () => {
    /* 区切りを素直な文字（`|` など）にすると、摘要に その文字が入った
       ときに別の組み合わせと同じキーになりうる */
    const a = duplicateKeyOf({
      accountId: "a1",
      date: "2026-04-25",
      type: "expense",
      amount: 48,
      name: "20ｽｰﾊﾟｰ",
    });
    const b = duplicateKeyOf({
      accountId: "a1",
      date: "2026-04-25",
      type: "expense",
      amount: 4820,
      name: "ｽｰﾊﾟｰ",
    });

    expect(a).not.toBe(b);
  });
});
