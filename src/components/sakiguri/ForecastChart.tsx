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
  /** 点と吹き出し。キャッシュフロー（02）は空で渡す */
  markers: ForecastMarker[];
  /** 生活防衛ラインを割る最低点。ラベルは付けず、点だけ打つ（Figma 2029:119）。 */
  lowPoint?: { t: number; value: Yen } | null;
  height?: number;
  /**
   * 右端の目盛り。
   * 01 ダッシュボードは出さない（2029:88 に軸が無い）。
   * 02 キャッシュフローは出す（2030:161 に ¥3,000,000 など3つ）。
   */
  yAxis?: boolean;
  /** 縦線に添える語。02 は「今日」。01 は添えない */
  todayLabel?: string;
  /**
   * 防衛ラインの額をグラフの中に書くか。
   * 01 は中に書く。02 は凡例が「生活防衛ライン ¥1,500,000」まで書くので
   * 中には書かない（二重になる）。
   */
  defenseLabel?: boolean;
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
  yAxis = false,
  todayLabel,
  defenseLabel = true,
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

  /**
   * 実線と破線の継ぎ目。
   *
   * 消し込みが遅れていると、同じ日でも実績系列と予測系列の値が違う
   * （その差が「うち未記録の予定」）。放っておくと線が切れて見えるので、
   * 細い縦線で繋ぐ。**差を埋めない。** 段差は事実で、消し込みが
   * 追いつけば自然に消える。
   */
  const seam = React.useMemo(() => {
    const point = points.find(
      (p) => p.actual !== null && p.forecast !== null && p.actual !== p.forecast,
    );
    return point
      ? { t: point.t, from: point.actual as number, to: point.forecast as number }
      : null;
  }, [points]);

  const values = points.map((p) => p.actual ?? p.forecast ?? 0);
  const min = Math.min(...values, defenseLine);
  const max = Math.max(...values);
  const low = min - (max - min) * 0.18;
  const high = max + (max - min) * 0.3;

  /* **目盛りはキリのいい額にする。** domain をそのまま割ると
     ¥2,938,790 のような値が並ぶ（実際に並んだ）。Figma 2030:161 は
     ¥1,800,000 / ¥2,400,000 / ¥3,000,000 で、60万刻み */
  const yTicks = React.useMemo(() => {
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return undefined;
    const raw = (high - low) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step =
      [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((v) => v >= raw) ??
      10 * mag;
    const out: number[] = [];
    for (let v = Math.ceil(low / step) * step; v <= high; v += step) out.push(v);
    return out;
  }, [low, high]);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={points}
          margin={{ top: 36, right: yAxis ? 12 : 8, bottom: 4, left: 8 }}
        >
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
          <YAxis
            domain={[low, high]}
            hide={!yAxis}
            orientation="right"
            width={88}
            ticks={yAxis ? yTicks : undefined}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatYen(v)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />

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
            label={
              defenseLabel
                ? {
                    value: `生活防衛ライン ${formatYen(defenseLine)}`,
                    position: "insideTopLeft",
                    fill: "var(--chart-defense)",
                    fontSize: 12,
                  }
                : undefined
            }
          />
          <ReferenceLine
            x={todayT}
            stroke="var(--border)"
            strokeDasharray="3 3"
            label={
              todayLabel
                ? {
                    value: todayLabel,
                    position: "insideTopLeft",
                    fill: "var(--muted-foreground)",
                    fontSize: 12,
                  }
                : undefined
            }
          />

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

          {seam && (
            <ReferenceLine
              segment={[
                { x: seam.t, y: seam.from },
                { x: seam.t, y: seam.to },
              ]}
              stroke="var(--chart-forecast)"
              strokeWidth={1}
              strokeDasharray="2 2"
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
