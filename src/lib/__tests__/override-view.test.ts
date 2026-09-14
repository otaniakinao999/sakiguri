import { describe, expect, it } from "vitest";

import type { OneoffItem, RecurringItem } from "@/core/types";

import { emptyAppData, type AppData } from "../app-data";
import { setOverride } from "../mutations";
import {
  describeOverride,
  listOverrides,
  parseOverrideKey,
} from "../override-view";

const ASOF = "2026-04-01";

const rent: RecurringItem = {
  id: "rent",
  name: "家賃",
  type: "expense",
  costType: "fixed",
  categoryCode: "EXP-01",
  amount: 120_000,
  bizRatio: 0,
  accountId: "a1",
  day: 27,
  months: null,
  active: true,
};

const pc: OneoffItem = {
  id: "pc",
  date: "2026-09-15",
  name: "PC買い替え",
  type: "expense",
  costType: "variable",
  categoryCode: "EXP-07",
  amount: 268_000,
  bizRatio: 80,
  accountId: "a1",
};

function base(): AppData {
  return { ...emptyAppData(ASOF), recurring: [rent], oneoffs: [pc] };
}

describe("parseOverrideKey", () => {
  it("定期項目のキーを分解する", () => {
    expect(parseOverrideKey("r:rent:2026-04-27")).toEqual({
      source: "recurring",
      id: "rent",
      originalDate: "2026-04-27",
    });
  });

  it("id にコロンが入っていても切り出せる", () => {
    expect(parseOverrideKey("r:a:b:c:2026-04-27")).toEqual({
      source: "recurring",
      id: "a:b:c",
      originalDate: "2026-04-27",
    });
  });

  it("UUID の id を扱える", () => {
    const id = "47d6ec8e-04ab-4ee5-8b91-3f47c8d74522";
    expect(parseOverrideKey(`r:${id}:2026-04-27`)).toEqual({
      source: "recurring",
      id,
      originalDate: "2026-04-27",
    });
    expect(parseOverrideKey(`o:${id}`)).toEqual({
      source: "oneoff",
      id,
      originalDate: null,
    });
  });

  it("単発予定のキーを分解する", () => {
    expect(parseOverrideKey("o:pc")).toEqual({
      source: "oneoff",
      id: "pc",
      originalDate: null,
    });
  });

  it("知らない形式は判別しない", () => {
    expect(parseOverrideKey("s:c1|2026-09-10").source).toBeNull();
  });
});

describe("listOverrides", () => {
  it("定期項目の名前と元の日付を引く", () => {
    const data = setOverride(base(), "r:rent:2026-04-27", { date: "2026-05-08" });
    const [entry] = listOverrides(data);

    expect(entry).toMatchObject({
      name: "家賃",
      originalDate: "2026-04-27",
      source: "recurring",
      orphaned: false,
    });
  });

  it("単発予定の名前と日付を引く", () => {
    const data = setOverride(base(), "o:pc", { skipped: true });
    const [entry] = listOverrides(data);

    expect(entry).toMatchObject({
      name: "PC買い替え",
      originalDate: "2026-09-15",
      source: "oneoff",
      orphaned: false,
    });
  });

  it("元の項目が消えていると orphaned になる", () => {
    const data = setOverride(base(), "r:gone:2026-04-27", { skipped: true });
    const [entry] = listOverrides(data);

    expect(entry.name).toBeNull();
    expect(entry.orphaned).toBe(true);
  });

  it("元の日付の順に並ぶ", () => {
    let data = base();
    data = setOverride(data, "o:pc", { skipped: true }); // 2026-09-15
    data = setOverride(data, "r:rent:2026-04-27", { date: "2026-05-08" });

    expect(listOverrides(data).map((e) => e.originalDate)).toEqual([
      "2026-04-27",
      "2026-09-15",
    ]);
  });

  it("何も無ければ空", () => {
    expect(listOverrides(base())).toEqual([]);
  });
});

describe("describeOverride", () => {
  const entry = (override: Parameters<typeof setOverride>[2]) =>
    listOverrides(setOverride(base(), "r:rent:2026-04-27", override))[0];

  it("スキップ", () => {
    expect(describeOverride(entry({ skipped: true }))).toBe("今回は無し");
  });

  it("日付の変更は元の日付からの移動として出す", () => {
    expect(describeOverride(entry({ date: "2026-05-08" }))).toBe(
      "2026-04-27 → 2026-05-08",
    );
  });

  it("金額の変更", () => {
    expect(describeOverride(entry({ amount: 130_000 }))).toBe(
      "金額を 130,000 円に",
    );
  });

  it("両方", () => {
    expect(
      describeOverride(entry({ date: "2026-05-08", amount: 130_000 })),
    ).toBe("2026-04-27 → 2026-05-08 ／ 金額を 130,000 円に");
  });

  it("メモだけ", () => {
    expect(describeOverride(entry({ note: "様子見" }))).toBe("メモのみ");
  });
});

describe("setOverride は undefined を書き込まない", () => {
  it("変えていない項目は記録に残らない", () => {
    /* 日付だけを変えたつもりで金額まで記録すると、あとで定期項目の
       金額を直したときに、この回だけ古い額に固定されてしまう */
    const data = setOverride(base(), "r:rent:2026-04-27", {
      date: "2026-05-08",
      amount: undefined,
      note: undefined,
    });

    expect(data.overrides["r:rent:2026-04-27"]).toEqual({ date: "2026-05-08" });
  });

  it("既にある値は消さない", () => {
    let data = setOverride(base(), "r:rent:2026-04-27", { amount: 130_000 });
    data = setOverride(data, "r:rent:2026-04-27", { date: "2026-05-08" });

    expect(data.overrides["r:rent:2026-04-27"]).toEqual({
      amount: 130_000,
      date: "2026-05-08",
    });
  });
});
