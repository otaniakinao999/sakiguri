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
import {
  formatMonthDay,
  formatSignedYen,
  formatYearMonthLabel,
  formatYen,
} from "@/lib/format";

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

/**
 * ツールチップ（AC-49c）
 *
 * **1つの日付について、残高の金額は1つだけ出す。** 予測系列と実績系列を
 * 並べて金額で印字しない。線は2本のままでよい（CL-3 手順4 の用途は
 * 「線を切る位置を決めること」で、金額の表示ではない）。
 *
 * 実績系列との差は捨てずに「うち未記録の予定」として出す。これは
 * ヘッダーの同名の値を、その日について見たものである。**語と符号を
 * ヘッダーに揃える**（`formatSignedYen`）。揃えないと、同じものを別の
 * 指標だと思わせる。
 */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  const text = String(label ?? "");
  const heading = text.length === 7 ? formatYearMonthLabel(text) : text;

  /* 残高に含まれている、まだ記録されていない予定額。実績系列が
     切れている日（act === null）は差が定義できないので出さない */
  const unrecorded = point.act === null ? null : point.proj - point.act;

  /* 月次では下の月次資金繰り表と同じ語にする。同じ値に2つの名前を
     付けない。日次はヘッダーと同じ「見込み」を使う */
  const rows: { name: string; value: string }[] = [
    {
      name: point.inflow === undefined ? "残高見込み" : "月末残高",
      value: formatYen(point.proj),
    },
  ];
  if (unrecorded !== null && unrecorded !== 0) {
    rows.push({ name: "うち未記録の予定", value: formatSignedYen(unrecorded) });
  }
  if (point.inflow !== undefined) {
    rows.push({ name: "入金", value: formatYen(point.inflow) });
  }
  if (point.outflow !== undefined) {
    rows.push({ name: "出金", value: formatYen(Math.abs(point.outflow)) });
  }
  if (point.lowest !== undefined) {
    rows.push({ name: "月中最低", value: formatYen(point.lowest) });
  }

  return (
    <div className="border-border-base-high bg-surface-base-low rounded-[var(--radius)] border px-8 py-8 text-body-xxs">
      <div className="text-object-base-mid mb-4">{heading}</div>
      {rows.map((row) => (
        <div key={row.name} className="flex justify-between gap-16">
          <span className="text-object-base-mid">{row.name}</span>
          <span className="num text-object-base-high">{row.value}</span>
        </div>
      ))}
    </div>
  );
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
          {/* 残高の金額は1つだけ出す。既定の表示は系列を全部並べる（AC-49c） */}
          <Tooltip content={<ChartTooltip />} />
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
