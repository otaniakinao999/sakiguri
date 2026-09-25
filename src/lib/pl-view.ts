/**
 * 年月別収支の表示モデル（SC-04）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-5 手順5・6、§4.1 SC-04
 * 対応する機能要件：FR-14
 *
 * CL-5 が組み立てた予定側・実績側のマトリクスに、表示モードを当てて
 * 画面に出す形にする。CL-5 そのものは `src/core/pl.ts`。
 */

import { categoryOf } from "@/core/categories";
import { toYearMonth } from "@/core/date";
import { applyMode, PL_GROUPS, type PLGroup, type PLMatrix, type PLMode } from "@/core/pl";
import type { DateStr, Yen, YearMonth } from "@/core/types";
import { formatMonthDay } from "@/lib/format";

export const PL_MODES: readonly { value: PLMode; label: string }[] = [
  { value: "mixed", label: "実績+予定" },
  { value: "plan", label: "予定" },
  { value: "actual", label: "実績" },
  { value: "diff", label: "差異" },
];

export const PL_SCOPES = [
  { value: "all", label: "合算" },
  { value: "household", label: "家計" },
  { value: "business", label: "事業" },
] as const;

export const PL_GROUP_LABELS: Record<PLGroup, string> = {
  income: "収入",
  fixed: "固定費",
  variable: "変動費",
};

/** 1行。グループ計、費目、収支の3種類がある。 */
export interface PLDisplayRow {
  key: string;
  kind: "group" | "category" | "net";
  group: PLGroup | null;
  label: string;
  /** 表示モード適用後の12ヶ月。null はその月に何も出さない */
  monthly: (Yen | null)[];
  /** 画面に出ている値の合計。見えているものを足すと年計になる */
  yearTotal: Yen;
  /**
   * 予実併記（`mixed`）のときに、過去月へ小さく添える予定額。
   * それ以外のモードでは undefined。
   */
  planMonthly?: (Yen | null)[];
}

export interface PLDisplay {
  year: number;
  mode: PLMode;
  /** 1月〜12月 */
  months: YearMonth[];
  /** その月が今月以前か。表示モードの判定に使う */
  isPast: boolean[];
  rows: PLDisplayRow[];
  /** 収支の行のラベル。事業ビューでは「事業所得」 */
  netLabel: string;
  /**
   * 差異モードで、途中までの比較になっている列に添える注記（AC-43）。
   *
   * 当月の差異は「本日までに予定日が来た予定」との比較なので、`予定`
   * モードに出ている月合計とは一致しない。注記が無いと「差異と予定が
   * 合わない」という別の疑問を生む。
   *
   * 当月がその年に含まれないとき（去年・来年を見ているとき）は null。
   */
  asOfNote: { monthIndex: number; label: string } | null;
}

/** 見えている値だけを足す。null は0として数えない。 */
function sum(values: (Yen | null)[]): Yen {
  return values.reduce<Yen>((total, v) => total + (v ?? 0), 0);
}

/**
 * 差異が良い方向かどうか。
 *
 * 収入なら `実績 − 予定`、費用なら `予定 − 実績`。どちらも正が良い方向
 * （CL-5 手順6）。**色は designsystem.md §1.4 の用途マッピングに従う。**
 * 要件定義書は「正の値を良い方向（緑）とする」と書いているが、
 * このデザインシステムでは緑は caution であり、プラスの金額は
 * success-bright（lightblue）である（§1.3、§1.4）。色の一次情報は
 * designsystem.md なので、そちらに合わせる。
 */
export function diffTone(value: Yen | null): "good" | "bad" | null {
  if (value === null || value === 0) return null;
  return value > 0 ? "good" : "bad";
}

/**
 * 表示モードを当てて、画面に出す行の並びを作る。
 *
 * 行は グループ計 → その下に費目 の順。最後に収支。
 * 費目の並びは CL-5 が決めている（費目マスタの掲載順）。
 *
 * @param today 本日。今月の判定と、差異の比較範囲の注記に使う
 */
export function buildPLDisplay(
  matrix: PLMatrix,
  mode: PLMode,
  today: DateStr,
): PLDisplay {
  const currentYearMonth = toYearMonth(today);
  const months = Array.from(
    { length: 12 },
    (_, i) => `${matrix.year}-${String(i + 1).padStart(2, "0")}`,
  );
  const isPast = months.map((m) => m <= currentYearMonth);

  const cells = (
    group: PLGroup,
    plan: Yen[],
    planToDate: Yen[],
    actual: Yen[],
  ): (Yen | null)[] =>
    months.map((_, i) =>
      applyMode(
        mode,
        group,
        { plan: plan[i], planToDate: planToDate[i], actual: actual[i] },
        isPast[i],
      ),
    );

  const rows: PLDisplayRow[] = [];

  for (const group of PL_GROUPS) {
    const planBlock = matrix.plan.groups.find((g) => g.group === group)!;
    const toDateBlock = matrix.planToDate.groups.find((g) => g.group === group)!;
    const actualBlock = matrix.actual.groups.find((g) => g.group === group)!;

    const groupMonthly = cells(
      group,
      planBlock.monthly,
      toDateBlock.monthly,
      actualBlock.monthly,
    );
    rows.push({
      key: `group:${group}`,
      kind: "group",
      group,
      label: PL_GROUP_LABELS[group],
      monthly: groupMonthly,
      yearTotal: sum(groupMonthly),
      planMonthly: mode === "mixed" ? planBlock.monthly : undefined,
    });

    planBlock.rows.forEach((planRow, index) => {
      const actualRow = actualBlock.rows[index];
      const toDateRow = toDateBlock.rows[index];
      const monthly = cells(
        group,
        planRow.monthly,
        toDateRow.monthly,
        actualRow.monthly,
      );
      rows.push({
        key: `category:${group}:${planRow.categoryCode}`,
        kind: "category",
        group,
        label: categoryOf(planRow.categoryCode).name,
        monthly,
        yearTotal: sum(monthly),
        planMonthly: mode === "mixed" ? planRow.monthly : undefined,
      });
    });
  }

  /* 収支。差異モードでは「良い方向が正」を保つため収入と同じ向きで見る */
  const netMonthly = months.map((_, i) =>
    applyMode(
      mode,
      "income",
      {
        plan: matrix.plan.netMonthly[i],
        planToDate: matrix.planToDate.netMonthly[i],
        actual: matrix.actual.netMonthly[i],
      },
      isPast[i],
    ),
  );
  rows.push({
    key: "net",
    kind: "net",
    group: null,
    label: matrix.scope === "business" ? "事業所得" : "収支",
    monthly: netMonthly,
    yearTotal: sum(netMonthly),
    planMonthly: mode === "mixed" ? matrix.plan.netMonthly : undefined,
  });

  const currentIndex = months.indexOf(currentYearMonth);

  return {
    year: matrix.year,
    mode,
    months,
    isPast,
    rows,
    netLabel: matrix.scope === "business" ? "事業所得" : "収支",
    asOfNote:
      mode === "diff" && currentIndex >= 0
        ? {
            monthIndex: currentIndex,
            label: `${formatMonthDay(today)} 時点`,
          }
        : null,
  };
}

/**
 * 選べる年。予定と実績が存在する年をすべて返す。
 *
 * 何も無ければ今年だけを返す。
 */
export function selectableYears(
  dates: readonly string[],
  currentYear: number,
): number[] {
  const years = new Set<number>(dates.map((d) => Number(d.slice(0, 4))));
  years.add(currentYear);
  return [...years].sort((a, b) => a - b);
}
