import * as React from "react";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@heroicons/react/16/solid";

import type { DateStr, Yen } from "@/core/types";
import { Button } from "@/components/ui/v06/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/v06/tabs";
import { Callout } from "@/components/sakiguri/Callout";
import {
  ForecastChart,
  type ForecastMarker,
  type ForecastPoint,
} from "@/components/sakiguri/ForecastChart";
import { LedgerRow } from "@/components/sakiguri/LedgerRow";
import { LegendItem } from "@/components/sakiguri/LegendItem";
import { Panel } from "@/components/sakiguri/Panel";
import { TodoRow } from "@/components/sakiguri/TodoRow";
import type { Category } from "@/components/sakiguri/CategoryTag";
import { formatMonthDayJa, formatSignedYen, formatYen } from "@/lib/format";
import { UNRECORDED_LABEL } from "@/lib/unrecorded";

export interface DashboardTodo {
  id: string;
  /** 整形済み。例：9/27 */
  date: string;
  title: string;
  amount: Yen;
  amountType: "income" | "expense";
  category: Category;
}

export interface DashboardViewProps {
  today: DateStr;
  balance: Yen;
  /** 消し込みが済んでいれば null。0 を渡さない（AC-49b） */
  unrecorded: Yen | null;
  chart: {
    points: ForecastPoint[];
    todayT: number;
    defenseLine: Yen;
    markers: ForecastMarker[];
  };
  /** 生活防衛ラインを割る見込みが無ければ null */
  lowPoint: { date: DateStr; value: Yen } | null;
  /** 60日以上前の未処理がなければ null */
  staleCount: number | null;
  todos: DashboardTodo[];
  accounts: Array<{ label: string; value: Yen }>;
  cards: Array<{ label: string; value: Yen }>;
}

/**
 * ダッシュボード（SC-02）の見た目
 *
 * 一次情報：docs/design/screens.md 01（Figma 2029:60）
 *
 * **計算をしない。** 値はすべて props で受け取る。実画面は
 * DashboardScreen が、開発用の /dev/screens/dashboard は固定値が渡す。
 * 同じ部品を両方から見るためで、見た目の確認用に別の実装を作らない。
 *
 * Hero は Main の全幅（2029:88 は 1200×473 でパネルではない）。
 */
export function DashboardView({
  today,
  balance,
  unrecorded,
  chart,
  lowPoint,
  staleCount,
  todos,
  accounts,
  cards,
}: DashboardViewProps) {
  /* 注記の日付から点の位置を作る。グラフは t（エポックms）で引くため。 */
  const lowPointT = lowPoint
    ? new Date(
        Number(lowPoint.date.slice(0, 4)),
        Number(lowPoint.date.slice(5, 7)) - 1,
        Number(lowPoint.date.slice(8, 10)),
      ).getTime()
    : 0;

  return (
    <>
      {/* Hero — 2029:88 */}
      <section className="bg-background px-32 pt-32 pb-24">
        <div className="flex flex-wrap items-start justify-between gap-32">
          <div className="flex flex-col gap-4">
            <span className="t-body-sm text-muted-foreground">
              今日の残高（{formatMonthDayJa(today)}）
            </span>
            <div className="flex flex-wrap items-baseline gap-16">
              <span className="num t-balance text-foreground">{formatYen(balance)}</span>
              {unrecorded !== null && (
                <span className="t-body-sm text-fg-primary">
                  {UNRECORDED_LABEL} <span className="num">{formatSignedYen(unrecorded)}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-12">
            <Tabs defaultValue="90">
              <TabsList>
                <TabsTrigger value="90">90日</TabsTrigger>
                <TabsTrigger value="6m">6ヶ月</TabsTrigger>
                <TabsTrigger value="12m">12ヶ月</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button>
              <ArrowUpTrayIcon />
              CSVを取り込む
            </Button>
          </div>
        </div>

        <div className="mt-16">
          <ForecastChart
            points={chart.points}
            todayT={chart.todayT}
            defenseLine={chart.defenseLine}
            markers={chart.markers}
            lowPoint={lowPoint ? { t: lowPointT, value: lowPoint.value } : null}
          />
        </div>

        {lowPoint && (
          <div className="mt-4 flex justify-end">
            <div className="flex items-center gap-8 rounded-sm border border-border bg-background px-12 py-6">
              <ExclamationTriangleIcon aria-hidden className="size-16 text-fg-warning" />
              <span className="t-body-sm text-fg-warning">
                {formatMonthDayJa(lowPoint.date)}に{" "}
                <span className="num">{formatYen(lowPoint.value)}</span>
                。生活防衛ラインを割る見込みです
              </span>
            </div>
          </div>
        )}

        <div className="mt-16 flex flex-wrap items-center gap-24">
          <LegendItem series="actual" label="実績" />
          <LegendItem series="forecast" label="予測（予定から計算）" />
          <LegendItem series="defense" label="生活防衛ライン" />
        </div>
      </section>

      {/* Body — 2029:133 */}
      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 pt-24 pb-32 wide:flex-row">
        <Panel title="やること" count={`${todos.length}件`} className="min-w-0 flex-1 self-start">
          {staleCount !== null && (
            <Callout tone="info">
              60日以上前の予定が{staleCount}件、消し込まれずに残っています。
            </Callout>
          )}

          <div>
            {todos.map((t, i) => (
              <TodoRow
                key={t.id}
                date={t.date}
                title={t.title}
                amount={t.amount}
                amountType={t.amountType}
                category={t.category}
                status="予定"
                last={i === todos.length - 1}
                actions={
                  <Button variant="outline" size="sm">
                    予定どおり
                  </Button>
                }
              />
            ))}
          </div>

          <p className="t-body-sm text-muted-foreground">
            消し込みが終わるまで、残高は実際より低く出ます。
          </p>
        </Panel>

        <Panel title="口座・カード" className="shrink-0 self-start wide:w-ledger">
          <div className="flex flex-col">
            {accounts.map((a) => (
              <LedgerRow key={a.label} label={a.label} value={a.value} />
            ))}
            {cards.length > 0 && <hr className="my-12 border-t border-border" />}
            {cards.map((c) => (
              <LedgerRow key={c.label} label={c.label} value={c.value} type="expense" />
            ))}
          </div>

          {unrecorded !== null && (
            <p className="t-body-sm text-muted-foreground">
              {UNRECORDED_LABEL} <span className="num">{formatSignedYen(unrecorded)}</span>{" "}
              は、上の残高どちらにも含まれています。
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}
