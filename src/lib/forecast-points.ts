/**
 * 残高系列をグラフの点列にする
 *
 * ダッシュボード（01）とキャッシュフロー（02）が同じグラフを描く。
 * **2箇所に書かない**（CLAUDE.md §2.8）。
 */

import type { BalanceRow } from "@/core/balance";
import type { DateStr } from "@/core/types";
import type { ForecastPoint } from "@/components/sakiguri/ForecastChart";

/** DateStr をグラフの横軸（エポックミリ秒）に。ローカル時刻で揃える */
export function msOf(date: DateStr): number {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  ).getTime();
}

/**
 * 実線は実績系列の終端まで、破線はそこから。**今日を直接見ない。**
 *
 * `actualEnd` は max(最後の実績, 今日)（balance.ts 手順4）なので、ふだんは
 * 今日と同じで Figma のとおり今日から破線になる。違うのは未来日付の実績が
 * あるときで、そこまで実線が伸びる。今日で切ると、利用者が入れた実績が
 * 線から消える。
 *
 * 継ぎ目の1点は実線にも破線にも入れる。でないと線が切れる。
 */
export function buildForecastPoints(
  rows: readonly BalanceRow[],
  actualEnd: DateStr,
  from: DateStr,
  to: DateStr,
): ForecastPoint[] {
  return rows
    .filter((row) => row.date >= from && row.date <= to)
    .map((row) => ({
      t: msOf(row.date),
      actual: row.act,
      forecast: row.date >= actualEnd ? row.proj : null,
    }));
}
