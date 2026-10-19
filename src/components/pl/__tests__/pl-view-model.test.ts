import { describe, expect, it } from "vitest";

import { actualToEvent } from "@/core/cash";
import { buildForecast } from "@/core/forecast";
import { buildPLMatrix } from "@/core/pl";
import {
  FIXTURE_ACTUALS,
  FIXTURE_ASOF,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { buildPLDisplay } from "@/lib/pl-view";
import { forecastEnd } from "@/lib/period";

import { buildPLViewRows, PL_COLUMNS } from "../pl-view-model";

/**
 * SC-04 の行の並び
 *
 * **並べ替えしかしていないことを押さえる。** 値を作り直していたら、
 * 年月別 収支とキャッシュフローで違う数字が出る。
 */

const forecast = buildForecast(
  { recurring: FIXTURE_RECURRING, oneoffs: FIXTURE_ONEOFFS, overrides: {} },
  FIXTURE_ASOF,
  forecastEnd(FIXTURE_ASOF),
);

const matrix = buildPLMatrix({
  forecast,
  actuals: FIXTURE_ACTUALS.map(actualToEvent),
  year: 2026,
  scope: "all",
  today: FIXTURE_TODAY,
});

const display = buildPLDisplay(matrix, "mixed", FIXTURE_TODAY);
const rows = buildPLViewRows(display);

describe("buildPLViewRows", () => {
  it("列は12ヶ月＋年計の13", () => {
    expect(PL_COLUMNS).toHaveLength(13);
    expect(PL_COLUMNS[0]).toBe("1月");
    expect(PL_COLUMNS[12]).toBe("年計");
    expect(rows.every((r) => r.values.length === 13)).toBe(true);
  });

  it("並びは 見出し → 費目 → 計、最後に差引（Figma 2031:256）", () => {
    const kinds = rows.map((r) => r.kind);
    expect(kinds[0]).toBe("group");
    expect(kinds.at(-1)).toBe("total");

    /* 見出しの直後は費目。計の直後は見出しか差引 */
    for (const [i, kind] of kinds.entries()) {
      if (kind === "group") expect(kinds[i + 1]).toBe("item");
      if (kind === "subtotal" && i + 1 < kinds.length) {
        expect(["group", "total"]).toContain(kinds[i + 1]);
      }
    }
  });

  it("グループの見出しは値を持たない（帯は空欄）", () => {
    const heads = rows.filter((r) => r.kind === "group");
    expect(heads).toHaveLength(3);
    expect(heads.map((r) => r.label)).toEqual(["収入", "固定費", "変動費"]);
    expect(heads.every((r) => r.values.every((v) => v === null))).toBe(true);
  });

  it("計の行は「◯◯ 計」。**値を作り直さない**", () => {
    const subtotals = rows.filter((r) => r.kind === "subtotal");
    expect(subtotals.map((r) => r.label)).toEqual(["収入 計", "固定費 計", "変動費 計"]);

    /* buildPLDisplay のグループ行の値がそのまま移っていること */
    for (const subtotal of subtotals) {
      const source = display.rows.find(
        (r) => r.kind === "group" && `${r.key}-subtotal` === subtotal.key,
      );
      expect(source).toBeDefined();
      expect(subtotal.values).toEqual([...source!.monthly, source!.yearTotal]);
    }
  });

  it("最後の行は差引（**収支ではない**。Figma と screens.md に合わせた）", () => {
    const total = rows.at(-1)!;
    expect(total.kind).toBe("total");
    expect(total.label).toBe("差引");
  });

  it("年計は12ヶ月の合計", () => {
    for (const row of rows) {
      if (row.kind === "group") continue;
      const months = row.values.slice(0, 12);
      const sum = months.reduce<number>((n, v) => n + (v ?? 0), 0);
      expect(row.values[12]).toBe(sum);
    }
  });

  it("**当初予算は見込みと違う月にだけ添える**", () => {
    /* buildPLDisplay は生の予定額をそのまま返す。間引かないと
       「¥0 予¥0」が12ヶ月ぶん並ぶ（実際に並んだ）。
       以前はこの判定が描画の中にあり、純関数から見えなかった */
    let annotated = 0;
    for (const row of rows) {
      if (!row.planValues) continue;
      for (const [i, plan] of row.planValues.entries()) {
        if (plan === null) continue;
        annotated += 1;
        expect(plan).not.toBe(0);
        expect(plan).not.toBe(row.values[i]);
      }
    }
    /* フィクスチャには実績が1件あるので、必ず1つ以上ずれる月がある */
    expect(annotated).toBeGreaterThan(0);
  });

  it("当初予算は年計に添えない（月ごとの話）", () => {
    for (const row of rows) {
      if (!row.planValues) continue;
      expect(row.planValues).toHaveLength(13);
      expect(row.planValues[12]).toBeNull();
    }
  });

  it("差異モードのときだけ色が付く", () => {
    expect(rows.every((r) => r.tones === undefined)).toBe(true);

    const diff = buildPLViewRows(buildPLDisplay(matrix, "diff", FIXTURE_TODAY));
    const withTones = diff.filter((r) => r.kind !== "group");
    expect(withTones.length).toBeGreaterThan(0);
    expect(withTones.every((r) => r.tones?.length === 13)).toBe(true);
  });

  it("key が重複しない", () => {
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
