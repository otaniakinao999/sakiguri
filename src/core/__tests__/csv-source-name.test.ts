/**
 * AC-64 取込時の摘要の原文で重複を判定する（FR-58）
 * AC-65 摘要だけ違う行は「似た行があります」。外さない
 *
 * ## 退化させない（CLAUDE.md §2.11）
 *
 * **往復は「摘要を直した行」を混ぜて測る。** 直していない行だけだと、
 * 原文で判定していなくても（表示名で判定していても）全行が「登録済み」に
 * なって通る ―― 利用者が指示に書いた形そのものである。
 *
 * **実データの形を使う。** 同じ日・同じ額・同じ摘要の行が4つ並ぶ状態は
 * 2026年10月の銀行明細に実在する（232行のうち18行が6組）。
 */

import { describe, expect, it } from "vitest";

import {
  actualFromImportRow,
  buildImportRows,
  detectColumns,
  duplicateKeyOf,
  matchNameOf,
  nearKeyOf,
  parseCsv,
  type ImportRow,
} from "../csv";
import type { Actual } from "../types";

const ACCOUNT = "bank";

function rowsOf(csv: string, existing: readonly Actual[] = []): ImportRow[] {
  const parsed = parseCsv(csv);
  return buildImportRows({
    rows: parsed,
    mapping: detectColumns(parsed),
    accountId: ACCOUNT,
    existing,
  });
}

/** 取り込んで実績にする（本番と同じ変換） */
function importAll(csv: string, existing: readonly Actual[] = []): Actual[] {
  return rowsOf(csv, existing)
    .filter((row) => row.include)
    .map((row, i) => actualFromImportRow(row, `id-${i}`));
}

/**
 * 0009 より前に取り込んだ実績、または手入力の実績（原文を持たない）。
 *
 * **分解で落とさない。** 使わない変数が残り、lint が警告する。
 */
function withoutSourceName(a: Actual): Actual {
  const copy = { ...a };
  delete copy.sourceName;
  return copy;
}

/* ========================= 原文の決め方 ========================= */

describe("AC-64 判定に使う摘要", () => {
  it("原文があれば原文を使う", () => {
    expect(matchNameOf({ name: "㈱ラボル", sourceName: "振込＊カ）ラボル" })).toBe(
      "振込＊カ）ラボル",
    );
  });

  it("原文が無ければ表示名を原文として扱う（既存データを壊さない）", () => {
    expect(matchNameOf({ name: "ｽｰﾊﾟｰ" })).toBe("ｽｰﾊﾟｰ");
    expect(matchNameOf({ name: "ｽｰﾊﾟｰ", sourceName: null })).toBe("ｽｰﾊﾟｰ");
    /* 空白だけの原文も「持たない」と同じ扱い */
    expect(matchNameOf({ name: "ｽｰﾊﾟｰ", sourceName: "   " })).toBe("ｽｰﾊﾟｰ");
  });

  it("鍵は原文で決まる。表示名を変えても同じ鍵", () => {
    const base = {
      accountId: ACCOUNT,
      date: "2026-10-20",
      type: "expense" as const,
      amount: 3_212,
      name: "FIGMA",
      sourceName: "デビット　４１２６６９",
    };
    expect(duplicateKeyOf(base)).toBe(
      duplicateKeyOf({ ...base, name: "まったく別の表示名" }),
    );
    /* **原文を変えれば別の鍵。** 表示名で判定していたら、ここが同じになる */
    expect(duplicateKeyOf(base)).not.toBe(
      duplicateKeyOf({ ...base, sourceName: "デビット　９９９９９９" }),
    );
  });

  it("摘要を外した鍵は4つの値で決まる", () => {
    const base = {
      accountId: ACCOUNT,
      date: "2026-10-20",
      type: "expense" as const,
      amount: 3_212,
    };
    expect(nearKeyOf(base)).toBe(nearKeyOf({ ...base }));
    for (const over of [
      { accountId: "cash" },
      { date: "2026-10-21" },
      { type: "income" as const },
      { amount: 3_213 },
    ]) {
      expect(nearKeyOf({ ...base, ...over })).not.toBe(nearKeyOf(base));
    }
  });
});

/* ========================= 往復 ========================= */

const TRIP = [
  "日付,摘要,出金,入金",
  "2026/10/20,振込＊カ）ラボル,,200000",
  "2026/10/20,デビット　４１２６６９,3212,",
  "2026/10/23,ＡＴＭ手数料,165,",
].join("\n");

describe("AC-64 往復（同じCSVを読み直す）", () => {
  it("取り込んだ実績は原文を持つ", () => {
    const saved = importAll(TRIP);
    expect(saved).toHaveLength(3);
    expect(saved.map((a) => a.sourceName)).toEqual([
      "振込＊カ）ラボル",
      "デビット　４１２６６９",
      "ＡＴＭ手数料",
    ]);
  });

  it("**摘要を直した行を混ぜても、読み直せば全行が登録済みになる**", () => {
    const saved = importAll(TRIP);
    /* 1行目の表示名を直す（実績編集でやること）。原文は触らない */
    const edited = saved.map((a, i) =>
      i === 0 ? { ...a, name: "㈱ラボル" } : a,
    );
    /* **直した行が本当に混ざっていることを先に確かめる。** 直っていなければ
       表示名で判定する実装でも通る（§2.11） */
    expect(edited[0].name).not.toBe(edited[0].sourceName);

    const again = rowsOf(TRIP, edited);
    expect(again.map((r) => r.duplicate)).toEqual([
      "registered",
      "registered",
      "registered",
    ]);
    expect(again.every((r) => !r.include)).toBe(true);
  });

  it("原文を持たない既存の実績でも、摘要を直していなければ当たる", () => {
    /* 0009 より前に取り込んだ実績。`sourceName` が無い */
    const old = importAll(TRIP).map(withoutSourceName);
    expect(old.every((a) => a.sourceName === undefined)).toBe(true);

    expect(rowsOf(TRIP, old).map((r) => r.duplicate)).toEqual([
      "registered",
      "registered",
      "registered",
    ]);
  });

  it("原文を持たない実績の摘要を直すと、登録済みにはならず「似た行」になる", () => {
    /* **ここが AC-64 と AC-65 の継ぎ目。** 原文が無いので判定は表示名で
       行われ、直した行は当たらない。それでも**黙って消えない** ――
       AC-65 が「似た行があります」として出す */
    const old = importAll(TRIP)
      .map(withoutSourceName)
      .map((a, i) => (i === 0 ? { ...a, name: "㈱ラボル" } : a));

    expect(rowsOf(TRIP, old).map((r) => r.duplicate)).toEqual([
      "similar",
      "registered",
      "registered",
    ]);
    /* **外さない。** 外すと、本当に新しい取引だった場合に静かに落ちる */
    expect(rowsOf(TRIP, old)[0].include).toBe(true);
  });

  it("別の口座に同じ日・額・摘要の実績があっても当たらない", () => {
    const elsewhere = importAll(TRIP).map((a) => ({ ...a, accountId: "cash" }));
    expect(rowsOf(TRIP, elsewhere).map((r) => r.duplicate)).toEqual([
      "none",
      "none",
      "none",
    ]);
  });
});

/* ========================= 実データの4つ組 ========================= */

describe("AC-65 同じ日・同じ額・同じ摘要の行が4つ", () => {
  /** 2026年10月の実データにある形（振込手数料 77円 × 4） */
  const FOUR = [
    "日付,摘要,出金,入金",
    "2026/10/30,振込手数料,77,",
    "2026/10/30,振込手数料,77,",
    "2026/10/30,振込手数料,77,",
    "2026/10/30,振込手数料,77,",
  ].join("\n");

  it("3件が登録済みの状態で読むと、残るのは1件だけ", () => {
    const three = importAll(FOUR).slice(0, 3);
    expect(three).toHaveLength(3);

    const got = rowsOf(FOUR, three);
    expect(got.map((r) => r.duplicate)).toEqual([
      "registered",
      "registered",
      "registered",
      "none",
    ]);
    expect(got.filter((r) => r.include)).toHaveLength(1);
  });

  it("4件とも登録済みなら、1件も残らない", () => {
    const got = rowsOf(FOUR, importAll(FOUR));
    expect(got.filter((r) => r.include)).toHaveLength(0);
  });

  it("1件も登録済みでなければ、4件とも入る（似た行にもしない）", () => {
    const got = rowsOf(FOUR);
    expect(got.map((r) => r.duplicate)).toEqual(["none", "none", "none", "none"]);
    expect(got.filter((r) => r.include)).toHaveLength(4);
  });
});

/* ========================= 枠の取り合い ========================= */

describe("AC-65 原文まで一致した行に先に枠を使わせる", () => {
  /**
   * 保存済みは摘要 B の1件。CSVは A・B の2行で、**A が先に来る。**
   *
   * 1行ずつ決めると A が「似た行」の枠を取る。**正しいのは、B が先に
   * 枠を使って A は何も付かないほう** ―― 保存済みの1件は B そのもので
   * あって、A に対応する実績は無い。在りもしない相手について「似た行が
   * あります」と出すと、利用者はその警告を見なくなる。
   */
  const TWO = [
    "日付,摘要,出金,入金",
    "2026/10/20,ＡＴＭ　ローソン,200000,",
    "2026/10/20,ＡＴＭ　セブン銀行,200000,",
  ].join("\n");

  it("先に来た行が「似た行」の枠を取らない", () => {
    /* 2行目（セブン銀行）だけが保存済み */
    const saved = importAll(TWO).slice(1, 2);
    expect(saved[0].sourceName).toBe("ＡＴＭ　セブン銀行");

    expect(rowsOf(TWO, saved).map((r) => r.duplicate)).toEqual([
      "none",
      "registered",
    ]);
  });

  it("保存済みが2件（摘要が両方とも違う）なら、2行とも似た行になる", () => {
    /* 枠が2つあるので両方に相手がいる。**外さない** */
    const saved = importAll(
      [
        "日付,摘要,出金,入金",
        "2026/10/20,ＡＴＭ　ＡＡＡ,200000,",
        "2026/10/20,ＡＴＭ　ＢＢＢ,200000,",
      ].join("\n"),
    );
    const got = rowsOf(TWO, saved);
    expect(got.map((r) => r.duplicate)).toEqual(["similar", "similar"]);
    expect(got.every((r) => r.include)).toBe(true);
  });
});
