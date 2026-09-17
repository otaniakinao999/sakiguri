import { describe, expect, it } from "vitest";

import { parseNumberField } from "../number-field";

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

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力", () => {
    expect(parseNumberField("１,２３４", { allowNegative: true })).toEqual(
      parseNumberField("１,２３４", { allowNegative: true }),
    );
  });
});
