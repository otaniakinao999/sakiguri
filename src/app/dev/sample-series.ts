/**
 * Figma と見比べるための残高系列（開発用）
 *
 * screens.md 01 / 02 のグラフは同じ系列を描いている。**2箇所に書かない**
 * （CLAUDE.md §2.8）。節の値だけ持ち、間は日割りで埋める。
 *
 * 1/17 の大口出金は decisions.md 未決1（1/16 ¥1,905,200 と
 * 1/18 ¥1,382,500 の辻褄）に従って置いた。
 */

import type { DateStr, Yen } from "@/core/types";
import type { ForecastPoint } from "@/components/sakiguri/ForecastChart";

export const SAMPLE_TODAY: DateStr = "2026-10-18";
export const SAMPLE_DEFENSE_LINE: Yen = 1_500_000;

export const msOf = (d: DateStr) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).getTime();
};

const ANCHORS: Array<[DateStr, Yen]> = [
  ["2026-09-18", 2_980_000],
  ["2026-09-24", 2_962_000],
  ["2026-09-25", 3_292_000],
  ["2026-09-27", 3_197_000],
  ["2026-10-02", 3_120_000],
  ["2026-10-10", 2_933_800],
  ["2026-10-14", 2_880_000],
  [SAMPLE_TODAY, 2_847_300],
  ["2026-11-17", 2_412_800],
  ["2026-12-12", 2_160_000],
  ["2026-12-25", 1_988_000],
  ["2027-01-16", 1_905_200],
  ["2027-01-17", 1_905_200],
  ["2027-01-18", 1_382_500],
  ["2027-02-15", 1_612_000],
];

const DAY = 86_400_000;

export function buildSamplePoints(): ForecastPoint[] {
  const todayT = msOf(SAMPLE_TODAY);
  const out: ForecastPoint[] = [];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [fromDate, fromValue] = ANCHORS[i];
    const [toDate, toValue] = ANCHORS[i + 1];
    const fromT = msOf(fromDate);
    const steps = Math.round((msOf(toDate) - fromT) / DAY);
    for (let s = 0; s < steps; s++) {
      const t = fromT + s * DAY;
      const value = Math.round(fromValue + ((toValue - fromValue) * s) / steps);
      out.push({
        t,
        actual: t <= todayT ? value : null,
        forecast: t >= todayT ? value : null,
      });
    }
  }
  const [lastDate, lastValue] = ANCHORS[ANCHORS.length - 1];
  out.push({ t: msOf(lastDate), actual: null, forecast: lastValue });
  return out;
}
