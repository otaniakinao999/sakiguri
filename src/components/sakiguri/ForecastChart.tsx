"use client";

import * as React from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { Yen } from "@/core/types";
import { formatYen } from "@/lib/format";

export interface ForecastPoint {
  /** エポックミリ秒。XAxis を時間軸で使うため */
  t: number;
  /** 本日まで。それより先は null */
  actual: Yen | null;
  /** 本日から。本日の点は両方に入れて線を繋ぐ */
  forecast: Yen | null;
}

export interface ForecastMarker {
  t: number;
  label: string;
  value: Yen;
  /** 右端に近い点はラベルを左に出す */
  side: "left" | "right";
}

export interface ForecastChartProps {
  points: ForecastPoint[];
  /** 本日の位置（縦の破線） */
  todayT: number;
  defenseLine: Yen;
  markers: ForecastMarker[];
  /** 生活防衛ラインを割る最低点。ラベルは付けず、点だけ打つ（Figma 2029:119）。 */
  lowPoint?: { t: number; value: Yen } | null;
  height?: number;
}

interface MarkerLabelProps extends Omit<ForecastMarker, "t"> {
  /** Recharts が ReferenceDot の label に注入する */
  viewBox?: { x: number; y: number };
}

/** 点の横に2行。右端に近い点は左側に出す。 */
function MarkerLabel({ label, value, side, viewBox }: MarkerLabelProps) {
  if (!viewBox) return null;
  const dx = side === "right" ? 12 : -12;
  const anchor = side === "right" ? "start" : "end";
  return (
    <g>
      <text
        x={viewBox.x + dx}
        y={viewBox.y - 24}
        textAnchor={anchor}
        fontSize={12}
        fill="var(--muted-foreground)"
      >
        {label}
      </text>
      <text
        x={viewBox.x + dx}
        y={viewBox.y - 8}
        textAnchor={anchor}
        fontSize={12}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {formatYen(value)}
      </text>
    </g>
  );
}

/**
 * ForecastChart — docs/design/screens.md 01「Forecast timeline」
 *
 * 実績は実線、予測は破線、生活防衛ラインは水平の破線で、下の領域を塗る。
 * 色は tokens.css の --chart-* を SVG 属性として渡す。
 */
export function ForecastChart({
  points,
  todayT,
  defenseLine,
  markers,
  lowPoint = null,
  height = 264,
}: ForecastChartProps) {
  const firstT = points[0]?.t ?? todayT;
  const lastT = points[points.length - 1]?.t ?? todayT;

  const monthTicks = React.useMemo(() => {
    const ticks: number[] = [];
    const d = new Date(firstT);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= lastT) {
      ticks.push(d.getTime());
      d.setMonth(d.getMonth() + 1);
    }
    return ticks;
  }, [firstT, lastT]);

  const values = points.map((p) => p.actual ?? p.forecast ?? 0);
  const min = Math.min(...values, defenseLine);
  const max = Math.max(...values);
  const low = min - (max - min) * 0.18;
  const high = max + (max - min) * 0.3;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 36, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[firstT, lastT]}
            ticks={monthTicks}
            interval={0}
            tickFormatter={(t: number) => `${new Date(t).getMonth() + 1}月`}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis hide domain={[low, high]} />

          <ReferenceArea
            y1={low}
            y2={defenseLine}
            fill="var(--chart-defense-zone)"
            fillOpacity={1}
          />
          <ReferenceLine
            y={defenseLine}
            stroke="var(--chart-defense)"
            strokeDasharray="6 4"
            label={{
              value: `生活防衛ライン ${formatYen(defenseLine)}`,
              position: "insideTopLeft",
              fill: "var(--chart-defense)",
              fontSize: 12,
            }}
          />
          <ReferenceLine x={todayT} stroke="var(--border)" strokeDasharray="3 3" />

          <Line
            type="linear"
            dataKey="actual"
            stroke="var(--chart-actual)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="linear"
            dataKey="forecast"
            stroke="var(--chart-forecast)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />

          {lowPoint && (
            <ReferenceDot
              x={lowPoint.t}
              y={lowPoint.value}
              r={6}
              fill="var(--chart-defense)"
              stroke="var(--background)"
              strokeWidth={2}
            />
          )}

          {markers.map((m) => (
            <ReferenceDot
              key={`${m.t}-${m.label}`}
              x={m.t}
              y={m.value}
              r={5}
              fill="var(--background)"
              stroke="var(--chart-forecast)"
              strokeWidth={2}
              label={<MarkerLabel label={m.label} value={m.value} side={m.side} />}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
