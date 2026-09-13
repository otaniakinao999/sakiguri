import { describe, expect, it } from "vitest";

import {
  compareDate,
  dayInMonth,
  eachMonth,
  formatYearMonth,
  isLeapYear,
  isWithin,
  lastDayOfMonth,
  parseDate,
  shiftMonth,
  toYearMonth,
} from "../date";

describe("isLeapYear", () => {
  it("4で割り切れる年は閏年", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2028)).toBe(true);
  });

  it("100で割り切れる年は閏年ではない", () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
  });

  it("400で割り切れる年は閏年", () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2400)).toBe(true);
  });

  it("平年", () => {
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2027)).toBe(false);
  });
});

describe("lastDayOfMonth", () => {
  it("各月の末日", () => {
    expect(lastDayOfMonth(2026, 1)).toBe(31);
    expect(lastDayOfMonth(2026, 3)).toBe(31);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 6)).toBe(30);
    expect(lastDayOfMonth(2026, 9)).toBe(30);
    expect(lastDayOfMonth(2026, 11)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it("2月は年によって28日か29日", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
    expect(lastDayOfMonth(1900, 2)).toBe(28);
  });

  it("範囲外の月は投げる", () => {
    expect(() => lastDayOfMonth(2026, 0)).toThrow(RangeError);
    expect(() => lastDayOfMonth(2026, 13)).toThrow(RangeError);
  });
});

describe("parseDate", () => {
  it("'YYYY-MM-DD' を分解する", () => {
    expect(parseDate("2026-09-13")).toEqual({ year: 2026, month: 9, day: 13 });
    expect(parseDate("2026-01-01")).toEqual({ year: 2026, month: 1, day: 1 });
  });

  it("書式が違うものは投げる", () => {
    expect(() => parseDate("2026/09/13")).toThrow(RangeError);
    expect(() => parseDate("2026-9-13")).toThrow(RangeError);
    expect(() => parseDate("2026-09-13T00:00:00Z")).toThrow(RangeError);
    expect(() => parseDate("")).toThrow(RangeError);
  });

  it("存在しない日付は投げる", () => {
    expect(() => parseDate("2026-02-29")).toThrow(RangeError);
    expect(() => parseDate("2026-04-31")).toThrow(RangeError);
    expect(() => parseDate("2026-13-01")).toThrow(RangeError);
    expect(() => parseDate("2026-00-01")).toThrow(RangeError);
    expect(() => parseDate("2026-01-00")).toThrow(RangeError);
  });

  it("閏年の2月29日は通す", () => {
    expect(parseDate("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe("dayInMonth（月末寄せ）", () => {
  it("月末を超える日は月末に丸める", () => {
    expect(dayInMonth(2026, 2, 31)).toBe("2026-02-28");
    expect(dayInMonth(2028, 2, 31)).toBe("2028-02-29");
    expect(dayInMonth(2026, 4, 31)).toBe("2026-04-30");
    expect(dayInMonth(2026, 2, 30)).toBe("2026-02-28");
  });

  it("月末以内の日はそのまま", () => {
    expect(dayInMonth(2026, 4, 27)).toBe("2026-04-27");
    expect(dayInMonth(2026, 1, 31)).toBe("2026-01-31");
    expect(dayInMonth(2026, 12, 1)).toBe("2026-12-01");
  });

  it("範囲外の日は投げる", () => {
    expect(() => dayInMonth(2026, 4, 0)).toThrow(RangeError);
    expect(() => dayInMonth(2026, 4, 32)).toThrow(RangeError);
  });
});

describe("shiftMonth", () => {
  it("月を進める", () => {
    expect(shiftMonth({ year: 2026, month: 9 }, 1)).toEqual({
      year: 2026,
      month: 10,
    });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(shiftMonth({ year: 2026, month: 11 }, 2)).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it("月を戻す", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(shiftMonth({ year: 2026, month: 3 }, -14)).toEqual({
      year: 2025,
      month: 1,
    });
  });

  it("0 は変えない", () => {
    expect(shiftMonth({ year: 2026, month: 6 }, 0)).toEqual({
      year: 2026,
      month: 6,
    });
  });
});

describe("eachMonth", () => {
  it("両端を含めて月を列挙する", () => {
    expect(eachMonth("2026-04-15", "2026-07-03").map(formatYearMonth)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
  });

  it("同じ月なら1件", () => {
    expect(eachMonth("2026-04-01", "2026-04-30").map(formatYearMonth)).toEqual([
      "2026-04",
    ]);
  });

  it("年をまたぐ", () => {
    expect(eachMonth("2026-11-20", "2027-02-05").map(formatYearMonth)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("from が to より後なら空", () => {
    expect(eachMonth("2026-07-01", "2026-04-01")).toEqual([]);
  });
});

describe("toYearMonth / isWithin / compareDate", () => {
  it("年月を取り出す", () => {
    expect(toYearMonth("2026-09-13")).toBe("2026-09");
  });

  it("範囲判定は両端を含む", () => {
    expect(isWithin("2026-04-01", "2026-04-01", "2026-06-30")).toBe(true);
    expect(isWithin("2026-06-30", "2026-04-01", "2026-06-30")).toBe(true);
    expect(isWithin("2026-03-31", "2026-04-01", "2026-06-30")).toBe(false);
    expect(isWithin("2026-07-01", "2026-04-01", "2026-06-30")).toBe(false);
  });

  it("日付の比較は辞書順で時系列順になる", () => {
    expect(compareDate("2026-04-01", "2026-04-02")).toBe(-1);
    expect(compareDate("2026-04-02", "2026-04-01")).toBe(1);
    expect(compareDate("2026-04-01", "2026-04-01")).toBe(0);
    expect(compareDate("2026-09-30", "2026-10-01")).toBe(-1);
  });
});
