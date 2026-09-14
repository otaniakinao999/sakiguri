import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatMonthDay,
  formatSigned,
  formatYearMonthLabel,
  formatYen,
  MINUS,
} from "../format";

describe("金額の表示（要件定義書 §4.3）", () => {
  it("3桁区切りにする", () => {
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(1_234)).toBe("1,234");
    expect(formatAmount(1_234_567)).toBe("1,234,567");
    expect(formatAmount(120_000)).toBe("120,000");
  });

  it("マイナスは − (U+2212) を使う。ハイフンは使わない", () => {
    expect(MINUS).toBe("−");
    expect(formatAmount(-1_234)).toBe("−1,234");
    expect(formatAmount(-1_234)).not.toContain("-");
    expect(formatYen(-1_234)).toBe("−¥1,234");
    expect(formatYen(-1_234)).not.toContain("-");
  });

  it("¥ を前に付ける。符号は ¥ の外側", () => {
    expect(formatYen(0)).toBe("¥0");
    expect(formatYen(380_000)).toBe("¥380,000");
    expect(formatYen(-200_000)).toBe("−¥200,000");
  });

  it("符号を必ず付ける形", () => {
    expect(formatSigned(50_000)).toBe("+50,000");
    expect(formatSigned(-50_000)).toBe("−50,000");
    expect(formatSigned(0)).toBe("+0");
  });

  it("小数が渡っても円未満を丸めて表示する", () => {
    expect(formatAmount(1_234.4)).toBe("1,234");
    expect(formatAmount(1_234.5)).toBe("1,235");
  });

  it("マイナス0は符号を付けない", () => {
    expect(formatAmount(-0)).toBe("0");
    expect(formatYen(-0)).toBe("¥0");
  });
});

describe("日付の表示", () => {
  it("月/日にする。先頭の0は落とす", () => {
    expect(formatMonthDay("2026-09-14")).toBe("9/14");
    expect(formatMonthDay("2026-01-01")).toBe("1/1");
    expect(formatMonthDay("2026-12-31")).toBe("12/31");
  });

  it("年月のラベル", () => {
    expect(formatYearMonthLabel("2026-09")).toBe("2026年9月");
    expect(formatYearMonthLabel("2026-01")).toBe("2026年1月");
    expect(formatYearMonthLabel("2026-12")).toBe("2026年12月");
  });
});
