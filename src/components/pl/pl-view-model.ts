/**
 * 年月別 収支の行を ProfitLossView の形に移す（SC-04）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-5、docs/design/screens.md 03
 *
 * **計算し直さない。** `buildPLDisplay`（lib/pl-view.ts）が作った値を
 * 並べ替えるだけ。純関数なので、フィクスチャから検査できる。
 */

import type { Yen } from "@/core/types";
import { diffTone, PL_GROUP_LABELS, type PLDisplay, type PLDisplayRow } from "@/lib/pl-view";

import type { PLViewRow } from "./ProfitLossView";

/** 列の見出し。1月〜12月 ＋ 年計 */
export const PL_COLUMNS = [
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
  "年計",
];

/**
 * 行を Figma 2031:256 の並びにする。
 *
 * **既存の並びと違う。** `buildPLDisplay` は「グループ計 → その下に費目」
 * の順で、グループの行が合計を持っている。Figma は
 * 「グループ見出し（値は空）→ 費目 → ◯◯ 計」の順。
 * **値は作り直さない。** グループ行の値をそのまま 計 の行に移すだけ。
 */
export function buildPLViewRows(display: PLDisplay): PLViewRow[] {
  const out: PLViewRow[] = [];
  let pending: PLDisplayRow | null = null;

  const flush = () => {
    if (!pending) return;
    out.push(toRow(pending, "subtotal", `${labelOf(pending)} 計`, display));
    pending = null;
  };

  for (const row of display.rows) {
    if (row.kind === "group") {
      flush();
      /* 見出しの行。値は持たない（Figma の帯は空欄） */
      out.push({
        key: `${row.key}-head`,
        kind: "group",
        label: labelOf(row),
        values: PL_COLUMNS.map(() => null),
      });
      pending = row;
      continue;
    }
    if (row.kind === "net") {
      flush();
      out.push(toRow(row, "total", display.netLabel, display));
      continue;
    }
    out.push(toRow(row, "item", row.label, display));
  }
  flush();
  return out;
}

/**
 * 当初予算を添えるかどうか。
 *
 * **見込みと同じ月には出さない**（PLDisplayRow.planMonthly の仕様）。
 * `buildPLDisplay` は生の予定額をそのまま返すので、間引きはここでやる。
 * 以前はこの判定が描画の中にあり、純関数から見えなかった。
 * 0 も出さない。「¥0 予¥0」が12ヶ月ぶん並ぶ。
 */
function keepPlan(plan: Yen | null, value: Yen | null): Yen | null {
  if (plan === null || plan === 0) return null;
  return plan === value ? null : plan;
}

function labelOf(row: PLDisplayRow): string {
  return row.group ? PL_GROUP_LABELS[row.group] : row.label;
}

function toRow(
  row: PLDisplayRow,
  kind: PLViewRow["kind"],
  label: string,
  display: PLDisplay,
): PLViewRow {
  const values = [...row.monthly, row.yearTotal];
  return {
    key: `${row.key}-${kind}`,
    kind,
    label,
    values,
    /* 年計には添えない。当初予算は月ごとの話 */
    planValues: row.planMonthly
      ? [...row.planMonthly.map((plan, i) => keepPlan(plan, row.monthly[i])), null]
      : undefined,
    tones: display.mode === "diff" ? values.map((v) => diffTone(v)) : undefined,
  };
}
