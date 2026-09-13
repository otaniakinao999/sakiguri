import { describe, expect, it } from "vitest";

import { businessShare, householdShare, share } from "../proration";

describe("CL-4 家事按分", () => {
  it("AC-05: 事業割合40%の通信費9,800円", () => {
    expect(share(9_800, 40, "business")).toBe(3_920);
    expect(share(9_800, 40, "household")).toBe(5_880);
    expect(share(9_800, 40, "all")).toBe(9_800);
  });

  it("事業割合100%は全額が事業", () => {
    expect(share(450_000, 100, "business")).toBe(450_000);
    expect(share(450_000, 100, "household")).toBe(0);
  });

  it("事業割合0%は全額が家計", () => {
    expect(share(120_000, 0, "business")).toBe(0);
    expect(share(120_000, 0, "household")).toBe(120_000);
  });

  it("合算ビューは按分しない", () => {
    expect(share(9_800, 40, "all")).toBe(9_800);
    expect(share(9_800, 0, "all")).toBe(9_800);
    expect(share(9_800, 100, "all")).toBe(9_800);
  });

  it("円未満は丸める", () => {
    // 10,000 × 25% = 2,500 ちょうど
    expect(businessShare(10_000, 25)).toBe(2_500);
    // 9,999 × 25% = 2,499.75 → 2,500
    expect(businessShare(9_999, 25)).toBe(2_500);
    // 9,998 × 25% = 2,499.5 → 2,500（JS の Math.round は半分を上へ）
    expect(businessShare(9_998, 25)).toBe(2_500);
    // 9,997 × 25% = 2,499.25 → 2,499
    expect(businessShare(9_997, 25)).toBe(2_499);
  });

  it("整数を返す", () => {
    for (const amount of [1, 7, 999, 9_801, 123_457]) {
      for (const ratio of [1, 3, 33, 40, 50, 66, 99]) {
        expect(Number.isInteger(businessShare(amount, ratio))).toBe(true);
        expect(Number.isInteger(householdShare(amount, ratio))).toBe(true);
      }
    }
  });

  /**
   * 要件定義書 CL-4 の表は家計ぶんを `amount × (100 − bizRatio) ÷ 100` と
   * 書いているが、実装は残差（合算 − 事業）で求めている。
   * 経緯は docs/adr/0010-家事按分の家計ぶんを残差で求める.md
   */
  it("事業ぶんと家計ぶんの合計は必ず合算ビューと一致する（ADR-0010）", () => {
    for (const amount of [1, 3, 7, 101, 9_998, 10_001, 123_457, 999_999]) {
      for (let ratio = 0; ratio <= 100; ratio++) {
        expect(businessShare(amount, ratio) + householdShare(amount, ratio)).toBe(
          amount,
        );
      }
    }
  });

  it("独立に丸めると合わない例（残差で解決している）", () => {
    // 10,001 × 50% = 5,000.5 → 事業は 5,001
    expect(businessShare(10_001, 50)).toBe(5_001);
    // 表の式どおりなら家計も 5,001 になり、合計 10,002 になってしまう
    expect(Math.round((10_001 * 50) / 100)).toBe(5_001);
    // 残差なので 5,000。合計は 10,001 に戻る
    expect(householdShare(10_001, 50)).toBe(5_000);
  });

  it("範囲外の事業割合は0〜100に収める", () => {
    expect(businessShare(1_000, -10)).toBe(0);
    expect(businessShare(1_000, 150)).toBe(1_000);
  });

  it("数値でない事業割合は投げる", () => {
    expect(() => businessShare(1_000, Number.NaN)).toThrow(RangeError);
  });

  it("金額0はどのビューでも0", () => {
    expect(share(0, 40, "all")).toBe(0);
    expect(share(0, 40, "business")).toBe(0);
    expect(share(0, 40, "household")).toBe(0);
  });
});
