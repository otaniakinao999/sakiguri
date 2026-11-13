/**
 * CL-7 確認画面で行ごとに直せること（固定変動・事業割合）
 *
 * 要件定義書 §3.3 CL-7：
 *
 * > 取込前に全行を一覧表示し、行ごとに **取込可否・収支・固定変動・費目・
 * > 事業割合** を修正できること。
 *
 * **条項が挙げている5つのうち、画面にあったのは取込可否と費目の2つだけ
 * だった**（2026-11-10 に判明）。ここで固定変動と事業割合を足す。
 * **収支はまだ無い** ―― あれは行の中だけで閉じない（照合の取り合いと
 * 重複の2段階を通るので、1行だけ決め直せない。2026-11-13 に申し送り）。
 *
 * ## なぜ急ぐか
 *
 * **事業割合は事業と家計のあいだで金額を動かす。** §3.3 が同じ理由を
 * 書いている ―― 「事業割合が 100 から 0 に変わると、事業と家計の間で
 * 金額が移動する」「合計は合うため、内訳を見ないと気づけない」。
 *
 * ## 「直せること」と「直した値が取り込まれること」は別（§2.7）
 *
 * 画面で編集できても `actualFromImportRow` の先に届いていなければ意味が
 * ない。**同じ実行で両方を測る。**
 */

import { describe, expect, it } from "vitest";

import {
  actualFromImportRow,
  buildImportRows,
  detectColumns,
  editImportRowBizRatio,
  editImportRowCategory,
  editImportRowCostType,
  parseCsv,
  redecideWithoutRule,
  type ImportRow,
} from "../csv";
import type { ImportRule } from "../types";

const ACCOUNT = "a1";

const rule = (
  over: Partial<ImportRule> & Pick<ImportRule, "id" | "pattern" | "categoryCode">,
): ImportRule => ({
  accountId: null,
  direction: null,
  costType: "variable",
  bizRatio: 0,
  replaceName: null,
  ...over,
});

/**
 * **出金と入金を1行ずつ。** 固定変動を持つ行（費用）と持たない行（収入）を
 * 同じデータに入れる ―― 片方だけだと、「どの行でも直せる実装」と
 * 「どの行でも直せない実装」のどちらとも区別が付かない（§2.11）。
 */
const CSV = [
  "日付,摘要,入金,出金",
  "2026/10/01,ﾃﾞﾝｷﾀﾞｲ,,5000",
  "2026/10/02,ｳﾘｱｹﾞ ﾆｭｳｷﾝ,30000,",
].join("\n");

function built(rules: ImportRule[] = []): ImportRow[] {
  const parsed = parseCsv(CSV);
  return buildImportRows({
    rows: parsed,
    mapping: detectColumns(parsed),
    accountId: ACCOUNT,
    rules,
  });
}

describe("CL-7 固定変動を行ごとに直せる", () => {
  it("費用の行は直せる。収入の行は直らない（在ること・無いこと）", () => {
    const [expense, income] = built();

    /* **在ること。** 費用の行は固定／変動を持つ */
    expect(expense.type).toBe("expense");
    expect(expense.costType).not.toBeNull();
    expect(editImportRowCostType(expense, "fixed").costType).toBe("fixed");
    expect(editImportRowCostType(expense, "variable").costType).toBe("variable");

    /* **無いこと。** 収入には固定／変動が無い（適用規則6）。
       画面でも欄を出さないが、ここでも落とす ―― 条件が2箇所にあると、
       画面から入らない値が入る（§2.8） */
    expect(income.type).toBe("income");
    expect(income.costType).toBeNull();
    expect(editImportRowCostType(income, "fixed")).toBe(income);

    /* 資金移動も同じ（費目を変えてから試す） */
    const transfer = editImportRowCategory(expense, "TRF-01");
    expect(transfer.costType).toBeNull();
    expect(editImportRowCostType(transfer, "fixed")).toBe(transfer);
  });

  it("直した値が実績に届く", () => {
    const edited = editImportRowCostType(built()[0], "fixed");
    expect(actualFromImportRow(edited, "id-1").costType).toBe("fixed");
  });
});

describe("CL-7 事業割合を行ごとに直せる", () => {
  it("0〜100 の整数に収める", () => {
    const row = built()[0];
    expect(editImportRowBizRatio(row, 40).bizRatio).toBe(40);
    expect(editImportRowBizRatio(row, 0).bizRatio).toBe(0);
    expect(editImportRowBizRatio(row, 100).bizRatio).toBe(100);

    /* 範囲の外と小数（§2.1 金額・割合は整数） */
    expect(editImportRowBizRatio(row, 140).bizRatio).toBe(100);
    expect(editImportRowBizRatio(row, -20).bizRatio).toBe(0);
    expect(editImportRowBizRatio(row, 33.4).bizRatio).toBe(33);
  });

  it("資金移動は事業割合を持たない（無いこと）", () => {
    const transfer = editImportRowCategory(built()[0], "TRF-01");
    expect(transfer.bizRatio).toBe(0);
    expect(editImportRowBizRatio(transfer, 80)).toBe(transfer);

    /* **在ることを同じ実行で。** 費用の行では同じ呼び出しが効く */
    expect(editImportRowBizRatio(built()[0], 80).bizRatio).toBe(80);
  });

  it("直した値が実績に届く", () => {
    const edited = editImportRowBizRatio(built()[0], 40);
    expect(actualFromImportRow(edited, "id-1").bizRatio).toBe(40);

    /* **元の値と違うこと。** 既定と同じ値で測ると、編集を捨てる実装でも
       通る（§2.11 の4つ目の形） */
    expect(built()[0].bizRatio).not.toBe(40);
  });
});

describe("CL-7 手で直した行は、ルールの決め直しで巻き戻らない（AC-57b）", () => {
  const RULES = [
    rule({ id: "r1", pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-02", costType: "fixed", bizRatio: 100 }),
  ];

  it("固定変動を直すと、ルールの印が外れる", () => {
    const rows = built(RULES);
    expect(rows[0].ruleId).toBe("r1");
    expect(rows[0].costType).toBe("fixed");

    const edited = editImportRowCostType(rows[0], "variable");
    expect(edited.ruleId).toBeNull();
    expect(edited.rulePattern).toBeNull();
    expect(edited.guessedFrom).toBeNull();

    /* 「このルールを使わない」で決め直しても、手で直した値が残る */
    const after = redecideWithoutRule([edited], "r1", []);
    expect(after[0].costType).toBe("variable");
  });

  it("事業割合を直すと、ルールの印が外れる", () => {
    const rows = built(RULES);
    expect(rows[0].ruleId).toBe("r1");
    expect(rows[0].bizRatio).toBe(100);

    const edited = editImportRowBizRatio(rows[0], 40);
    expect(edited.ruleId).toBeNull();

    const after = redecideWithoutRule([edited], "r1", []);
    expect(after[0].bizRatio).toBe(40);

    /* **在ることを同じ実行で。** 直していない行は決め直される ――
       どの行も巻き戻さない実装と区別する（§2.11） */
    const untouched = redecideWithoutRule(rows, "r1", []);
    expect(untouched[0].bizRatio).not.toBe(100);
  });
});
