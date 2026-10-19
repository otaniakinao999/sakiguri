/**
 * PageHeader 右側の残高サマリー
 *
 * Figma 2030:97 / 2031:256 のどちらにも同じ4つが出ている。**02 と 03 で
 * 別々に組まない**（CLAUDE.md §2.8）。
 *
 * **ダッシュボードと同じ系列から取る。** 画面ごとに実績系列を使ったり
 * 予測系列を使ったりすると、画面を移っただけで残高が変わる（AC-49）。
 */

import type { BalanceSeries } from "@/core/balance";
import { addDays } from "@/core/date";
import { isCard } from "@/core/types";
import type { Account, DateStr, Yen } from "@/core/types";
import type { PageHeaderStat } from "@/components/sakiguri/PageHeader";

/** 「30日後」「90日後」。ダッシュボードの見通しと同じ刻み */
export const HEADER_HORIZONS = [30, 90] as const;

export function buildHeaderStats(
  series: BalanceSeries,
  accounts: readonly Account[],
  today: DateStr,
): PageHeaderStat[] {
  const projAt = (date: DateStr): Yen | null =>
    series.rows.find((row) => row.date === date)?.proj ?? null;

  const todayRow = series.rows.find((row) => row.date === today);
  const cardDue = accounts
    .filter(isCard)
    .reduce((sum, card) => sum + (todayRow?.byCard[card.id] ?? card.balance), 0);

  return [
    { label: "今日の残高", value: projAt(today) ?? 0 },
    ...HEADER_HORIZONS.map((days) => ({
      label: `${days}日後`,
      value: projAt(addDays(today, days)) ?? 0,
    })),
    /* 色だけ変える。**符号は付けない**（Figma 2038:1151 も付いていない） */
    { label: "カード未払", value: cardDue, tone: "expense" as const },
  ];
}
