"use client";

/**
 * 残高推移グラフ（FR-11）
 *
 * 一次情報：docs/要件定義書.md §4.3、docs/designsystem.md §1.4
 *   実績は実線、予測は破線。0円ラインと防衛ラインを常時表示し、
 *   今日の位置を縦線で示す。
 *
 * 色と線種は designsystem.md §1.4 のグラフの表で固定されている。
 *   実績残高 gray-100 実線2px ／ 予測残高 blue-100 破線
 *   0円ライン purple-100 実線 ／ 防衛ライン green-100 破線
 *   月間入金 lightblue-100 棒 ／ 月間出金 lightpurple-100 棒
 *   月中最低 lightgreen-100 点線
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BalanceRow } from "@/core/balance";
import type { MonthlyCashflowRow } from "@/core/monthly";
import type { DateStr, Yen } from "@/core/types";
import { formatMonthDay, formatYearMonthLabel, formatYen } from "@/lib/format";

/**
 * グラフの色。
 *
 * Recharts は色を属性値として受け取るため、Tailwind のクラスを使えない。
 * CSS 変数を `var(--...)` で渡す。ここでもリテラルの hex を書かない。
 */
const CHART = {
  actual: "var(--gray-100)",
  projected: "var(--blue-100)",
  zeroLine: "var(--purple-100)",
  reserveLine: "var(--green-100)",
  inflow: "var(--lightblue-100)",
  outflow: "var(--lightpurple-100)",
  lowest: "var(--lightgreen-100)",
  grid: "var(--border-base-low)",
  axis: "var(--border-base-high)",
  tick: "var(--object-base-mid)",
  today: "var(--object-base-high)",
} as const;

export type ChartGrain = "day" | "month";

interface Point {
  label: string;
  proj: Yen;
  act: Yen | null;
  inflow?: Yen;
  outflow?: Yen;
  lowest?: Yen;
}

/** 万・億でまとめた軸のラベル。桁が多いと軸が読めない */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}億`;
  if (abs >= 10_000) return `${(value / 10_000).toFixed(abs >= 1_000_000 ? 0 : 1)}万`;
  return String(Math.round(value));
}

export function BalanceChart({
  grain,
  rows,
  monthly,
  reserveLine,
  today,
}: {
  grain: ChartGrain;
  /** 日次の残高。表示範囲に絞ったもの */
  rows: BalanceRow[];
  /** 月次の集計。表示範囲に絞ったもの */
  monthly: MonthlyCashflowRow[];
  reserveLine: Yen;
  today: DateStr;
}) {
  const data: Point[] =
    grain === "day"
      ? rows.map((r) => ({ label: r.date, proj: r.proj, act: r.act }))
      : monthly.map((m) => {
          const last = rows.filter((r) => r.date.startsWith(m.yearMonth)).at(-1);
          return {
            label: m.yearMonth,
            proj: m.closing,
            act: last?.act ?? null,
            inflow: m.inflow,
            outflow: -m.outflow,
            lowest: m.lowest,
          };
        });

  const lowestProjected = Math.min(0, ...data.map((d) => d.proj));
  const formatLabel = (label: string) =>
    label.length === 7 ? `${Number(label.slice(5, 7))}月` : formatMonthDay(label);

  if (data.length === 0) {
    return (
      <div className="text-object-base-mid flex h-[var(--layout-chart-height)] items-center justify-center text-body-xs">
        表示できるデータがありません。
      </div>
    );
  }

  return (
    <div className="h-[var(--layout-chart-height)]">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tickFormatter={formatLabel}
            tick={{ fontSize: 12, fill: CHART.tick }}
            minTickGap={grain === "day" ? 38 : 4}
            axisLine={{ stroke: CHART.axis }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fontSize: 12, fill: CHART.tick }}
            width={56}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) =>
              value === null ? "—" : formatYen(Number(value))
            }
            labelFormatter={(label) => {
              const text = String(label ?? "");
              return text.length === 7 ? formatYearMonthLabel(text) : text;
            }}
            contentStyle={{
              fontSize: 12,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border-base-high)",
              fontFamily: "var(--family-ui)",
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--family-ui)" }} />

          {/* 残高がマイナスになる帯を薄く塗る */}
          {lowestProjected < 0 && (
            <ReferenceArea
              y1={lowestProjected}
              y2={0}
              fill={CHART.zeroLine}
              fillOpacity={0.07}
            />
          )}

          {/* 0円ラインと防衛ラインは常時表示（要件定義書 §4.3） */}
          <ReferenceLine y={0} stroke={CHART.zeroLine} strokeWidth={1.5} />
          {reserveLine > 0 && (
            <ReferenceLine
              y={reserveLine}
              stroke={CHART.reserveLine}
              strokeDasharray="2 3"
              label={{
                value: "防衛ライン",
                fontSize: 11,
                fill: CHART.reserveLine,
                position: "insideTopLeft",
              }}
            />
          )}

          {/* 今日の位置を縦線で示す（要件定義書 §4.3） */}
          {grain === "day" && (
            <ReferenceLine
              x={today}
              stroke={CHART.today}
              strokeDasharray="3 3"
              label={{
                value: "今日",
                fontSize: 11,
                fill: CHART.today,
                position: "top",
              }}
            />
          )}

          {grain === "month" && (
            <Bar dataKey="inflow" name="入金" fill={CHART.inflow} fillOpacity={0.25} barSize={12} />
          )}
          {grain === "month" && (
            <Bar dataKey="outflow" name="出金" fill={CHART.outflow} fillOpacity={0.25} barSize={12} />
          )}
          {grain === "month" && (
            <Line
              type="monotone"
              dataKey="lowest"
              name="月中最低"
              stroke={CHART.lowest}
              strokeWidth={1}
              strokeDasharray="1 3"
              dot={false}
            />
          )}

          {/* 予測は破線、実績は実線2px（designsystem.md §1.4） */}
          <Line
            type={grain === "day" ? "stepAfter" : "monotone"}
            dataKey="proj"
            name="予測残高"
            stroke={CHART.projected}
            strokeWidth={1.7}
            strokeDasharray="4 3"
            dot={false}
          />
          <Line
            type={grain === "day" ? "stepAfter" : "monotone"}
            dataKey="act"
            name="実績残高"
            stroke={CHART.actual}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
