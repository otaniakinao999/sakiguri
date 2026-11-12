/**
 * AC-69 デビット明細を摘要の出どころとして読む（FR-62）
 *
 * ## 退化させない（CLAUDE.md §2.11）
 *
 * **当たる行だけで測ると、全部差し替える実装と区別が付かない。**
 * だから同じ実行の中で、**当たらない行が変わらないこと**も測る
 * （利用者の指示どおり）。
 *
 * **実データの形を使う。** 2026年10月の銀行明細232行のうち162行が
 * 「デビット　４１２６６９」の形で、店名は別のデビット明細にある。
 * 同日・同額が145件、±3日で157件、残り5件は外貨で
 * **銀行の額 ＝ 明細の額 ＋ 海外事務手数料**（FIGMA 3,134＋78＝3,212）。
 *
 * **店名はラテン文字で書く。** 半角カナでも同じ動きだが、テストの文字列が
 * 読みにくくなるだけで、測っているものは日付と金額の突き合わせである。
 */

import { describe, expect, it } from "vitest";

import {
  buildImportRows,
  countRuleMatches,
  detectColumns,
  parseCsv,
  redecideWithoutRule,
  ruleTargetOf,
  type ImportRow,
} from "../csv";
import type { ImportRule } from "../types";
import {
  applyNameSource,
  buildNameSource,
  type NameSourceEntry,
} from "../name-source";

const ACCOUNT = "bank";

/**
 * 銀行明細。**取引ごとに違う番号**が摘要に入る。
 *
 * | 行 | 当たり方 |
 * |---|---|
 * | 10/20 3,212 | 外貨。明細は 3,134 で、差78円が海外事務手数料 |
 * | 10/21 1,200 | 同日・同額 |
 * | 10/22 4,500 | 明細は 10/24。±3日のずれ |
 * | 10/23 9,999 | **デビット明細に相手がいない** |
 * | 10/24 7,000 | 相手の店名が空（上書きしない） |
 * | 10/25 1,200 | **入金。** 同日・同額の相手がいても当てない |
 */
const BANK = [
  "日付,摘要,出金,入金",
  "2026/10/20,デビット　４１２６６９,3212,",
  "2026/10/21,デビット　５１１１１１,1200,",
  "2026/10/22,デビット　６２２２２２,4500,",
  "2026/10/23,デビット　７３３３３３,9999,",
  "2026/10/24,デビット　８４４４４４,7000,",
  "2026/10/25,ﾌﾘｺﾐ ﾍﾝｷﾝ,,1200",
].join("\n");

const DEBIT = [
  "利用日,利用店名,利用金額",
  "2026/10/20,FIGMA,3134",
  "2026/10/21,SEVEN,1200",
  "2026/10/24,LAWSON,4500",
  "2026/10/24,,7000",
].join("\n");

function bankRows(csv = BANK): ImportRow[] {
  const parsed = parseCsv(csv);
  return buildImportRows({
    rows: parsed,
    mapping: detectColumns(parsed),
    accountId: ACCOUNT,
  });
}

function sourceOf(csv = DEBIT): NameSourceEntry[] {
  const parsed = parseCsv(csv);
  return buildNameSource(parsed, detectColumns(parsed));
}

function applied(bank = BANK, debit = DEBIT): ImportRow[] {
  return applyNameSource(bankRows(bank), sourceOf(debit));
}

const bankAt = (date: string, amount: number) =>
  ["日付,摘要,出金,入金", `${date},デビット　１,${amount},`].join("\n");
const debitAt = (date: string, amount: number) =>
  ["利用日,利用店名,利用金額", `${date},TENMEI,${amount}`].join("\n");

/* ========================= 読み取り ========================= */

describe("AC-69 デビット明細を読む", () => {
  it("日付・金額・店名を読む。空欄の店名の行も落とさない", () => {
    expect(sourceOf()).toEqual([
      { date: "2026-10-20", amount: 3_134, name: "FIGMA" },
      { date: "2026-10-21", amount: 1_200, name: "SEVEN" },
      { date: "2026-10-24", amount: 4_500, name: "LAWSON" },
      /* **落とさない。** 落とすと、この取引に当たるはずだった銀行の行が
         別の店名に当たりうる */
      { date: "2026-10-24", amount: 7_000, name: "" },
    ]);
  });

  it("金額が1列の明細でも読める", () => {
    expect(sourceOf(["利用日,利用店名,金額", "2026/10/20,FIGMA,3134"].join("\n"))).toEqual([
      { date: "2026-10-20", amount: 3_134, name: "FIGMA" },
    ]);
  });
});

/* ========================= 行を増やさない ========================= */

describe("AC-69 行を増やさない", () => {
  it("渡した行と同じ件数・同じ並びで返る", () => {
    const before = bankRows();
    const after = applyNameSource(before, sourceOf());

    expect(after).toHaveLength(before.length);
    expect(after.map((r) => r.rowIndex)).toEqual(before.map((r) => r.rowIndex));
    /* 件数を明示する ―― 0件の配列でも上の2つは通る（§2.11） */
    expect(before).toHaveLength(6);
  });

  it("金額・日付・口座・収支は変わらない（摘要だけ差し替える）", () => {
    const before = bankRows();
    const after = applyNameSource(before, sourceOf());

    expect(after.map((r) => [r.date, r.amount, r.type, r.accountId])).toEqual(
      before.map((r) => [r.date, r.amount, r.type, r.accountId]),
    );
  });
});

/* ========================= 当たり方 ========================= */

describe("AC-69 当たった行と、当たらなかった行", () => {
  it("当たった行は店名になり、当たらなかった行は元のまま", () => {
    const got = applied();

    expect(got[0].name).toBe("FIGMA"); // 外貨。差78円が海外事務手数料
    expect(got[1].name).toBe("SEVEN"); // 同日・同額
    expect(got[2].name).toBe("LAWSON"); // 10/22 の行が 10/24 の明細に（±3日）
    /* **相手がいない。触らない** */
    expect(got[3].name).toBe("デビット　７３３３３３");
    /* **相手の店名が空。上書きしない** */
    expect(got[4].name).toBe("デビット　８４４４４４");
    /* **入金。同日・同額の相手がいても当てない** */
    expect(got[5].name).toBe(got[5].sourceName);
    expect(got[5].type).toBe("income");
  });

  it("差し替えた行と、触らなかった行が同じ実行の中に両方ある", () => {
    const got = applied();
    /* **これが退化の歯止め。** 片方だけだと、全部差し替える実装とも
       何も差し替えない実装とも区別が付かない */
    expect(got.filter((r) => r.nameFrom === "source")).toHaveLength(3);
    expect(got.filter((r) => r.nameFrom === null)).toHaveLength(3);
  });

  it("**原文は触らない**（次回の重複判定が当たるように）", () => {
    const got = applied();
    expect(got.slice(0, 5).map((r) => r.sourceName)).toEqual([
      "デビット　４１２６６９",
      "デビット　５１１１１１",
      "デビット　６２２２２２",
      "デビット　７３３３３３",
      "デビット　８４４４４４",
    ]);
    /* 差し替えた行でも原文が残っていること */
    expect(got[0].name).not.toBe(got[0].sourceName);
  });

  it("出どころが空なら何も変わらない", () => {
    const before = bankRows();
    expect(applyNameSource(before, [])).toEqual(before);
  });
});

/* ========================= 1件ずつ使い切る ========================= */

describe("AC-69 勝手に近いものへ当てない", () => {
  it("相手が1件なら、2行目には当てない", () => {
    const bank = [
      "日付,摘要,出金,入金",
      "2026/10/21,デビット　１,1200,",
      "2026/10/21,デビット　２,1200,",
    ].join("\n");
    const debit = ["利用日,利用店名,利用金額", "2026/10/21,SEVEN,1200"].join("\n");

    expect(applied(bank, debit).map((r) => r.name)).toEqual(["SEVEN", "デビット　２"]);
  });

  it("**違う店名の候補が2つあるときは当てない**", () => {
    const bank = ["日付,摘要,出金,入金", "2026/10/21,デビット　１,1200,"].join("\n");
    const debit = [
      "利用日,利用店名,利用金額",
      "2026/10/21,SEVEN,1200",
      "2026/10/21,LAWSON,1200",
    ].join("\n");

    const got = applied(bank, debit);
    expect(got[0].name).toBe("デビット　１");
    expect(got[0].nameFrom).toBeNull();
  });

  it("同じ店名の候補が2つあるときは当てる（入れ替えても同じ）", () => {
    const bank = ["日付,摘要,出金,入金", "2026/10/21,デビット　１,1200,"].join("\n");
    const debit = [
      "利用日,利用店名,利用金額",
      "2026/10/21,SEVEN,1200",
      "2026/10/21,SEVEN,1200",
    ].join("\n");

    expect(applied(bank, debit)[0].name).toBe("SEVEN");
  });

  /**
   * **入金の行に当てないことを、当てられる相手が居る状態で測る。**
   *
   * `BANK` / `DEBIT` のほうは、入金の行（10/25 1,200）に当たりうる
   * 10/21 の相手が**出金の行に先に使われていた。** 相手が0件なら、
   * 向きを見ない実装でも何も起きないので通る ――
   * CLAUDE.md §2.11 の3つ目の形（対象の行が0件）。
   */
  it("入金の行には当てない（当てられる相手が残っていても）", () => {
    const bank = ["日付,摘要,出金,入金", "2026/10/25,ﾌﾘｺﾐ ﾍﾝｷﾝ,,1200"].join("\n");
    const debit = ["利用日,利用店名,利用金額", "2026/10/25,SEVEN,1200"].join("\n");

    /* **相手が居ることを先に確かめる。** 居なければこの検査は空振りする */
    expect(sourceOf(debit)).toHaveLength(1);

    const got = applied(bank, debit);
    expect(got[0].type).toBe("income");
    expect(got[0].name).toBe(got[0].sourceName);
    expect(got[0].nameFrom).toBeNull();
  });

  it("厳しい当たり方を先に使う（同日同額が、ずれた日より優先）", () => {
    /* 10/21 の行は、同日の SEVEN と 10/22 の LAWSON のどちらにも当たりうる。
       同日のほうを採る ―― そうでないと 10/22 の行の相手が無くなる */
    const bank = [
      "日付,摘要,出金,入金",
      "2026/10/21,デビット　１,1200,",
      "2026/10/22,デビット　２,1200,",
    ].join("\n");
    const debit = [
      "利用日,利用店名,利用金額",
      "2026/10/22,LAWSON,1200",
      "2026/10/21,SEVEN,1200",
    ].join("\n");

    expect(applied(bank, debit).map((r) => r.name)).toEqual(["SEVEN", "LAWSON"]);
  });

  /**
   * **同日・同額と、手数料ぶんの差が競合する場合。**
   *
   * 上の「同日同額が、ずれた日より優先」だけでは、**段の順を入れ替えても
   * 結果が割れない** ―― 入れ替えたときは「違う店名の候補が2つ」になって
   * どちらも当たらず、ゆるい段を飛ばして同じ答えに着く。
   *
   * ここでは**ゆるい段で当たる候補が1つだけ**になるようにしてある。
   * 段の順が逆だと LAWSON が先に当たる。
   */
  it("同日・同額が、手数料ぶんの差より優先", () => {
    const bank = ["日付,摘要,出金,入金", "2026/10/21,デビット　１,1200,"].join("\n");
    const debit = [
      "利用日,利用店名,利用金額",
      /* 1日ずれ・30円差（2.56%）。手数料の帯に入る */
      "2026/10/22,LAWSON,1170",
      /* 同日・同額 */
      "2026/10/21,SEVEN,1200",
    ].join("\n");

    expect(applied(bank, debit)[0].name).toBe("SEVEN");
  });

  it("空欄の店名に当たった行は、ほかの店名にも当て直さない（枠を使う）", () => {
    /* 10/24 の 7,000 は空欄の相手に当たる。±3日の段で 10/26 の店名に
       当て直してはいけない */
    const bank = ["日付,摘要,出金,入金", "2026/10/24,デビット　１,7000,"].join("\n");
    const debit = [
      "利用日,利用店名,利用金額",
      "2026/10/24,,7000",
      "2026/10/26,ATOKARA,7000",
    ].join("\n");

    const got = applied(bank, debit);
    expect(got[0].name).toBe("デビット　１");
    expect(got[0].nameFrom).toBeNull();
  });
});

/* ========================= ずれと手数料の上限 ========================= */

describe("AC-69 ずれと手数料の上限", () => {
  it("日付のずれは3日まで。4日は当たらない", () => {
    expect(
      applied(bankAt("2026/10/24", 1_200), debitAt("2026/10/21", 1_200))[0].name,
    ).toBe("TENMEI");
    expect(
      applied(bankAt("2026/10/25", 1_200), debitAt("2026/10/21", 1_200))[0].name,
    ).toBe("デビット　１");
  });

  it("手数料ぶんの差は、ありうる帯（0.5%〜5%）だけ許す", () => {
    /* 実データ：3,134 → 3,212（78円、2.49%） */
    expect(
      applied(bankAt("2026/10/20", 3_212), debitAt("2026/10/20", 3_134))[0].nameFrom,
    ).toBe("source");
    /* 帯の外（6%）は当てない */
    expect(
      applied(bankAt("2026/10/20", 3_322), debitAt("2026/10/20", 3_134))[0].nameFrom,
    ).toBeNull();
    /* 帯の外（0.1%）も当てない ―― 手数料ではなく別の取引でありうる */
    expect(
      applied(bankAt("2026/10/20", 3_137), debitAt("2026/10/20", 3_134))[0].nameFrom,
    ).toBeNull();
  });

  it("銀行の額が明細より少ないときは当てない（手数料は足される側）", () => {
    expect(
      applied(bankAt("2026/10/20", 3_056), debitAt("2026/10/20", 3_134))[0].nameFrom,
    ).toBeNull();
  });
});

/* ========================= ルールとの関係 ========================= */

/**
 * **摘要を差し替えても、ルールは原文に当たる**（FR-62・CL-10）。
 *
 * 表示名で当てると、差し替わった行にはルールが当たらなくなり、
 * 「このファイルの何行に当たるか」（AC-57e）も実際と違う数になる。
 * `ruleTargetOf` が3箇所の見る値を揃えている（CLAUDE.md §2.8）。
 */
describe("AC-69 摘要を差し替えてもルールは原文に当たる", () => {
  const BANK_ONE = [
    "日付,摘要,出金,入金",
    "2026/10/20,デビット　４１２６６９,3212,",
  ].join("\n");
  const DEBIT_ONE = ["利用日,利用店名,利用金額", "2026/10/20,FIGMA,3134"].join("\n");

  const rule = (pattern: string): ImportRule => ({
    id: "r1",
    pattern,
    accountId: null,
    direction: null,
    categoryCode: "EXP-03",
    costType: "fixed",
    bizRatio: 0,
    replaceName: null,
  });

  it("当たり判定の対象は原文", () => {
    const got = applied(BANK_ONE, DEBIT_ONE);
    expect(got[0].name).toBe("FIGMA");
    expect(ruleTargetOf(got[0]).name).toBe("デビット　４１２６６９");
  });

  it("原文に当たるルールは、差し替え後も当たる数に入る（AC-57e）", () => {
    const got = applied(BANK_ONE, DEBIT_ONE);
    /* **在ること（原文で当たる）と、無いこと（表示名では当たらない）を
       同じ実行で測る。** 片方だけだと、どちらを見ていても通る */
    expect(countRuleMatches(got, rule("デビット"))).toBe(1);
    expect(countRuleMatches(got, rule("FIGMA"))).toBe(0);
  });

  it("「このルールを使わない」で決め直しても、原文で決まる", () => {
    const got = applied(BANK_ONE, DEBIT_ONE);
    const withRule = got.map((row) => ({ ...row, ruleId: "r1" }));
    /* 残すルールは1件。原文に当たるので、決め直しでもその費目になる */
    const after = redecideWithoutRule(withRule, "r1", [rule("デビット　４")]);

    expect(after[0].categoryCode).toBe("EXP-03");
    /* **表示名は差し替わったまま。** 決め直しは費目だけを変える */
    expect(after[0].name).toBe("FIGMA");
    expect(after[0].sourceName).toBe("デビット　４１２６６９");
  });
});
