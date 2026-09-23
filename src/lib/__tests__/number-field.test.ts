import { describe, expect, it } from "vitest";

import { parseMonthsField, parseNumberField } from "../number-field";

/**
 * 一次情報：docs/要件定義書.md §3.2、§4.3
 *   Account.balance … card の場合は未払残高（正の値）
 *   amount          … 金額（絶対値）
 *   §4.3            … `▲` `△` はマイナスとして扱う
 */

/* ========================= 入力途中の状態 ========================= */

describe("入力途中の状態を潰さない", () => {
  it("空にできる", () => {
    /* ここが 0 に戻ると、既存の値を消して入れ直せない */
    expect(parseNumberField("")).toEqual({ text: "", value: 0, clamped: false });
  });

  it("符号だけの状態を残す", () => {
    expect(parseNumberField("-", { allowNegative: true })).toEqual({
      text: "-",
      value: 0,
      clamped: false,
    });
  });

  it("先頭の0は落とす", () => {
    expect(parseNumberField("007").text).toBe("7");
    expect(parseNumberField("05").text).toBe("5");
  });

  it("0そのものは残す", () => {
    expect(parseNumberField("0")).toEqual({ text: "0", value: 0, clamped: false });
  });
});

/* ========================= 符号 ========================= */

describe("マイナス（当座借越・残高マイナス）", () => {
  it("許可すればマイナスで入る", () => {
    expect(parseNumberField("-8000", { allowNegative: true }).value).toBe(-8000);
  });

  it("表示に使っている U+2212 を貼り戻せる", () => {
    /* format.ts の MINUS。画面の「−8,020」をコピーして貼る操作 */
    expect(parseNumberField("−8,020", { allowNegative: true }).value).toBe(-8020);
  });

  it("全角マイナスも受ける", () => {
    expect(parseNumberField("－500", { allowNegative: true }).value).toBe(-500);
  });

  it("通帳の ▲ △ をマイナスとして扱う（§4.3）", () => {
    expect(parseNumberField("▲500", { allowNegative: true }).value).toBe(-500);
    expect(parseNumberField("△500", { allowNegative: true }).value).toBe(-500);
  });

  it("許可しなければ符号は無視して絶対値にする", () => {
    /* カードの未払残高と金額は「正の値」「絶対値」と決まっている（§3.2） */
    expect(parseNumberField("-8000").value).toBe(8000);
    expect(parseNumberField("-8000").text).toBe("8000");
  });

  it("途中のハイフンは区切りとして落とす", () => {
    expect(parseNumberField("1-2-3", { allowNegative: true }).value).toBe(123);
  });
});

/* ========================= 正規化 ========================= */

describe("金額の正規化（§4.3）", () => {
  it("カンマ・円記号・空白を落とす", () => {
    expect(parseNumberField("¥1,234,567").value).toBe(1_234_567);
    expect(parseNumberField("1 234 円").value).toBe(1234);
    expect(parseNumberField("1、234").value).toBe(1234);
  });

  it("全角数字を受ける", () => {
    /* 日本語IMEでそのまま打たれる。落とすと黙って0になる */
    expect(parseNumberField("５００００").value).toBe(50_000);
    expect(parseNumberField("１０").value).toBe(10);
  });

  it("小数点と指数は受け付けない（ADR-0001）", () => {
    expect(parseNumberField("1.5").value).toBe(15);
    expect(parseNumberField("1e5").value).toBe(15);
  });
});

/* ========================= 上限 ========================= */

describe("上限", () => {
  it("超えたら丸めて、丸めたことを伝える", () => {
    const got = parseNumberField("150", { max: 100 });
    expect(got).toEqual({ text: "100", value: 100, clamped: true });
  });

  it("上限内なら丸めない", () => {
    expect(parseNumberField("40", { max: 100 }).clamped).toBe(false);
  });

  it("マイナスは上限に触れない", () => {
    const got = parseNumberField("-5", { allowNegative: true, max: 100 });
    expect(got.value).toBe(-5);
    expect(got.clamped).toBe(false);
  });
});

/* ========================= 対象月（AC-21） ========================= */

describe("対象月の解析（AC-21）", () => {
  it("指定した月を配列にする", () => {
    expect(parseMonthsField("6,8,10,1")).toEqual({
      ok: true,
      months: [1, 6, 8, 10],
    });
  });

  it("読点・空白でも区切れる", () => {
    expect(parseMonthsField("6、8 10")).toEqual({ ok: true, months: [6, 8, 10] });
  });

  it("空なら毎月（null）", () => {
    expect(parseMonthsField("")).toEqual({ ok: true, months: null });
    expect(parseMonthsField("   ")).toEqual({ ok: true, months: null });
  });

  /**
   * ここが AC-21 の本体。
   *
   * 読めない入力に対して値を作らない。`[]` を返すと CL-1 が1件も展開
   * しないのに欄は空欄＝「毎月」に見える。`null` に倒すと誤入力が全月に
   * 1件ずつ発生して気づけない。どちらも黙って資金繰りを変えてしまう。
   */
  it("有効な月が1つも無ければ失敗を返す。値を作らない", () => {
    for (const bad of ["13", "0", "毎月", ",,,", "-"]) {
      expect(parseMonthsField(bad), bad).toEqual({
        ok: false,
        reason: "no-valid-month",
      });
    }
  });

  it("空配列は決して返さない", () => {
    for (const text of ["", "6", "13", "毎月", "0,13"]) {
      const got = parseMonthsField(text);
      if (got.ok) expect(got.months).not.toEqual([]);
    }
  });

  it("全角数字を受ける", () => {
    /* 日本語IMEでそのまま打たれる。落とすと黙って意味が変わる */
    expect(parseMonthsField("６")).toEqual({ ok: true, months: [6] });
    expect(parseMonthsField("６、８、１０")).toEqual({
      ok: true,
      months: [6, 8, 10],
    });
  });

  it("有効な月が1つでもあれば、範囲外だけを落とす", () => {
    expect(parseMonthsField("0,6,13,12")).toEqual({ ok: true, months: [6, 12] });
  });

  it("重複を畳んで昇順にする", () => {
    expect(parseMonthsField("10,6,6,1")).toEqual({ ok: true, months: [1, 6, 10] });
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力", () => {
    expect(parseNumberField("１,２３４", { allowNegative: true })).toEqual(
      parseNumberField("１,２３４", { allowNegative: true }),
    );
    expect(parseMonthsField("６、８")).toEqual(parseMonthsField("６、８"));
    expect(parseMonthsField("13")).toEqual(parseMonthsField("13"));
  });
});
