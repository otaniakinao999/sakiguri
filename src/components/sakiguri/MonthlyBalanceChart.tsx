"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { Yen } from "@/core/types";
import { formatYen } from "@/lib/format";

export interface MonthlyBalancePoint {
  /** 整形済み。例：2026年9月 */
  label: string;
  /** 月末の予測残高 */
  closing: Yen;
  /** その月の最後の実績残高。実績が尽きた先は null */
  actual: Yen | null;
  inflow: Yen;
  /** 正の数で渡す。棒は下向きに描く */
  outflow: Yen;
  /** 月中の最低残高 */
  lowest: Yen;
}

export interface MonthlyBalanceChartProps {
  points: MonthlyBalancePoint[];
  /** 生活防衛ライン。口座別に見ているときは null（ForecastChart と同じ） */
  defenseLine: Yen | null;
  height?: number;
}

/**
 * 残高推移の「月次」（SC-03）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-03、docs/design/screens.md 02
 *
 * **日次とは出すものが違う。** 日次は日ごとの残高を線で追うが、月次は
 * 月末残高の線に、その月の入金・出金の棒と、月中の最低を重ねる。
 * 月末だけ見ていると「月中に一度割っている月」を見落とすため、
 * 最低の線は落とさない（月次資金繰り表の注記と同じ趣旨）。
 *
 * **Figma 2030:156 はタブだけで中身を描いていない。** v1.0 の
 * BalanceChart が月次で出していたものをそのまま引き継いでいる。
 */
export function MonthlyBalanceChart({
  points,
  defenseLine,
  height = 264,
}: MonthlyBalanceChartProps) {
  /* **棒と残高を同じ軸に載せない。** 載せると軸が出金ぶんマイナスまで
     広がり、残高の線が上に潰れて防衛ラインの帯が画面の半分を覆う
     （旧 BalanceChart がそうなっていた）。棒は別軸にして、縮尺は
     それぞれの値だけで決める */
  const balances = points.flatMap((p) => [p.closing, p.lowest, p.actual ?? p.closing]);
  const line = defenseLine === null ? [] : [defenseLine];
  const min = Math.min(...balances, ...line);
  const max = Math.max(...balances, ...line);
  const low = min - (max - min) * 0.18;
  const high = max + (max - min) * 0.12;

  /* 棒は下半分に収める。残高の線と重ならない高さにする */
  const flowMax = Math.max(...points.map((p) => Math.max(p.inflow, p.outflow)), 1);

  const data = points.map((p) => ({ ...p, outflowDown: -p.outflow }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />

          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            yAxisId="balance"
            domain={[low, high]}
            orientation="right"
            width={88}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatYen(v)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          {/* 棒の軸。目盛りは出さない。高さの比較は月次資金繰り表の数字でする */}
          <YAxis yAxisId="flow" hide domain={[-flowMax * 1.15, flowMax * 3.2]} />

          {defenseLine !== null && (
            <ReferenceArea
              yAxisId="balance"
              y1={low}
              y2={defenseLine}
              fill="var(--chart-defense-zone)"
              fillOpacity={1}
            />
          )}
          {defenseLine !== null && (
            <ReferenceLine
              yAxisId="balance"
              y={defenseLine}
              stroke="var(--chart-defense)"
              strokeDasharray="6 4"
            />
          )}

          <Bar
            yAxisId="flow"
            dataKey="inflow"
            name="入金"
            fill="var(--text-success)"
            fillOpacity={0.25}
            barSize={14}
          />
          <Bar
            yAxisId="flow"
            dataKey="outflowDown"
            name="出金"
            fill="var(--text-destructive)"
            fillOpacity={0.25}
            barSize={14}
          />

          {/* 月中の最低。月末だけ見ていると割った月を見落とす */}
          <Line
            yAxisId="balance"
            type="monotone"
            dataKey="lowest"
            name="月中の最低"
            stroke="var(--chart-defense)"
            strokeWidth={1}
            strokeDasharray="1 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="balance"
            type="monotone"
            dataKey="closing"
            name="予測"
            stroke="var(--chart-forecast)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="balance"
            type="monotone"
            dataKey="actual"
            name="実績（本日まで）"
            stroke="var(--chart-actual)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
