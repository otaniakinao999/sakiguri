/**
 * AC-68 取込の結果を残高で検算する（FR-61）
 *
 * **試験データは実データの形をそのまま使う。** ドコモSMTBネット銀行の
 * 普通預金は**新しい行が先**で、残高の列が繋がっている（2026年10月の実データで
 * 231/231組）。摘要は「デビット　４１２６６９」の形が7割を占める。
 *
 * ## 退化させない（CLAUDE.md §2.11）
 *
 * **「一致した」だけを測っても足りない。** 常に `ok` を返す実装でも通る。
 * だから**同じ実行の中で、わざとずらした状態も測る。**
 *
 * | 測るもの | 退化したら |
 * | --- | --- |
 * | 合っているときに黙る | 出っぱなしの実装と区別が付かない |
 * | 1件落としたとき、その額が出る | 常に `ok` の実装と区別が付かない |
 * | 1件二重に入れたとき、その額が出る | 同上 |
 * | 残高の列が無いとき出さない | 列を見ていない実装と区別が付かない |
 *
 * **金額を一様にしない。** 全行が同じ額だと、落とした行と二重の行で
 * 同じ差額が出るので、どの行を測っているのか分からなくなる。
 */

import { describe, expect, it } from "vitest";

import { buildImportRows, detectColumns, parseCsv } from "../csv";
import { checkBalance, type BalanceCheckActual } from "../balance-check";
import type { Actual, DateStr, Yen } from "../types";

/* ========================= 実データの形 ========================= */

/**
 * 10月の明細（抜粋）。**新しい行が先。**
 *
 * 期首 1,000,000 から、古い順に −3,212 / +200,000 / −165 / −77。
 * 期末 1,196,546。増減の合計は +196,546。
 *
 * **4つの額を全部違う値にしてある**（§2.11）。同じ額だと、どの行を
 * 落としても同じ差額が出て、測っているものが分からない。
 */
const STATEMENT = [
  "日付,摘要,出金,入金,残高",
  "2026/10/30,振込手数料,77,,1196546",
  "2026/10/23,ＡＴＭ手数料,165,,1196623",
  "2026/10/20,振込＊カ）ラボル,,200000,1196788",
  "2026/10/20,デビット　４１２６６９,3212,,996788",
].join("\n");

const OPENING = 1_000_000;
const CLOSING = 1_196_546;
const DEPOSITS = new Set(["bank", "cash"]);

function rowsOf(csv: string) {
  const parsed = parseCsv(csv);
  return buildImportRows({
    rows: parsed,
    mapping: detectColumns(parsed),
    accountId: "bank",
  });
}

function actual(over: Partial<Actual> & Pick<Actual, "date" | "amount" | "type">): BalanceCheckActual {
  return { accountId: "bank", ...over };
}

/** 明細の4行をそのまま実績にしたもの（＝ちょうど1回ずつ記録した状態） */
function recordedAll(): BalanceCheckActual[] {
  return rowsOf(STATEMENT).map((row) =>
    actual({ date: row.date, amount: row.amount, type: row.type }),
  );
}

function check(actuals: readonly BalanceCheckActual[], csv = STATEMENT) {
  return checkBalance({
    rows: rowsOf(csv),
    actuals,
    accountId: "bank",
    deposits: DEPOSITS,
  });
}

/* ========================= 列の推定 ========================= */

describe("AC-68 残高の列を見つける", () => {
  it("見出しから残高の列を拾い、金額の列と取り違えない", () => {
    const parsed = parseCsv(STATEMENT);
    const mapping = detectColumns(parsed);
    expect(mapping.balance).toBe(4);
    /* **在ること（残高を拾う）と、取り違えないこと（金額が残高にならない）を
       同じ実行で測る。** 片方だけだと、全部を残高と見る実装でも通る */
    expect(mapping.outflow).toBe(2);
    expect(mapping.inflow).toBe(3);
    expect(mapping.amount).toBe(-1);
  });

  /**
   * **同じ列を2つの役に割り当てない。**
   *
   * 摘要の列が見出しから決まらないとき、残っている列から推し量る。
   * **残高を候補から外さないと、「残高」という文字列が摘要になる**
   * ―― 摘要として読めば日付でも数でもないので、素直に当たってしまう。
   * 役が重なると、検算も費目の推定も同じ列を見ることになる。
   */
  it("同じ列を2つの役に割り当てない", () => {
    const shapes = [
      "日付,摘要,出金,入金,残高",
      "取引日,残高,お引出,お預入,摘要",
      "取引日,残高,引落額",
      "日付,内容,金額,差引残高",
    ];
    for (const header of shapes) {
      const mapping = detectColumns(parseCsv(`${header}\n2026/10/30,a,77,1,2`));
      const used = [
        mapping.date,
        mapping.name,
        mapping.inflow,
        mapping.outflow,
        mapping.amount,
        mapping.balance,
      ].filter((i) => i >= 0);
      expect(new Set(used).size, header).toBe(used.length);
    }
    /* **4つの形を本当に回したことを確かめる**（空でも for は通る） */
    expect(shapes).toHaveLength(4);
  });

  it("残高の列は見出しからだけ拾う（見出しが無ければ検算しない）", () => {
    const parsed = parseCsv("2026/10/30,振込手数料,77,,1196546");
    const mapping = detectColumns(parsed);
    expect(mapping.hasHeader).toBe(false);
    expect(mapping.balance).toBe(-1);
  });

  it("残高の列が無い明細では -1 になる", () => {
    const parsed = parseCsv("日付,摘要,出金,入金\n2026/10/30,振込手数料,77,");
    expect(detectColumns(parsed).balance).toBe(-1);
  });

  it("各行の残高が取込行に入る（null のままにならない）", () => {
    expect(rowsOf(STATEMENT).map((r) => r.balance)).toEqual([
      1_196_546, 1_196_623, 1_196_788, 996_788,
    ]);
  });
});

/* ========================= 検算 ========================= */

describe("AC-68 残高で検算する", () => {
  it("ちょうど1回ずつ記録していれば一致し、期末残高を返す", () => {
    const got = check(recordedAll());
    expect(got).toEqual({
      status: "ok",
      from: "2026-10-20",
      to: "2026-10-30",
      expected: CLOSING,
      recorded: CLOSING,
    });
    /* 期首が明細の中から採れていること。アプリ側の残高を持ち出していない */
    expect(CLOSING - OPENING).toBe(196_546);
  });

  /**
   * **わざとずらす。** 1件ずつ落として、**その行の額**が差額に出ることを
   * 見る。全4行を回すので、特定の1行でしか効かない実装では落ちる。
   */
  it("1件落とすと、その行の額がそのまま差額に出る", () => {
    const all = recordedAll();
    for (const [i, dropped] of all.entries()) {
      const got = check(all.filter((_, j) => j !== i));
      const signed = dropped.type === "income" ? dropped.amount : -dropped.amount;

      expect(got.status).toBe("differs");
      if (got.status !== "differs") throw new Error("unreachable");
      /* 落とした行の増減ぶん、こちらの残高が足りない（または多い） */
      expect(got.diff).toBe(-signed);
      expect(got.recorded).toBe(CLOSING - signed);
      expect(got.expected).toBe(CLOSING);
    }
    /* **4行を本当に回したことを確かめる。** 空の配列でも for は通る */
    expect(all).toHaveLength(4);
  });

  it("1件二重に入れると、その行の額がそのまま差額に出る", () => {
    const all = recordedAll();
    for (const twice of all) {
      const got = check([...all, twice]);
      const signed = twice.type === "income" ? twice.amount : -twice.amount;

      expect(got.status).toBe("differs");
      if (got.status !== "differs") throw new Error("unreachable");
      expect(got.diff).toBe(signed);
    }
  });

  /**
   * **符号だけでは原因が決まらない**（`lib/balance-check-message.ts` の文がこれを
   * 言わない理由）。入金の取り落としと、出金の二重計上は**同じ向き**に
   * ずれる。
   */
  it("入金の取り落としと出金の二重計上は、どちらも残高を少なくする", () => {
    const all = recordedAll();
    const income = all.find((a) => a.type === "income")!;
    const expense = all.find((a) => a.type === "expense")!;

    const dropped = check(all.filter((a) => a !== income));
    const doubled = check([...all, expense]);

    expect(dropped.status).toBe("differs");
    expect(doubled.status).toBe("differs");
    if (dropped.status !== "differs" || doubled.status !== "differs") {
      throw new Error("unreachable");
    }
    expect(dropped.diff).toBeLessThan(0);
    expect(doubled.diff).toBeLessThan(0);
  });

  it("古い行が先の明細でも検算できる（並びの向きを決めつけない）", () => {
    const reversed = [
      "日付,摘要,出金,入金,残高",
      "2026/10/20,デビット　４１２６６９,3212,,996788",
      "2026/10/20,振込＊カ）ラボル,,200000,1196788",
      "2026/10/23,ＡＴＭ手数料,165,,1196623",
      "2026/10/30,振込手数料,77,,1196546",
    ].join("\n");

    const all = rowsOf(reversed).map((row) =>
      actual({ date: row.date, amount: row.amount, type: row.type }),
    );
    expect(check(all, reversed)).toMatchObject({
      status: "ok",
      expected: CLOSING,
      recorded: CLOSING,
    });

    /* **同じデータで、ずらしたときに割れることも見る。** 「向きを試す」
       実装が、どちらの向きでも `ok` を返すだけになっていないこと */
    expect(check(all.slice(1), reversed)).toMatchObject({ status: "differs" });
  });
});

/* ========================= 出さない場合 ========================= */

describe("AC-68 検算できないときは差額を作らない", () => {
  it("残高の列が無いCSVでは出さない", () => {
    const noBalance = [
      "日付,摘要,出金,入金",
      "2026/10/30,振込手数料,77,",
      "2026/10/20,振込＊カ）ラボル,,200000",
    ].join("\n");
    expect(check([], noBalance)).toEqual({ status: "noColumn" });
  });

  it("1行でも残高が読めなければ出さない（欠けた行をまたいで繋がない）", () => {
    const holed = [
      "日付,摘要,出金,入金,残高",
      "2026/10/30,振込手数料,77,,1196546",
      "2026/10/23,ＡＴＭ手数料,165,,",
      "2026/10/20,振込＊カ）ラボル,,200000,1196788",
      "2026/10/20,デビット　４１２６６９,3212,,996788",
    ].join("\n");
    expect(check([], holed)).toEqual({ status: "noColumn" });
  });

  it("残高の鎖が繋がっていなければ broken（差額を出さない）", () => {
    const broken = [
      "日付,摘要,出金,入金,残高",
      "2026/10/30,振込手数料,77,,1196546",
      /* 165 のはずが 999 ずれている */
      "2026/10/23,ＡＴＭ手数料,165,,1197622",
      "2026/10/20,振込＊カ）ラボル,,200000,1196788",
      "2026/10/20,デビット　４１２６６９,3212,,996788",
    ].join("\n");
    const got = check(recordedAll(), broken);
    expect(got).toEqual({ status: "broken" });
  });

  it("行が1件もなければ出さない", () => {
    expect(
      checkBalance({ rows: [], actuals: [], accountId: "bank", deposits: DEPOSITS }),
    ).toEqual({ status: "noColumn" });
  });
});

/* ========================= 範囲と口座 ========================= */

describe("AC-68 引き算の両辺を同じ範囲から取る", () => {
  it("明細の範囲の外にある実績は数えない", () => {
    const got = check([
      ...recordedAll(),
      /* 明細は 10/20〜10/30。前後の実績は残高の鎖に入っていない */
      actual({ date: "2026-10-19" as DateStr, amount: 50_000 as Yen, type: "expense" }),
      actual({ date: "2026-10-31" as DateStr, amount: 70_000 as Yen, type: "income" }),
    ]);
    expect(got.status).toBe("ok");
  });

  it("別の口座の実績は数えない", () => {
    const got = check([
      ...recordedAll(),
      actual({
        date: "2026-10-23" as DateStr,
        amount: 40_000 as Yen,
        type: "expense",
        accountId: "cash",
      }),
    ]);
    expect(got.status).toBe("ok");
  });

  it("振替で入ってくる側も数える（残高は accountDelta から引く）", () => {
    /* 現金 → この口座へ 200,000。明細の「振込＊カ）ラボル」を振替として
       記録し直した形。残高の動きは入金と同じなので一致したままになる */
    const all = recordedAll();
    const income = all.find((a) => a.type === "income")!;
    const got = check([
      ...all.filter((a) => a !== income),
      actual({
        date: income.date,
        amount: income.amount,
        type: "transfer",
        accountId: "cash",
        toAccountId: "bank",
      }),
    ]);
    expect(got.status).toBe("ok");
  });
});
