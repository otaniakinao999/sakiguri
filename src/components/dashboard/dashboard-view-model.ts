/**
 * ダッシュボードの数字を DashboardView の props に移す（SC-02）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-02、docs/design/screens.md 01
 *
 * **純関数にしてある。** 本番の画面は Supabase に繋がないと開けないので、
 * 画面の中に置くと**配線を試す方法が目視しか無くなる。** ここに出して
 * あれば、フィクスチャから同じ関数を通して検査できる
 * （`__tests__/dashboard-view-model.test.ts` と /dev/screens/dashboard-wired）。
 *
 * React を import しない。文言の組み立ては持たず、断片だけ返す。
 */

import type { BalanceSeries } from "@/core/balance";
import { addDays } from "@/core/date";
import type { DateStr, Yen } from "@/core/types";
import type { AmountType } from "@/components/sakiguri/Amount";
import { categoryTagFor } from "@/components/sakiguri/CategoryTag";
import type { ForecastMarker, ForecastPoint } from "@/components/sakiguri/ForecastChart";
import { buildForecastPoints, msOf } from "@/lib/forecast-points";
import { formatMonthDay, formatMonthDayJa, formatYen } from "@/lib/format";
import { DASHBOARD_HORIZON_DAYS, type Dashboard } from "@/lib/dashboard";

import type {
  DashboardAnnotation,
  DashboardLedgerEntry,
  DashboardTodo,
} from "./DashboardView";

/** グラフが遡る日数。実績の形が見えるだけの幅（screens.md 01 のグラフ） */
export const LOOKBACK_DAYS = 30;

/** 一覧に出す上限。残りは件数で伝える */
export const TODO_LIMIT = 12;

export type Range = "90" | "6m" | "12m";

/**
 * 期間タブ（Figma 2029:103）。
 *
 * **最低残高と警告は期間に連動しない。** 要件定義書 §4.1 SC-02 が見るのは
 * 90日で、タブはグラフの横幅だけを変える。連動させると「12ヶ月」を選んだ
 * 瞬間に警告の意味が変わる。
 *
 * 予測系列は基準日から24ヶ月ぶんある（period.ts `FORECAST_HORIZON_MONTHS`）
 * ので、12ヶ月まではそのまま引ける。
 */
export const RANGES: Record<
  Range,
  { days: number; marks: Array<{ days: number; label: string }> }
> = {
  "90": {
    days: DASHBOARD_HORIZON_DAYS,
    marks: [
      { days: 30, label: "30日後" },
      { days: 90, label: "90日後" },
    ],
  },
  "6m": {
    days: 182,
    marks: [
      { days: 91, label: "3ヶ月後" },
      { days: 182, label: "6ヶ月後" },
    ],
  },
  "12m": {
    days: 365,
    marks: [
      { days: 182, label: "6ヶ月後" },
      { days: 365, label: "12ヶ月後" },
    ],
  },
};

export interface DashboardViewModel {
  today: DateStr;
  balance: Yen;
  unrecorded: Yen | null;
  chart: {
    points: ForecastPoint[];
    todayT: number;
    defenseLine: Yen;
    markers: ForecastMarker[];
  };
  lowPoint: { date: DateStr; value: Yen } | null;
  annotation: DashboardAnnotation;
  todos: DashboardTodo[];
  todoCount: number;
  accounts: DashboardLedgerEntry[];
  cards: DashboardLedgerEntry[];
  total: { label: string; value: Yen };
}

export interface DashboardViewModelInput {
  series: BalanceSeries;
  dashboard: Dashboard;
  today: DateStr;
  reserveLine: Yen;
  range: Range;
}

export function buildDashboardViewModel({
  series,
  dashboard,
  today,
  reserveLine,
  range,
}: DashboardViewModelInput): DashboardViewModel {
  const from = addDays(today, -LOOKBACK_DAYS);
  const to = addDays(today, RANGES[range].days);

  const points = buildForecastPoints(series.rows, series.actualEnd, from, to);

  const projAt = (date: DateStr) =>
    series.rows.find((row) => row.date === date)?.proj ?? null;

  const marks = RANGES[range].marks;
  const markers: ForecastMarker[] = [
    { t: msOf(today), label: "今日", value: dashboard.current, side: "right" as const },
    ...marks.map((mark, i) => {
      const date = addDays(today, mark.days);
      const value = projAt(date);
      return value === null
        ? null
        : {
            t: msOf(date),
            label: `${mark.label}（${formatMonthDayJa(date)}）`,
            value,
            /* 右端の点はラベルを左に出す。はみ出すため */
            side: (i === marks.length - 1 ? "left" : "right") as "left" | "right",
          };
    }),
  ].filter((m): m is ForecastMarker => m !== null);

  const { warning, lowest } = dashboard;

  const annotation: DashboardAnnotation =
    warning === null
      ? {
          tone: "muted",
          prefix: `${DASHBOARD_HORIZON_DAYS}日先まで${
            reserveLine > 0 ? "生活防衛ラインを維持できる" : "残高を保てる"
          }見込みです`,
          amount: null,
          suffix: "",
        }
      : {
          tone: warning.kind === "shortfall" ? "destructive" : "warning",
          prefix: `${formatMonthDayJa(warning.date)}に `,
          amount: warning.balance,
          suffix:
            warning.kind === "shortfall"
              ? "。残高がマイナスになる予測です"
              : "。生活防衛ラインを割る見込みです",
        };

  const todos: DashboardTodo[] = dashboard.unfilled.slice(0, TODO_LIMIT).map((plan) => {
    const category = categoryTagFor(plan.categoryCode, plan.costType);
    const amountType: AmountType =
      category === "収入" ? "income" : category === "振替" ? "neutral" : "expense";
    return {
      id: plan.key,
      date: formatMonthDay(plan.date),
      title: plan.name,
      amount: plan.amount,
      amountType,
      category,
    };
  });

  return {
    today,
    balance: dashboard.current,
    /* AC-49b。0件なら金額を出さない */
    unrecorded: dashboard.unrecorded.count > 0 ? dashboard.unrecorded.amount : null,
    chart: { points, todayT: msOf(today), defenseLine: reserveLine, markers },
    lowPoint: warning ? { date: lowest.date, value: lowest.balance } : null,
    annotation,
    todos,
    todoCount: dashboard.unfilled.length,
    accounts: dashboard.accounts.map(({ account, balance }) => ({
      label: account.name,
      value: balance,
    })),
    /* カードは未払残高と、次に来る引落。**次回引落を落とさない。**
       デザインには無いが、口座残高だけ見て足りると思った翌週に
       引落が来るのを防ぐための行 */
    cards: dashboard.cards.map(({ card, due, next }) => ({
      label: `${card.name} 未払`,
      value: due,
      note: next
        ? `次回引落 ${formatMonthDayJa(next.date)} ${formatYen(next.amount)}`
        : "次回引落 —",
    })),
    total: { label: "現預金 合計", value: dashboard.total },
  };
}
