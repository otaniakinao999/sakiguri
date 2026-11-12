import { describe, expect, it } from "vitest";

import {
  buildImportRows,
  classifyImportRow,
  countRuleMatches,
  detectColumns,
  editImportRowCategory,
  effectiveDirection,
  parseCsv,
  pickRule,
  redecideWithoutRule,
  ruleConflict,
  ruleFromImport,
  ruleMatches,
  type HistoryEntry,
  type ImportRow,
} from "../csv";
import type { ImportRule } from "../types";
import { addRule } from "@/lib/mutations";
import { emptyAppData } from "@/lib/app-data";

/**
 * CL-10 仕分けルールの適用（FR-18・AC-57〜57e）
 *
 * **試験データは、空振りしない形に組んである**（CLAUDE.md §2.11）。
 *
 * | 条項 | 空振りする形 | ここで使う形 |
 * |---|---|---|
 * | 長い `pattern` が勝つ | 長さの同じルール2つ | **長さの違う2つ**。短いほうを配列の先に置く |
 * | ルールが推定に勝つ | ルールだけ当たる行 | **両方が当たる行**。推定だけだと別の費目になることを同じ行で見る |
 * | 何行に当たるか | 1行だけ当たるデータ | **2行以上**。1行だと数え方が違っても 1 と出る |
 * | 使わないとき巻き戻さない | その行だけ見る | **ほかの行を手で直してから**使わないにする |
 */

const ACCOUNT = "a1";

const rule = (over: Partial<ImportRule> & Pick<ImportRule, "id" | "pattern" | "categoryCode">): ImportRule => ({
  accountId: null,
  direction: null,
  costType: "variable",
  bizRatio: 0,
  ...over,
});

const target = (name: string, type: "income" | "expense" = "expense") => ({
  name,
  type,
  accountId: ACCOUNT,
});

/* ========================= AC-57 当たりと勝ち負け ========================= */

describe("AC-57 ルールが当たった行の値", () => {
  it("費目・固定変動・事業割合がルールの値になり、収支は変わらない", () => {
    const rules = [
      rule({
        id: "r1",
        pattern: "ﾃﾞﾝｷ",
        categoryCode: "EXP-05",
        costType: "fixed",
        bizRatio: 40,
      }),
    ];
    const got = classifyImportRow(target("ﾃﾞﾝｷﾀﾞｲ ９月分"), { rules });
    expect(got).toMatchObject({
      categoryCode: "EXP-05",
      costType: "fixed",
      bizRatio: 40,
      ruleId: "r1",
      rulePattern: "ﾃﾞﾝｷ",
    });
  });

  it("**長い `pattern` が勝つ**。短いほうを先に置いても負けない", () => {
    /* 長さ 5 と 10。先頭勝ちの実装なら EXP-20 になる */
    const rules = [
      rule({ id: "r-short", pattern: "ｱﾏｿﾞﾝ", categoryCode: "EXP-20" }),
      rule({ id: "r-long", pattern: "ｱﾏｿﾞﾝｳｴﾌﾞｻ", categoryCode: "EXP-07" }),
    ];
    const row = target("ｱﾏｿﾞﾝｳｴﾌﾞｻ-ﾋﾞｽ ﾘﾖｳｷﾝ");

    expect(pickRule(rules, row)?.id).toBe("r-long");
    /* 逆順でも同じ。配列の順序で決まっていないこと */
    expect(pickRule([...rules].reverse(), row)?.id).toBe("r-long");
    expect(classifyImportRow(row, { rules }).categoryCode).toBe("EXP-07");
  });

  it("長さが同じなら `id` の昇順で決まる", () => {
    const rules = [
      rule({ id: "r-b", pattern: "ｺｰﾋ", categoryCode: "EXP-20" }),
      rule({ id: "r-a", pattern: "ｶﾌｪ", categoryCode: "EXP-13" }),
    ];
    /* **両方が当たる行**。片方しか当たらないと順序を試せない */
    const row = target("ｶﾌｪ ｺｰﾋ ﾀﾞｲ");
    expect(pickRule(rules, row)?.id).toBe("r-a");
    expect(pickRule([...rules].reverse(), row)?.id).toBe("r-a");
  });

  it("長さはコードポイントで数える（サロゲートペアを2つ数えない）", () => {
    const rules = [
      rule({ id: "r1", pattern: "🍎🍎", categoryCode: "EXP-20" }), // 2
      rule({ id: "r2", pattern: "ｱｲｳ", categoryCode: "EXP-13" }), // 3
    ];
    expect(pickRule(rules, target("🍎🍎 ｱｲｳ"))?.id).toBe("r2");
  });

  it("空の `pattern` はどの行にも当たらない", () => {
    /* `"".includes()` は常に true。全行に当たるルールを作らせない */
    expect(ruleMatches(rule({ id: "r1", pattern: "", categoryCode: "EXP-20" }), target("なんでも"))).toBe(false);
    expect(ruleMatches(rule({ id: "r1", pattern: "  ", categoryCode: "EXP-20" }), target("  "))).toBe(false);
  });
});

/* ===================== AC-57a ルールが推定に勝つ ===================== */

describe("AC-57a ルールが履歴からの費目推定に勝つ", () => {
  /** `historyKeyOf` は括弧を除いた先頭4文字。`ﾂｳｼﾝ` が当たる */
  const history: HistoryEntry[] = [
    { name: "ﾂｳｼﾝﾋ ９月", categoryCode: "EXP-06", costType: "fixed", bizRatio: 80 },
  ];
  const row = target("ﾂｳｼﾝﾋ ﾘﾖｳｷﾝ 10ｶﾞﾂ");
  const rules = [rule({ id: "r1", pattern: "ﾂｳｼﾝ", categoryCode: "EXP-11", bizRatio: 20 })];

  it("**推定だけなら別の費目になる行**で測っている", () => {
    /* これが通らないと、下の「ルールが勝つ」は何も測っていない
       （推定を消しても同じ結果になる。§2.11 の4つ目の形） */
    const withoutRules = classifyImportRow(row, { history });
    expect(withoutRules.categoryCode).toBe("EXP-06");
    expect(withoutRules.guessedFrom).toBe("ﾂｳｼﾝﾋ ９月");
  });

  it("ルールが当たる行では、ルールの費目になる", () => {
    const got = classifyImportRow(row, { rules, history });
    expect(got.categoryCode).toBe("EXP-11");
    expect(got.bizRatio).toBe(20);
    expect(got.ruleId).toBe("r1");
    /* **推定は当てない。** 両方を立てると、画面がどちらで決まったか言えない */
    expect(got.guessedFrom).toBeNull();
  });

  it("ルールが当たらなかった行では、推定が従来どおり働く", () => {
    const other = target("ｶﾞｽﾘﾖｳｷﾝ 10ｶﾞﾂ");
    const got = classifyImportRow(other, { rules, history });
    expect(got.ruleId).toBeNull();
    expect(got.categoryCode).toBe("EXP-20"); // 受け皿（推定も当たらない）
  });

  it("照合が成立した行は、ルールより照合先が勝つ", () => {
    const got = classifyImportRow(row, {
      matched: { categoryCode: "EXP-01", costType: "fixed", bizRatio: 100 },
      rules,
      history,
    });
    expect(got.categoryCode).toBe("EXP-01");
    expect(got.ruleId).toBeNull();
  });
});

/* ============== AC-57b 使わないとき、ほかの行を巻き戻さない ============== */

describe("AC-57b このルールを使わない", () => {
  const history: HistoryEntry[] = [
    { name: "ﾔﾁﾝ ９月", categoryCode: "EXP-01", costType: "fixed", bizRatio: 100 },
  ];
  const rules = [
    rule({ id: "R", pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-05", bizRatio: 10 }),
    rule({ id: "S", pattern: "ｶﾞｽ", categoryCode: "EXP-05", bizRatio: 30 }),
  ];

  /** R で決まった2行、S で決まった1行、R で決まったあと手で直した1行 */
  function rows(): ImportRow[] {
    const csv = [
      "日付,摘要,入金,出金",
      "2026/10/01,ﾃﾞﾝｷﾀﾞｲ 10ｶﾞﾂ,,5000",
      "2026/10/02,ﾃﾞﾝｷﾀﾞｲ ﾖﾊﾟｰﾄ,,3000",
      "2026/10/03,ｶﾞｽﾀﾞｲ,,2000",
      "2026/10/04,ﾔﾁﾝ 10ｶﾞﾂ,,90000",
    ].join("\n");
    const parsed = parseCsv(csv);
    const built = buildImportRows({
      rows: parsed,
      mapping: detectColumns(parsed),
      accountId: ACCOUNT,
      history,
      rules,
    });
    /* 2行目を手で直す。**取込のチェックも外す**（FR-50 が外した状態の代わり） */
    return built.map((r, i) =>
      i === 1 ? { ...editImportRowCategory(r, "EXP-13"), include: false } : r,
    );
  }

  it("組んだデータが、条項を破りうる形になっている", () => {
    const before = rows();
    expect(before[0].ruleId).toBe("R");
    expect(before[1].ruleId).toBeNull(); // 手で直した
    expect(before[1].categoryCode).toBe("EXP-13");
    expect(before[2].ruleId).toBe("S");
    expect(before[3].ruleId).toBeNull();
    expect(before[3].guessedFrom).toBe("ﾔﾁﾝ ９月"); // 推定で決まった行
  });

  it("そのルールで決まっていた行だけが決め直される", () => {
    const before = rows();
    const after = redecideWithoutRule(before, "R", rules.filter((r) => r.id !== "R"), history);

    /* 決め直された行：ルールが無かったものとして扱う */
    expect(after[0].ruleId).toBeNull();
    expect(after[0].categoryCode).toBe("EXP-20"); // 推定も当たらないので受け皿
  });

  it("**手で直した費目が保たれる**", () => {
    const after = redecideWithoutRule(rows(), "R", [rules[1]], history);
    expect(after[1].categoryCode).toBe("EXP-13");
    expect(after[1].include).toBe(false);
  });

  it("**ほかのルールで決まった行と、推定で決まった行は同じ参照で返る**", () => {
    /* 作り直す実装だと、ここが別オブジェクトになる（値は同じでも）。
       値だけ見ると「推定に落ちた」実装でも通ってしまう */
    const before = rows();
    const after = redecideWithoutRule(before, "R", [rules[1]], history);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
    expect(after[1]).toBe(before[1]);
  });

  it("外したルールが隠していた、短いルールが当たるようになる", () => {
    const both = [
      rule({ id: "long", pattern: "ﾃﾞﾝｷﾀﾞｲ", categoryCode: "EXP-05" }),
      rule({ id: "short", pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-20" }),
    ];
    const parsed = parseCsv("日付,摘要,入金,出金\n2026/10/01,ﾃﾞﾝｷﾀﾞｲ 10ｶﾞﾂ,,5000");
    const built = buildImportRows({
      rows: parsed,
      mapping: detectColumns(parsed),
      accountId: ACCOUNT,
      rules: both,
    });
    expect(built[0].ruleId).toBe("long");

    const after = redecideWithoutRule(built, "long", [both[1]]);
    expect(after[0].ruleId).toBe("short");
    expect(after[0].categoryCode).toBe("EXP-20");
  });
});

/* ===================== AC-57d 符号と費目グループ ===================== */

describe("AC-57d 符号と矛盾する組み合わせ", () => {
  it("INC / EXP の費目のルールは、その符号の行にだけ当たる", () => {
    const income = rule({ id: "i", pattern: "ｳﾝﾃﾞﾝ", categoryCode: "INC-01", costType: null });
    const expense = rule({ id: "e", pattern: "ｳﾝﾃﾞﾝ", categoryCode: "EXP-13" });

    /* `direction` は null。それでも向きが効く（費目から導く） */
    expect(effectiveDirection(income)).toBe("in");
    expect(effectiveDirection(expense)).toBe("out");
    expect(ruleMatches(income, target("ｳﾝﾃﾞﾝ ﾆｭｳｷﾝ", "income"))).toBe(true);
    expect(ruleMatches(income, target("ｳﾝﾃﾞﾝ ｼﾊﾗｲ", "expense"))).toBe(false);
    expect(ruleMatches(expense, target("ｳﾝﾃﾞﾝ ﾆｭｳｷﾝ", "income"))).toBe(false);
  });

  it("資金移動の費目は、`direction` が null なら両方に当たる", () => {
    /* 振替を両側の明細から記録するため（ADR-0025） */
    const trf = rule({ id: "t", pattern: "ﾌﾘｶｴ", categoryCode: "TRF-01", costType: null });
    expect(effectiveDirection(trf)).toBeNull();
    expect(ruleMatches(trf, target("ﾌﾘｶｴ", "income"))).toBe(true);
    expect(ruleMatches(trf, target("ﾌﾘｶｴ", "expense"))).toBe(true);

    const out = { ...trf, direction: "out" as const };
    expect(ruleMatches(out, target("ﾌﾘｶｴ", "income"))).toBe(false);
    expect(ruleMatches(out, target("ﾌﾘｶｴ", "expense"))).toBe(true);
  });

  it("矛盾する組み合わせは理由付きで弾かれる", () => {
    expect(
      ruleConflict({ pattern: "ｱ", accountId: null, direction: "in", categoryCode: "EXP-13", bizRatio: 0 }),
    ).toMatch(/支出の費目/);
    expect(
      ruleConflict({ pattern: "ｱ", accountId: null, direction: "out", categoryCode: "INC-01", bizRatio: 0 }),
    ).toMatch(/収入の費目/);
    expect(
      ruleConflict({ pattern: "", accountId: null, direction: null, categoryCode: "EXP-13", bizRatio: 0 }),
    ).toMatch(/摘要/);
    expect(
      ruleConflict({ pattern: "ｱ", accountId: null, direction: null, categoryCode: "TRF-01", bizRatio: 50 }),
    ).toMatch(/事業割合/);
    expect(
      ruleConflict({ pattern: "ｱ", accountId: null, direction: null, categoryCode: "EXP-13", bizRatio: 50 }),
    ).toBeNull();
  });

  it("口座を指定したルールは、その口座のCSVにだけ当たる", () => {
    const only = rule({ id: "r", pattern: "ｱ", categoryCode: "EXP-13", accountId: "a2" });
    expect(ruleMatches(only, target("ｱ"))).toBe(false);
    expect(ruleMatches(only, { ...target("ｱ"), accountId: "a2" })).toBe(true);
  });
});

/* ================== AC-57e 何行に当たるかを出す ================== */

describe("AC-57e 縮めた `pattern` が何行に当たるか", () => {
  const csv = [
    "日付,摘要,入金,出金",
    "2026/10/01,ﾃﾞﾝｷﾀﾞｲ 10ｶﾞﾂ,,5000",
    "2026/10/02,ﾃﾞﾝｷﾀﾞｲ 11ｶﾞﾂ,,5200",
    "2026/10/03,ﾃﾞﾝﾄﾞｳ ｼﾔ,,180000",
    "2026/10/04,ｶﾞｽﾀﾞｲ,,2000",
  ].join("\n");

  const built = (): ImportRow[] => {
    const parsed = parseCsv(csv);
    return buildImportRows({
      rows: parsed,
      mapping: detectColumns(parsed),
      accountId: ACCOUNT,
    });
  };

  const count = (pattern: string) =>
    countRuleMatches(built(), {
      pattern,
      accountId: null,
      direction: null,
      categoryCode: "EXP-05",
    });

  it("**2行以上当たるデータで測っている**", () => {
    /* 1行だけ当たるデータだと、数え方が違っても 1 と出る */
    expect(count("ﾃﾞﾝｷﾀﾞｲ")).toBe(2);
  });

  it("広い `pattern` ほど多く当たる", () => {
    expect(count("ﾃﾞﾝ")).toBe(3);
    expect(count("ﾃﾞﾝｷﾀﾞｲ 10ｶﾞﾂ")).toBe(1);
    expect(count("ｱﾄﾞｶﾞﾜ")).toBe(0);
  });

  it("照合が成立した行は数えない", () => {
    /* ルールはその行に当たらないので、数に入れると「当たる」と言いながら
       使われないことになる */
    const rows = built().map((r, i) =>
      i === 0 ? { ...r, matchedKey: "r:x:2026-10-01", matchedName: "電気代" } : r,
    );
    expect(
      countRuleMatches(rows, {
        pattern: "ﾃﾞﾝｷﾀﾞｲ",
        accountId: null,
        direction: null,
        categoryCode: "EXP-05",
      }),
    ).toBe(1);
  });

  it("既に登録済みの行は数える（画面には費目が出る）", () => {
    const rows = built().map((r, i) =>
      i === 0 ? { ...r, duplicate: "registered" as const, include: false } : r,
    );
    expect(
      countRuleMatches(rows, {
        pattern: "ﾃﾞﾝｷﾀﾞｲ",
        accountId: null,
        direction: null,
        categoryCode: "EXP-05",
      }),
    ).toBe(2);
  });

  it("数えるのと当てるのは同じ判定を通る（収入の費目は出金の行を数えない）", () => {
    expect(
      countRuleMatches(built(), {
        pattern: "ﾃﾞﾝｷﾀﾞｲ",
        accountId: null,
        direction: null,
        categoryCode: "INC-01",
      }),
    ).toBe(0);
  });
});

/* ============ 手で直したときに、ルールの印が外れる（AC-57a・b） ============ */

describe("費目を手で直した行", () => {
  it("ルールの印と推定の印の両方が外れ、固定変動が費目に合う", () => {
    const parsed = parseCsv("日付,摘要,入金,出金\n2026/10/01,ﾃﾞﾝｷﾀﾞｲ,,5000");
    const built = buildImportRows({
      rows: parsed,
      mapping: detectColumns(parsed),
      accountId: ACCOUNT,
      rules: [rule({ id: "r1", pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-05", costType: "fixed" })],
    });
    expect(built[0].ruleId).toBe("r1");
    expect(built[0].costType).toBe("fixed");

    const edited = editImportRowCategory(built[0], "TRF-01");
    expect(edited.ruleId).toBeNull();
    expect(edited.rulePattern).toBeNull();
    expect(edited.guessedFrom).toBeNull();
    /* 資金移動は固定変動を持たない（適用規則6） */
    expect(edited.costType).toBeNull();
  });
});

/* ============ AC-57 同じ長さのときの決め方（判断1：長さが先） ============ */

/**
 * **長さを揃えないと測れない**（CLAUDE.md §2.11）。口座の指定は
 * **長さが同じときにだけ**見るので、長さが違うデータで組むと、
 * 口座を見ない実装でも同じ結果になる。
 *
 * 同じ行に当てるため、`pattern` は**同じ摘要の別の場所**を取る
 * （`ｶﾌｪ ｺｰﾋ` に `ｶﾌｪ` と `ｺｰﾋ`。どちらも2字）。
 */
describe("AC-57 同じ長さのルールが当たったとき", () => {
  const row = { name: "ｶﾌｪ ｺｰﾋ ﾀﾞｲ", type: "expense" as const, accountId: ACCOUNT };

  it("長さが同じなら、口座を指定したほうが勝つ", () => {
    const all = rule({ id: "r1", pattern: "ｶﾌｪ", categoryCode: "EXP-13" });
    const scoped = rule({
      id: "r2",
      pattern: "ｺｰﾋ",
      categoryCode: "EXP-11",
      accountId: ACCOUNT,
    });
    expect([...all.pattern].length).toBe([...scoped.pattern].length);
    /* 並び順で決まっていないことを、両方の順で見る */
    expect(pickRule([all, scoped], row)?.id).toBe("r2");
    expect(pickRule([scoped, all], row)?.id).toBe("r2");
  });

  it("長いほうが勝つ。口座を指定しても、短いほうは勝てない", () => {
    /* 要件定義書 §3.3：この並びは**直さない**。口座を先に見ると、
       1文字の雑なルールが精密なルールに勝つ */
    const longAll = rule({ id: "r1", pattern: "ｺｰﾋ ﾀﾞｲ", categoryCode: "EXP-13" });
    const shortScoped = rule({
      id: "r2",
      pattern: "ｺｰﾋ",
      categoryCode: "EXP-11",
      accountId: ACCOUNT,
    });
    expect(pickRule([shortScoped, longAll], row)?.id).toBe("r1");
  });

  it("長さと口座が同じなら、向きを指定したほうが勝つ", () => {
    const both = rule({
      id: "r1",
      pattern: "ｶﾌｪ",
      categoryCode: "TRF-01",
      accountId: ACCOUNT,
    });
    const outOnly = rule({
      id: "r2",
      pattern: "ｺｰﾋ",
      categoryCode: "TRF-01",
      accountId: ACCOUNT,
      direction: "out",
    });
    expect(pickRule([both, outOnly], row)?.id).toBe("r2");
    expect(pickRule([outOnly, both], row)?.id).toBe("r2");
  });

  it("長さも絞り方も同じなら、`id` の昇順", () => {
    const a = rule({ id: "r1", pattern: "ｶﾌｪ", categoryCode: "EXP-13" });
    const b = rule({ id: "r2", pattern: "ｺｰﾋ", categoryCode: "EXP-11" });
    expect(pickRule([b, a], row)?.id).toBe("r1");
    expect(pickRule([a, b], row)?.id).toBe("r1");
  });
});

/* ============ AC-57f 当たる条件が同じルールを2つ持てない ============ */

describe("AC-57f 当たる条件の一意性", () => {
  const existing = rule({ id: "r1", pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-05" });

  it("`accountId` が null どうしでも、同じ条件とみなす", () => {
    /* **ここが落とし穴**（CLAUDE.md §2.11）。両方に口座が入った組み合わせ
       だけで測ると、null を「互いに異なる」とする実装でも通る */
    expect(existing.accountId).toBeNull();
    expect(
      ruleConflict(
        { pattern: "ﾃﾞﾝｷ", accountId: null, direction: null, categoryCode: "EXP-11", bizRatio: 0 },
        [existing],
      ),
    ).toMatch(/同じ/);
  });

  it("口座が違えば別の条件", () => {
    expect(
      ruleConflict(
        { pattern: "ﾃﾞﾝｷ", accountId: ACCOUNT, direction: null, categoryCode: "EXP-11", bizRatio: 0 },
        [existing],
      ),
    ).toBeNull();
  });

  it("向きが違えば別の条件", () => {
    const trf = rule({ id: "r1", pattern: "ﾌﾘｶｴ", categoryCode: "TRF-01" });
    expect(
      ruleConflict(
        { pattern: "ﾌﾘｶｴ", accountId: null, direction: "out", categoryCode: "TRF-01", bizRatio: 0 },
        [trf],
      ),
    ).toBeNull();
    expect(
      ruleConflict(
        { pattern: "ﾌﾘｶｴ", accountId: null, direction: null, categoryCode: "TRF-02", bizRatio: 0 },
        [trf],
      ),
    ).toMatch(/同じ/);
  });

  it("自分自身とは衝突しない（設定画面は既にある行を直す）", () => {
    expect(ruleConflict({ ...existing }, [existing])).toBeNull();
  });

  it("前後の空白を落として比べる（DBより厳しい側）", () => {
    expect(
      ruleConflict(
        { pattern: " ﾃﾞﾝｷ ", accountId: null, direction: null, categoryCode: "EXP-11", bizRatio: 0 },
        [existing],
      ),
    ).toMatch(/同じ/);
  });

  it("`addRule` は同じ条件のルールを増やさず、決める内容を差し替える", () => {
    const first = ruleFromImport(
      { pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-05", costType: "fixed", bizRatio: 40 },
      ACCOUNT,
      "r1",
    );
    const second = ruleFromImport(
      { pattern: "ﾃﾞﾝｷ", categoryCode: "EXP-11", costType: "variable", bizRatio: 0 },
      ACCOUNT,
      "r2",
    );
    const after = addRule(addRule(emptyAppData("2026-10-01"), first), second);
    expect(after.rules).toHaveLength(1);
    expect(after.rules[0]).toMatchObject({ id: "r1", categoryCode: "EXP-11", bizRatio: 0 });
  });
});

/* ====== AC-57e 「次回もこうする」が作るルール（判断3：取込先の口座） ====== */

describe("AC-57e 作るルールの口座", () => {
  it("取込先の口座になる。ほかの口座の同じ摘要には当たらない", () => {
    /* **口座が1つのフィクスチャでは測れない**（CLAUDE.md §2.11）。
       null でも取込先でも同じ結果になる */
    const other = "a2";
    const made = ruleFromImport(
      { pattern: "ﾌﾘｺﾐ ﾀﾅｶ", categoryCode: "INC-01", costType: null, bizRatio: 0 },
      ACCOUNT,
      "r1",
    );
    expect(made.accountId).toBe(ACCOUNT);
    expect(made.direction).toBeNull();

    const row = { name: "ﾌﾘｺﾐ ﾀﾅｶ ｼﾖｳｼﾞ", type: "income" as const };
    expect(ruleMatches(made, { ...row, accountId: ACCOUNT })).toBe(true);
    expect(ruleMatches(made, { ...row, accountId: other })).toBe(false);
  });

  it("資金移動の費目では事業割合を持たせない。固定変動も落とす", () => {
    const made = ruleFromImport(
      { pattern: "ﾌﾘｶｴ", categoryCode: "TRF-01", costType: "fixed", bizRatio: 60 },
      ACCOUNT,
      "r1",
    );
    expect(made).toMatchObject({ bizRatio: 0, costType: null });
    expect(ruleConflict(made)).toBeNull();
  });
});
