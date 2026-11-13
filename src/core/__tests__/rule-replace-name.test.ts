/**
 * AC-66 ルールで摘要を置き換えても、重複判定が壊れない（FR-59）
 *
 * 利用者の要望：「仕訳ルールで**摘要も置き換えたい**。
 * 例：『振込＊カ）ラボル』→『㈱ラボル』」
 *
 * ## 退化させない（CLAUDE.md §2.11）
 *
 * **置き換えた行だけを測ると、置き換えていない行が壊れていても通る。**
 * 同じ実行の中で「置き換わった行」と「当たらなかった行」の両方を見る。
 *
 * **「後から変えても過去の判定が変わらない」は往復で測る。** 置き換えた
 * 状態で取り込み、**ルールを変えてから**同じCSVを読み直す。読み直しの
 * ルールを変えないと、原文を保存していなくても通る。
 */

import { describe, expect, it } from "vitest";

import {
  actualFromImportRow,
  buildImportRows,
  detectColumns,
  parseCsv,
  redecideWithoutRule,
  ruleFromImport,
  type ImportRow,
} from "../csv";
import { applyNameSource, buildNameSource } from "../name-source";
import type { Actual, ImportRule } from "../types";

const ACCOUNT = "bank";

/** 実データの形。1行目にルールが当たり、2行目には当たらない */
const CSV = [
  "日付,摘要,出金,入金",
  "2026/10/20,振込＊カ）ラボル,,200000",
  "2026/10/23,ＡＴＭ手数料,165,",
].join("\n");

function rule(over: Partial<ImportRule> = {}): ImportRule {
  return {
    id: "r1",
    pattern: "カ）ラボル",
    accountId: null,
    direction: null,
    categoryCode: "INC-01",
    costType: null,
    bizRatio: 100,
    replaceName: "㈱ラボル",
    ...over,
  };
}

function rowsOf(
  rules: readonly ImportRule[],
  existing: readonly Actual[] = [],
  csv = CSV,
): ImportRow[] {
  const parsed = parseCsv(csv);
  return buildImportRows({
    rows: parsed,
    mapping: detectColumns(parsed),
    accountId: ACCOUNT,
    rules,
    existing,
  });
}

/* ========================= 置き換え ========================= */

describe("AC-66 ルールで摘要を置き換える", () => {
  it("当たった行の表示名が置き換わり、当たらなかった行は元のまま", () => {
    const got = rowsOf([rule()]);

    expect(got[0].name).toBe("㈱ラボル");
    expect(got[0].nameFrom).toBe("rule");
    /* **当たらなかった行も同じ実行で見る。** 片方だけだと、全部置き換える
       実装とも何も置き換えない実装とも区別が付かない */
    expect(got[1].name).toBe("ＡＴＭ手数料");
    expect(got[1].nameFrom).toBeNull();
  });

  it("**原文は置き換えない**（判定はこちらで行う）", () => {
    const got = rowsOf([rule()]);
    expect(got[0].sourceName).toBe("振込＊カ）ラボル");
    expect(got[0].name).not.toBe(got[0].sourceName);
  });

  it("置き換えが空のルールは、摘要を変えない（費目だけ決める）", () => {
    const got = rowsOf([rule({ replaceName: null })]);
    expect(got[0].name).toBe("振込＊カ）ラボル");
    expect(got[0].nameFrom).toBeNull();
    /* 費目は決まっている ―― ルールそのものは当たっている */
    expect(got[0].categoryCode).toBe("INC-01");
    expect(got[0].ruleId).toBe("r1");
  });

  it("空白だけの置き換えは「置き換えない」と同じ", () => {
    expect(rowsOf([rule({ replaceName: "   " })])[0].name).toBe("振込＊カ）ラボル");
  });

  it("照合が成立した行は置き換えない（予定から引き継ぐ行）", () => {
    const got = rowsOf([rule()], [], CSV);
    /* 予定を渡していないので照合は無い。ここでは「ルールが当たった」ことを
       確かめ、照合がある場合は下の `matchedKey` 付きで見る */
    expect(got[0].matchedKey).toBeNull();

    const withPlan = buildImportRows({
      rows: parseCsv(CSV),
      mapping: detectColumns(parseCsv(CSV)),
      accountId: ACCOUNT,
      rules: [rule()],
      candidates: [
        {
          key: "o:1",
          date: "2026-10-20",
          name: "ラボル 売上",
          type: "income",
          costType: null,
          categoryCode: "INC-01",
          amount: 200_000,
          bizRatio: 100,
          accountId: ACCOUNT,
          src: "oneoff",
          srcId: "o1",
        },
      ],
    });
    expect(withPlan[0].matchedKey).toBe("o:1");
    /* **照合が成立した行ではルールを当てない**（AC-57a の並び）。
       摘要も置き換わらない */
    expect(withPlan[0].name).toBe("振込＊カ）ラボル");
    expect(withPlan[0].nameFrom).toBeNull();
  });

  it("ルールを使わないことにすると、摘要も元に戻る", () => {
    const got = rowsOf([rule()]);
    expect(got[0].name).toBe("㈱ラボル");

    const after = redecideWithoutRule(got, "r1", []);
    expect(after[0].name).toBe("振込＊カ）ラボル");
    expect(after[0].nameFrom).toBeNull();
  });

  it("確認画面から作るルールに置き換えが入る（空なら null）", () => {
    const made = ruleFromImport(
      {
        pattern: "カ）ラボル",
        categoryCode: "INC-01",
        costType: null,
        bizRatio: 100,
        replaceName: " ㈱ラボル ",
      },
      ACCOUNT,
      "new",
    );
    expect(made.replaceName).toBe("㈱ラボル");

    expect(
      ruleFromImport(
        { pattern: "x", categoryCode: "INC-01", costType: null, bizRatio: 0 },
        ACCOUNT,
        "new",
      ).replaceName,
    ).toBeNull();
  });
});

/* ========================= 重複判定が壊れない ========================= */

describe("AC-66 置き換えても重複判定が壊れない", () => {
  it("置き換えた行を取り込み、同じCSVを読み直すと「登録済み」になる", () => {
    const saved = rowsOf([rule()])
      .filter((row) => row.include)
      .map((row, i) => actualFromImportRow(row, `id-${i}`));

    /* 保存されたのは置き換え後の表示名と、置き換え前の原文 */
    expect(saved[0].name).toBe("㈱ラボル");
    expect(saved[0].sourceName).toBe("振込＊カ）ラボル");

    expect(rowsOf([rule()], saved).map((r) => r.duplicate)).toEqual([
      "registered",
      "registered",
    ]);
  });

  /**
   * **置き換えを後から変えても、過去に取り込んだ行の判定は変わらない**
   * （AC-66）。
   *
   * 読み直しのルールを変えずに測ると、**原文を保存していなくても通る**
   * ―― 置き換え後の名前が両方で同じになるので一致してしまう。
   */
  it("置き換えを変えてから読み直しても「登録済み」になる", () => {
    const saved = rowsOf([rule()])
      .filter((row) => row.include)
      .map((row, i) => actualFromImportRow(row, `id-${i}`));

    const changed = rowsOf([rule({ replaceName: "ラボル株式会社" })], saved);

    /* **置き換えが本当に変わっていることを先に確かめる** */
    expect(changed[0].name).toBe("ラボル株式会社");
    expect(saved[0].name).toBe("㈱ラボル");

    expect(changed.map((r) => r.duplicate)).toEqual(["registered", "registered"]);
  });

  it("置き換えをやめてから読み直しても「登録済み」になる", () => {
    const saved = rowsOf([rule()])
      .filter((row) => row.include)
      .map((row, i) => actualFromImportRow(row, `id-${i}`));

    const without = rowsOf([rule({ replaceName: null })], saved);
    expect(without[0].name).toBe("振込＊カ）ラボル");
    expect(without.map((r) => r.duplicate)).toEqual(["registered", "registered"]);
  });
});

/* ========================= 2つがぶつかったとき ========================= */

/**
 * **摘要を書き換える機構が2つある**（CLAUDE.md §2.9）。
 *
 * 同じ行に両方が当たって違う名前を言っているとき、**どちらも入れない。**
 * 表示名は原文のままにして、両方を確認画面に出し、利用者が選ぶ
 * （2026-11-12 の決定）。
 */
describe("AC-66 置き換えとデビット明細がぶつかったら、どちらも入れない", () => {
  const DEBIT_CSV = [
    "日付,摘要,出金,入金",
    "2026/10/20,デビット　４１２６６９,3212,",
  ].join("\n");

  /** 明細の額 3,134 ＋ 海外事務手数料 78 ＝ 銀行の 3,212（AC-69） */
  const sourceOf = (storeName: string) => {
    const csv = parseCsv(
      [
        "利用日,利用店名,利用金額,海外事務手数料",
        `2026/10/20,${storeName},3134,78`,
      ].join("\n"),
    );
    return buildNameSource(csv, detectColumns(csv));
  };

  const debitRule = (replaceName: string | null) =>
    rule({ pattern: "デビット", categoryCode: "EXP-20", bizRatio: 0, replaceName });

  it("違う名前を言っているときは、どちらも入れずに両方を出す", () => {
    const rows = rowsOf([debitRule("デビット利用")], [], DEBIT_CSV);
    expect(rows[0].name).toBe("デビット利用");

    const got = applyNameSource(rows, sourceOf("FIGMA")).rows;

    /* **表示名は原文のまま** */
    expect(got[0].name).toBe("デビット　４１２６６９");
    expect(got[0].nameFrom).toBeNull();
    /* **両方を出す** */
    expect(got[0].nameConflict).toEqual({
      rule: "デビット利用",
      source: "FIGMA",
    });
  });

  it("同じ名前を言っているときはぶつかりではない（どちらを採っても同じ）", () => {
    const rows = rowsOf([debitRule("FIGMA")], [], DEBIT_CSV);
    const got = applyNameSource(rows, sourceOf("FIGMA")).rows;

    expect(got[0].name).toBe("FIGMA");
    expect(got[0].nameConflict).toBeNull();
    expect(got[0].nameFrom).toBe("source");
  });

  it("ルールが置き換えていなければ、明細の店名がそのまま入る", () => {
    const rows = rowsOf([debitRule(null)], [], DEBIT_CSV);
    const got = applyNameSource(rows, sourceOf("FIGMA")).rows;

    expect(got[0].name).toBe("FIGMA");
    expect(got[0].nameFrom).toBe("source");
    expect(got[0].nameConflict).toBeNull();
  });

  it("ぶつかった行でも、原文と重複判定は変わらない", () => {
    const rows = rowsOf([debitRule("デビット利用")], [], DEBIT_CSV);
    const got = applyNameSource(rows, sourceOf("FIGMA")).rows;

    expect(got[0].sourceName).toBe("デビット　４１２６６９");

    const saved = got
      .filter((row) => row.include)
      .map((row, i) => actualFromImportRow(row, `id-${i}`));
    const again = applyNameSource(
      rowsOf([debitRule("デビット利用")], saved, DEBIT_CSV),
      sourceOf("FIGMA"),
    ).rows;
    expect(again[0].duplicate).toBe("registered");
  });

  it("ぶつかった行でルールを使わないことにすると、明細の店名に落ちる", () => {
    const rows = rowsOf([debitRule("デビット利用")], [], DEBIT_CSV);
    const got = applyNameSource(rows, sourceOf("FIGMA")).rows;
    expect(got[0].nameConflict).not.toBeNull();

    const after = redecideWithoutRule(got, "r1", []);
    /* ぶつかった相手がもう居ないので、保留していた店名を使う */
    expect(after[0].name).toBe("FIGMA");
    expect(after[0].nameFrom).toBe("source");
    expect(after[0].nameConflict).toBeNull();
  });
});
