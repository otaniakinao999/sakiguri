import { describe, expect, it } from "vitest";

import {
  buildImportRows,
  CSV_MAX_ROWS,
  decodeCsv,
  detectColumns,
  guessFromHistory,
  historyKeyOf,
  matchPlan,
  NO_DESCRIPTION,
  normalizeAmount,
  normalizeDate,
  parseCsv,
  type ColumnMapping,
  type HistoryEntry,
} from "../csv";
import type { ForecastInstance } from "../types";

/* ========================= 素材 ========================= */

function plan(
  over: Partial<ForecastInstance> & Pick<ForecastInstance, "key" | "date" | "amount">,
): ForecastInstance {
  return {
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    srcId: "r1",
    ...over,
  };
}

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

/* ========================= 文字コード ========================= */

describe("CL-7 文字コード判定", () => {
  const header = "日付,摘要,入金,出金";

  it("UTF-8 を読む", () => {
    const bytes = new TextEncoder().encode(header);
    expect(decodeCsv(bytes)).toBe(header);
  });

  it("BOM 付き UTF-8 の BOM を除く", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(header),
    ]);
    expect(decodeCsv(bytes)).toBe(header);
  });

  it("AC-07: Shift_JIS を読む", () => {
    // 「日付,摘要,入金,出金」の Shift_JIS バイト列
    const bytes = new Uint8Array([
      0x93, 0xfa, 0x95, 0x74, 0x2c, 0x93, 0x45, 0x97, 0x76, 0x2c, 0x93, 0xfc,
      0x8b, 0xe0, 0x2c, 0x8f, 0x6f, 0x8b, 0xe0,
    ]);
    expect(decodeCsv(bytes)).toBe(header);
  });

  it("ArrayBuffer も受け付ける", () => {
    const bytes = new TextEncoder().encode(header);
    expect(decodeCsv(bytes.buffer as ArrayBuffer)).toBe(header);
  });

  it("Shift_JIS の半角カナを読む", () => {
    // 「ｽｰﾊﾟｰ」
    const bytes = new Uint8Array([0xbd, 0xb0, 0xca, 0xdf, 0xb0]);
    expect(decodeCsv(bytes)).toBe("ｽｰﾊﾟｰ");
  });
});

/* ========================= 解析 ========================= */

describe("CL-7 CSV の解析", () => {
  it("カンマ区切りを読む", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("タブ区切りを読む", () => {
    expect(parseCsv("a\tb\tc\n1\t2\t3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("タブ区切りの摘要にカンマが入っていても列がずれない", () => {
    expect(parseCsv("日付\t摘要\n2026-04-01\tスーパー, 駅前店")).toEqual([
      ["日付", "摘要"],
      ["2026-04-01", "スーパー, 駅前店"],
    ]);
  });

  it("ダブルクォートで囲んだ区切り文字を通す", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it('囲みの中の "" はひとつの " になる', () => {
    expect(parseCsv('a,"b""c",d')).toEqual([["a", 'b"c', "d"]]);
  });

  it("CRLF を読む", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("全セルが空の行は落とす", () => {
    expect(parseCsv("a,b\n\n,\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("最終行に改行が無くても読む", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(2);
  });

  it("空文字列は空配列", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("行数の上限を超えると投げる（要件定義書 §6.1）", () => {
    const tooMany = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `${i},x`).join("\n");
    expect(() => parseCsv(tooMany)).toThrow(RangeError);
  });

  it("上限ちょうどは通す", () => {
    const exact = Array.from({ length: CSV_MAX_ROWS }, (_, i) => `${i},x`).join("\n");
    expect(parseCsv(exact)).toHaveLength(CSV_MAX_ROWS);
  });
});

/* ========================= 正規化 ========================= */

describe("CL-7 日付の正規化", () => {
  it("受け付ける書式", () => {
    expect(normalizeDate("2026/4/1")).toBe("2026-04-01");
    expect(normalizeDate("2026/04/01")).toBe("2026-04-01");
    expect(normalizeDate("2026-4-1")).toBe("2026-04-01");
    expect(normalizeDate("2026年4月1日")).toBe("2026-04-01");
    expect(normalizeDate("2026年4月1")).toBe("2026-04-01");
    expect(normalizeDate("20260401")).toBe("2026-04-01");
    expect(normalizeDate("2026.4.1")).toBe("2026-04-01");
  });

  it("前後の空白と引用符を落とす", () => {
    expect(normalizeDate('  "2026/4/1"  ')).toBe("2026-04-01");
  });

  it("読めないものは null", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("スーパー")).toBeNull();
    expect(normalizeDate("4/1")).toBeNull();
    expect(normalizeDate("1000")).toBeNull();
  });

  it("和暦は対象外", () => {
    expect(normalizeDate("令和8年4月1日")).toBeNull();
    expect(normalizeDate("R8/4/1")).toBeNull();
  });

  it("存在しない日付は null", () => {
    expect(normalizeDate("2026/2/30")).toBeNull();
    expect(normalizeDate("2026/13/1")).toBeNull();
    expect(normalizeDate("20260231")).toBeNull();
  });

  it("閏日を通す", () => {
    expect(normalizeDate("2028/2/29")).toBe("2028-02-29");
    expect(normalizeDate("2026/2/29")).toBeNull();
  });
});

describe("CL-7 金額の正規化", () => {
  it("記号と区切りを除く", () => {
    expect(normalizeAmount("¥1,234")).toBe(1234);
    expect(normalizeAmount("￥1,234")).toBe(1234);
    expect(normalizeAmount("1,234円")).toBe(1234);
    expect(normalizeAmount("1、234")).toBe(1234);
    expect(normalizeAmount(" 1234 ")).toBe(1234);
    expect(normalizeAmount('"1,234"')).toBe(1234);
  });

  it("▲ と △ はマイナス", () => {
    expect(normalizeAmount("▲1,234")).toBe(-1234);
    expect(normalizeAmount("△1,234")).toBe(-1234);
  });

  it("通常のマイナスも読む", () => {
    expect(normalizeAmount("-1234")).toBe(-1234);
  });

  it("空欄と読めないものは null", () => {
    expect(normalizeAmount("")).toBeNull();
    expect(normalizeAmount("   ")).toBeNull();
    expect(normalizeAmount("-")).toBeNull();
    expect(normalizeAmount("スーパー")).toBeNull();
  });

  it("0 は 0 として読む（null ではない）", () => {
    expect(normalizeAmount("0")).toBe(0);
  });

  it("小数は円未満を丸める", () => {
    expect(normalizeAmount("1234.4")).toBe(1234);
    expect(normalizeAmount("1234.5")).toBe(1235);
  });
});

/* ========================= 列の推定 ========================= */

describe("CL-7 列の自動推定", () => {
  it("AC-07: 銀行CSVの見出しから4列を当てる", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,ｽｰﾊﾟｰ,,4820");

    expect(detectColumns(rows)).toMatchObject({
      date: 0,
      name: 1,
      inflow: 2,
      outflow: 3,
      hasHeader: true,
    });
  });

  it("見出しの言い回しの揺れを吸収する", () => {
    const rows = parseCsv("ご利用日,ご利用先,お預入,お支払\n2026/04/25,店,,100");

    expect(detectColumns(rows)).toMatchObject({
      date: 0,
      name: 1,
      inflow: 2,
      outflow: 3,
    });
  });

  it("金額が1列の見出しを当てる", () => {
    const rows = parseCsv("取引日,お取引内容,金額\n2026/04/25,店,-100");

    expect(detectColumns(rows)).toMatchObject({
      date: 0,
      name: 1,
      inflow: -1,
      outflow: -1,
      amount: 2,
      sign: "outMinus",
    });
  });

  it("見出しが無い場合は1行目の中身から推し量る", () => {
    const rows = parseCsv("2026/04/25,ｽｰﾊﾟｰ,-4820");
    const got = detectColumns(rows);

    expect(got.hasHeader).toBe(false);
    expect(got.date).toBe(0);
    expect(got.name).toBe(1);
    expect(got.amount).toBe(2);
  });

  it("見出しの列が日付として読めるなら見出しではない", () => {
    const rows = parseCsv("2026/04/25,店,100\n2026/04/26,店,200");
    expect(detectColumns(rows).hasHeader).toBe(false);
  });

  it("摘要の列が無ければ -1", () => {
    const rows = parseCsv("日付,入金,出金\n2026/04/25,,100");
    expect(detectColumns(rows).name).toBe(-1);
  });
});

/* ========================= 費目の推定 ========================= */

describe("CL-7 費目の自動推定", () => {
  const history: HistoryEntry[] = [
    { name: "通信費（携帯・回線）", categoryCode: "EXP-03", costType: "fixed", bizRatio: 40 },
    { name: "スーパー", categoryCode: "EXP-21", costType: "variable", bizRatio: 0 },
    { name: "A社 業務委託料", categoryCode: "INC-01", costType: null, bizRatio: 100 },
  ];

  it("括弧内を除いた先頭4文字で部分一致する", () => {
    const got = guessFromHistory("ｶ)ﾂｳｼﾝﾋ 通信費 4月分", history, "expense");
    expect(got).toMatchObject({ categoryCode: "EXP-03", costType: "fixed", bizRatio: 40 });
  });

  it("費目・固定変動区分・事業割合を引き継ぐ", () => {
    const got = guessFromHistory("スーパー 駅前店", history, "expense");
    expect(got).toEqual({
      categoryCode: "EXP-21",
      costType: "variable",
      bizRatio: 0,
      from: "スーパー",
    });
  });

  it("収入の摘要には収入の費目を当てる", () => {
    const got = guessFromHistory("A社 業務委託料 4月分", history, "income");
    expect(got?.categoryCode).toBe("INC-01");
  });

  it("収支の向きが合わない費目は使わない", () => {
    // 「A社 業務委託料」は収入の費目。支出行には当てない
    expect(guessFromHistory("A社 業務委託料 返金", history, "expense")).toBeNull();
    // 「スーパー」は支出の費目。収入行には当てない
    expect(guessFromHistory("スーパー 返金", history, "income")).toBeNull();
  });

  it("一致しなければ null", () => {
    expect(guessFromHistory("見たことのない店", history, "expense")).toBeNull();
  });

  it("資金移動の費目は引き継がない", () => {
    const trf: HistoryEntry[] = [
      { name: "生活費振替", categoryCode: "TRF-02", costType: null, bizRatio: 0 },
    ];
    expect(guessFromHistory("生活費振替 4月", trf, "expense")).toBeNull();
  });

  it("2文字未満のキーは照合に使わない", () => {
    expect(historyKeyOf("A")).toBeNull();
    expect(historyKeyOf("（携帯）")).toBeNull();
    expect(historyKeyOf("AB")).toBe("AB");
  });

  it("括弧内を除いた先頭4文字を取る", () => {
    expect(historyKeyOf("通信費（携帯・回線）")).toBe("通信費");
    expect(historyKeyOf("クラウド・SaaS")).toBe("クラウド");
    expect(historyKeyOf("A社 業務委託料")).toBe("A社 業");
  });

  it("先に登録された項目が優先される", () => {
    const two: HistoryEntry[] = [
      { name: "スーパーA", categoryCode: "EXP-21", costType: "variable", bizRatio: 0 },
      { name: "スーパーB", categoryCode: "EXP-22", costType: "variable", bizRatio: 0 },
    ];
    // どちらもキーは「スーパー」。最初の1件を返す
    expect(guessFromHistory("スーパー", two, "expense")?.categoryCode).toBe("EXP-21");
  });
});

/* ========================= 予定との自動照合 ========================= */

describe("CL-7 予定との自動照合", () => {
  const candidates = [
    plan({ key: "p1", date: "2026-04-27", amount: 120_000 }),
    plan({ key: "p2", date: "2026-04-25", amount: 9_800, name: "通信費" }),
  ];

  it("金額が完全一致し、日付差12日以内、向きが同じなら候補になる", () => {
    const got = matchPlan(
      { date: "2026-04-28", amount: 120_000, type: "expense", accountId: "a1" },
      candidates,
    );
    expect(got?.key).toBe("p1");
  });

  it("金額が1円でも違えば照合しない", () => {
    expect(
      matchPlan({ date: "2026-04-27", amount: 119_999, type: "expense", accountId: "a1" }, candidates),
    ).toBeNull();
  });

  it("日付差12日ちょうどは照合する", () => {
    expect(
      matchPlan({ date: "2026-05-09", amount: 120_000, type: "expense", accountId: "a1" }, candidates)?.key,
    ).toBe("p1");
  });

  it("日付差13日は照合しない", () => {
    expect(
      matchPlan({ date: "2026-05-10", amount: 120_000, type: "expense", accountId: "a1" }, candidates),
    ).toBeNull();
  });

  it("前にずれていても12日以内なら照合する", () => {
    expect(
      matchPlan({ date: "2026-04-15", amount: 120_000, type: "expense", accountId: "a1" }, candidates)?.key,
    ).toBe("p1");
  });

  it("収支の向きが違えば照合しない", () => {
    expect(
      matchPlan({ date: "2026-04-27", amount: 120_000, type: "income", accountId: "a1" }, candidates),
    ).toBeNull();
  });

  it("条件を満たす最初の1件を返す", () => {
    const same = [
      plan({ key: "first", date: "2026-04-20", amount: 5_000 }),
      plan({ key: "second", date: "2026-04-21", amount: 5_000 }),
    ];
    expect(
      matchPlan({ date: "2026-04-20", amount: 5_000, type: "expense", accountId: "a1" }, same)?.key,
    ).toBe("first");
  });

  it("すでに他の行が取った予定は飛ばす", () => {
    const same = [
      plan({ key: "first", date: "2026-04-20", amount: 5_000 }),
      plan({ key: "second", date: "2026-04-21", amount: 5_000 }),
    ];
    const got = matchPlan(
      { date: "2026-04-20", amount: 5_000, type: "expense", accountId: "a1" },
      same,
      new Set(["first"]),
    );
    expect(got?.key).toBe("second");
  });

  it("候補が無ければ null", () => {
    expect(matchPlan({ date: "2026-04-27", amount: 1, type: "expense", accountId: "a1" }, [])).toBeNull();
  });

  /* ---------- 口座の一致（AC-33） ---------- */

  it("AC-33: 口座が違えば照合しない", () => {
    expect(
      matchPlan(
        { date: "2026-04-27", amount: 120_000, type: "expense", accountId: "a2" },
        candidates,
      ),
    ).toBeNull();
  });

  /**
   * AC-33 の本体。
   *
   * 探す側の予定は全口座にまたがっている。取込時に選ばせるのは取り込む
   * 実績の口座だけなので、口座を条件にしないと同額・同日の別口座の予定に
   * 当たる。しかも消し込みが成立するため誰も気づかない。
   */
  it("AC-33: 同額・同日の予定が別口座にあっても、選んだ口座の予定だけが当たる", () => {
    const both = [
      /* 三井住友カードの引落 80,000（先に並んでいる） */
      plan({ key: "card", date: "2026-04-27", amount: 80_000, accountId: "c1" }),
      /* ゆうちょから出る家賃 80,000 */
      plan({ key: "bank", date: "2026-04-27", amount: 80_000, accountId: "a1" }),
    ];

    const got = matchPlan(
      { date: "2026-04-27", amount: 80_000, type: "expense", accountId: "a1" },
      both,
    );

    expect(got?.key).toBe("bank");
  });

  it("AC-33: カードの予定は銀行口座の行に当たらない", () => {
    /* カードの引落は CL-2 で合算された1件として銀行に現れる。個別の利用
       明細とは金額が一致しないが、従来はそれで偶然防がれていただけだった */
    const card = [plan({ key: "card", date: "2026-04-27", amount: 9_800, accountId: "c1" })];

    expect(
      matchPlan(
        { date: "2026-04-27", amount: 9_800, type: "expense", accountId: "a1" },
        card,
      ),
    ).toBeNull();
  });

  it("AC-33: 取込全体でも、選んだ口座以外の予定は消し込まれない", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/27,ﾔﾁﾝ,,80000");
    const both = [
      plan({ key: "card", date: "2026-04-27", amount: 80_000, accountId: "c1" }),
      plan({ key: "bank", date: "2026-04-27", amount: 80_000, accountId: "a1" }),
    ];

    const got = buildImportRows({
      rows,
      mapping: mapping(),
      accountId: "a1",
      candidates: both,
    });

    expect(got[0].matchedKey).toBe("bank");
  });
});

/* ========================= 取込行の組み立て ========================= */

describe("CL-7 取込行の組み立て", () => {
  it("入金列・出金列が分かれている場合は入金を正、出金を負とする", () => {
    const rows = parseCsv(
      "日付,摘要,入金,出金\n2026/04/25,ｽｰﾊﾟｰ,,4820\n2026/04/25,ｶ)ｴｰｼﾔ,450000,",
    );

    const got = buildImportRows({ rows, mapping: mapping(), accountId: "a1" });

    expect(got.map((r) => [r.type, r.amount])).toEqual([
      ["expense", 4820],
      ["income", 450000],
    ]);
  });

  it("金額1列で「出金がマイナス」", () => {
    const rows = parseCsv("日付,摘要,金額\n2026/04/25,店,-4820\n2026/04/26,入金,1000");
    const map = mapping({ inflow: -1, outflow: -1, amount: 2, sign: "outMinus" });

    expect(buildImportRows({ rows, mapping: map, accountId: "a1" }).map((r) => [r.type, r.amount])).toEqual([
      ["expense", 4820],
      ["income", 1000],
    ]);
  });

  it("金額1列で「出金がプラス」", () => {
    const rows = parseCsv("日付,摘要,金額\n2026/04/25,店,4820");
    const map = mapping({ inflow: -1, outflow: -1, amount: 2, sign: "outPlus" });

    expect(buildImportRows({ rows, mapping: map, accountId: "a1" })[0]).toMatchObject({
      type: "expense",
      amount: 4820,
    });
  });

  it("日付が読めない行は落とす", () => {
    const rows = parseCsv("日付,摘要,入金,出金\nお繰越,,,\n2026/04/25,店,,100");
    expect(buildImportRows({ rows, mapping: mapping(), accountId: "a1" })).toHaveLength(1);
  });

  it("金額が0または読めない行は落とす", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,残高照会,,0\n2026/04/26,店,,100");
    expect(buildImportRows({ rows, mapping: mapping(), accountId: "a1" })).toHaveLength(1);
  });

  it("摘要が空なら（摘要なし）", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,,,100");
    expect(buildImportRows({ rows, mapping: mapping(), accountId: "a1" })[0].name).toBe(
      NO_DESCRIPTION,
    );
  });

  it("見出しが無い指定なら1行目もデータとして読む", () => {
    const rows = parseCsv("2026/04/25,店,,100");
    const got = buildImportRows({
      rows,
      mapping: mapping({ hasHeader: false }),
      accountId: "a1",
    });
    expect(got).toHaveLength(1);
  });

  it("費目が推定できなければ受け皿の費目を当てる（適用規則4）", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,見知らぬ店,,100\n2026/04/26,謎の入金,1000,");
    const got = buildImportRows({ rows, mapping: mapping(), accountId: "a1" });

    expect(got[0]).toMatchObject({ categoryCode: "EXP-20", costType: "variable", bizRatio: 0 });
    expect(got[1]).toMatchObject({ categoryCode: "INC-07", costType: null, bizRatio: 0 });
  });

  it("事業割合の初期値は0（適用規則7）", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,見知らぬ店,,100");
    expect(buildImportRows({ rows, mapping: mapping(), accountId: "a1" })[0].bizRatio).toBe(0);
  });

  it("過去の項目から費目・固定変動・事業割合を引き継ぐ", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,ｶ)ﾂｳｼﾝ 通信費 4月分,,9800");
    const history: HistoryEntry[] = [
      { name: "通信費（携帯・回線）", categoryCode: "EXP-03", costType: "fixed", bizRatio: 40 },
    ];

    expect(buildImportRows({ rows, mapping: mapping(), accountId: "a1", history })[0]).toMatchObject({
      categoryCode: "EXP-03",
      costType: "fixed",
      bizRatio: 40,
      guessedFrom: "通信費（携帯・回線）",
    });
  });

  it("同じ予定を2行が取り合わない", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,店,,5000\n2026/04/26,店,,5000");
    const candidates = [
      plan({ key: "p1", date: "2026-04-25", amount: 5_000 }),
      plan({ key: "p2", date: "2026-04-26", amount: 5_000 }),
    ];

    const got = buildImportRows({ rows, mapping: mapping(), accountId: "a1", candidates });

    expect(got.map((r) => r.matchedKey)).toEqual(["p1", "p2"]);
  });

  it("候補が1件しかなければ2行目は照合されない", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,店,,5000\n2026/04/26,店,,5000");
    const candidates = [plan({ key: "p1", date: "2026-04-25", amount: 5_000 })];

    const got = buildImportRows({ rows, mapping: mapping(), accountId: "a1", candidates });

    expect(got.map((r) => r.matchedKey)).toEqual(["p1", null]);
  });

  it("既定では取込可とし、口座を割り当てる", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,店,,100");
    expect(buildImportRows({ rows, mapping: mapping(), accountId: "c1" })[0]).toMatchObject({
      include: true,
      accountId: "c1",
      rowIndex: 0,
    });
  });
});

/* ============ 照合と費目推定の優先順位（AC-45） ============ */

describe("AC-45 照合が成立した行は予定から引き継ぐ", () => {
  /** 事務所家賃。地代家賃・固定費・事業100% */
  const rent = plan({
    key: "p1",
    date: "2026-10-20",
    amount: 100_000,
    name: "事務所家賃",
    categoryCode: "EXP-01",
    costType: "fixed",
    bizRatio: 100,
  });

  /** 銀行CSVらしく摘要が半角カナ。「事務所家賃」の先頭4文字は含まれない */
  const katakana = parseCsv("日付,摘要,入金,出金\n2026/10/20,ﾌﾘｺﾐ ｼﾞﾑｼｮﾔﾁﾝ,,100000");

  it("半角カナで名称の部分一致が成立しなくても引き継ぐ", () => {
    const got = buildImportRows({
      rows: katakana,
      mapping: mapping(),
      accountId: "a1",
      candidates: [rent],
    });

    expect(got[0]).toMatchObject({
      matchedKey: "p1",
      categoryCode: "EXP-01",
      costType: "fixed",
      bizRatio: 100,
    });
  });

  /**
   * ここが AC-45 の肝。引き継がないと、照合できているのに雑費・変動費・
   * 事業0% で取り込まれる。合計は合うが、CL-5 の差異が
   * 地代家賃 +100,000 と 雑費 −100,000 に割れ、事業割合 100 → 0 で
   * その額が事業から家計へ移る。
   */
  it("引き継がないと雑費・変動費・事業0%になる（照合先を渡さない場合）", () => {
    const got = buildImportRows({
      rows: katakana,
      mapping: mapping(),
      accountId: "a1",
    });

    expect(got[0]).toMatchObject({
      matchedKey: null,
      categoryCode: "EXP-20",
      costType: "variable",
      bizRatio: 0,
    });
  });

  it("名称からの推定より照合先を優先する", () => {
    /* 摘要に「事務所家賃」が入っていて、推定なら別の費目に当たる状況 */
    const rows = parseCsv("日付,摘要,入金,出金\n2026/10/20,事務所家賃 10月分,,100000");
    const history: HistoryEntry[] = [
      { name: "事務所家賃", categoryCode: "EXP-20", costType: "variable", bizRatio: 0 },
    ];

    const got = buildImportRows({
      rows,
      mapping: mapping(),
      accountId: "a1",
      candidates: [rent],
      history,
    });

    expect(got[0]).toMatchObject({
      categoryCode: "EXP-01",
      costType: "fixed",
      bizRatio: 100,
      /* 推定は使っていないので、推定元も残さない */
      guessedFrom: null,
    });
  });

  it("照合が成立しなかった行には従来の推定が働く", () => {
    const rows = parseCsv(
      "日付,摘要,入金,出金\n2026/10/20,ﾌﾘｺﾐ ｼﾞﾑｼｮﾔﾁﾝ,,100000\n2026/10/21,通信費 10月分,,9800",
    );
    const history: HistoryEntry[] = [
      { name: "通信費（携帯・回線）", categoryCode: "EXP-03", costType: "fixed", bizRatio: 40 },
    ];

    const got = buildImportRows({
      rows,
      mapping: mapping(),
      accountId: "a1",
      candidates: [rent],
      history,
    });

    expect(got[0]).toMatchObject({ matchedKey: "p1", categoryCode: "EXP-01", guessedFrom: null });
    expect(got[1]).toMatchObject({
      matchedKey: null,
      categoryCode: "EXP-03",
      costType: "fixed",
      bizRatio: 40,
      guessedFrom: "通信費（携帯・回線）",
    });
  });

  it("金額は実績の値を使う。予定と違ってよい", () => {
    /* 照合は金額完全一致が条件なので、±12日の別日で同額の行を作る */
    const rows = parseCsv("日付,摘要,入金,出金\n2026/10/25,ﾌﾘｺﾐ ｼﾞﾑｼｮﾔﾁﾝ,,100000");
    const got = buildImportRows({
      rows,
      mapping: mapping(),
      accountId: "a1",
      candidates: [rent],
    });

    expect(got[0]).toMatchObject({ matchedKey: "p1", amount: 100_000, date: "2026-10-25" });
  });

  it("事業割合0の予定に照合したら0を引き継ぐ", () => {
    /* `??` で 0 が落ちて推定に流れないこと */
    const rows = parseCsv("日付,摘要,入金,出金\n2026/10/20,食費 ｽｰﾊﾟｰ,,100000");
    const history: HistoryEntry[] = [
      { name: "食費", categoryCode: "EXP-21", costType: "variable", bizRatio: 80 },
    ];

    const got = buildImportRows({
      rows,
      mapping: mapping(),
      accountId: "a1",
      candidates: [plan({ ...rent, bizRatio: 0 })],
      history,
    });

    expect(got[0]).toMatchObject({ categoryCode: "EXP-01", bizRatio: 0 });
  });

  it("収入の行では costType を null のままにする", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/10/25,ﾌﾘｺﾐ ｶ)ｻｷｸﾞﾘ,500000,");
    const sales = plan({
      key: "p2",
      date: "2026-10-25",
      amount: 500_000,
      name: "売上",
      type: "income",
      costType: null,
      categoryCode: "INC-01",
      bizRatio: 100,
    });

    expect(
      buildImportRows({ rows, mapping: mapping(), accountId: "a1", candidates: [sales] })[0],
    ).toMatchObject({
      matchedKey: "p2",
      categoryCode: "INC-01",
      costType: null,
      bizRatio: 100,
    });
  });
});

/* ========================= AC-07 通し ========================= */

describe("AC-07 Shift_JIS の銀行CSVを取り込む", () => {
  /** UTF-8 の文字列を Shift_JIS のバイト列にする（テスト用） */
  function toShiftJis(text: string): Uint8Array {
    // Node に SJIS エンコーダは無いので、必要な文字だけ表引きする
    const table: Record<string, number[]> = {
      日: [0x93, 0xfa], 付: [0x95, 0x74], 摘: [0x93, 0x45], 要: [0x97, 0x76],
      入: [0x93, 0xfc], 金: [0x8b, 0xe0], 出: [0x8f, 0x6f],
      家: [0x89, 0xc6], 賃: [0x92, 0xc0], 振: [0x90, 0x55], 込: [0x8d, 0x9e],
      "ｽ": [0xbd], "ｰ": [0xb0], "ﾊ": [0xca], "ﾟ": [0xdf],
    };
    const out: number[] = [];
    for (const ch of text) {
      if (table[ch]) out.push(...table[ch]);
      else if (ch.charCodeAt(0) < 0x80) out.push(ch.charCodeAt(0));
      else throw new Error(`テストの変換表にない文字: ${ch}`);
    }
    return new Uint8Array(out);
  }

  it("文字コード判定・列の自動推定・自動照合が通しで動く", () => {
    const csv = [
      "日付,摘要,入金,出金",
      "2026/04/27,家賃 振込,,120000",
      "2026/04/25,ｽｰﾊﾟｰ,,4820",
      "2026/04/25,振込 入金,450000,",
    ].join("\r\n");

    /* 1. Shift_JIS のバイト列として渡す */
    const bytes = toShiftJis(csv);
    // UTF-8 として厳格に読むと失敗するバイト列であること
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow();

    const text = decodeCsv(bytes);
    expect(text).toBe(csv);

    /* 2. 列が自動推定される */
    const rows = parseCsv(text);
    const map = detectColumns(rows);
    expect(map).toMatchObject({
      date: 0,
      name: 1,
      inflow: 2,
      outflow: 3,
      hasHeader: true,
    });

    /* 3. 金額一致する未消込の予定が自動照合される */
    const candidates = [
      plan({ key: "r:rh1:2026-04-27", date: "2026-04-27", amount: 120_000, name: "家賃" }),
      plan({
        key: "r:rb1:2026-04-25",
        date: "2026-04-25",
        amount: 450_000,
        name: "A社 業務委託料",
        type: "income",
        costType: null,
        categoryCode: "INC-01",
      }),
    ];

    const imported = buildImportRows({
      rows,
      mapping: map,
      accountId: "a1",
      candidates,
      history: [
        { name: "家賃", categoryCode: "EXP-01", costType: "fixed", bizRatio: 0 },
      ],
    });

    expect(imported).toHaveLength(3);

    // 家賃は金額一致・同日で照合される
    expect(imported[0]).toMatchObject({
      date: "2026-04-27",
      type: "expense",
      amount: 120_000,
      matchedKey: "r:rh1:2026-04-27",
      matchedName: "家賃",
      categoryCode: "EXP-01",
    });

    // スーパーは照合先が無い。費目は受け皿になる
    expect(imported[1]).toMatchObject({
      date: "2026-04-25",
      amount: 4_820,
      matchedKey: null,
      categoryCode: "EXP-20",
    });

    // 入金も照合される
    expect(imported[2]).toMatchObject({
      type: "income",
      amount: 450_000,
      matchedKey: "r:rb1:2026-04-25",
    });
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("入力を書き換えない", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,店,,100");
    const candidates = [plan({ key: "p1", date: "2026-04-25", amount: 100 })];
    const history: HistoryEntry[] = [
      { name: "店舗", categoryCode: "EXP-21", costType: "variable", bizRatio: 0 },
    ];
    const snapshot = structuredClone({ rows, candidates, history });

    buildImportRows({ rows, mapping: mapping(), accountId: "a1", candidates, history });

    expect({ rows, candidates, history }).toEqual(snapshot);
  });

  it("同じ入力なら同じ出力を返す", () => {
    const rows = parseCsv("日付,摘要,入金,出金\n2026/04/25,店,,100");
    const args = { rows, mapping: mapping(), accountId: "a1" };

    expect(buildImportRows(args)).toEqual(buildImportRows(args));
  });
});
