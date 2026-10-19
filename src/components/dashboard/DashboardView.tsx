import * as React from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/16/solid";

import type { DateStr, Yen } from "@/core/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/v06/tabs";
import {
  ForecastChart,
  type ForecastMarker,
  type ForecastPoint,
} from "@/components/sakiguri/ForecastChart";
import { LedgerRow } from "@/components/sakiguri/LedgerRow";
import { LegendItem } from "@/components/sakiguri/LegendItem";
import { Panel } from "@/components/sakiguri/Panel";
import { TodoRow } from "@/components/sakiguri/TodoRow";
import type { AmountType } from "@/components/sakiguri/Amount";
import type { Category } from "@/components/sakiguri/CategoryTag";
import { formatMonthDayJa, formatSignedYen, formatYen } from "@/lib/format";
import { UNRECORDED_LABEL } from "@/lib/unrecorded";

export interface DashboardTodo {
  id: string;
  /** 整形済み。例：9/27 */
  date: string;
  title: string;
  amount: Yen;
  amountType: AmountType;
  /** 区分が決まらないものは省く（固定／変動を費目から決めない。§3.1.2 適用規則1） */
  category: Category | null;
}

export interface DashboardLedgerEntry {
  label: string;
  value: Yen;
  /** 行の下に小さく出す。カードの「次回引落 10/10 ¥186,200」など */
  note?: string;
}

/**
 * グラフの下に出す1行。警告のときは色が変わる。
 *
 * **文に組み立てず断片で受ける。** 金額だけ等幅で出すため
 * （`prefix` と `suffix` の間に `num` を挟む）。組み立ては
 * dashboard-view-model.ts にあり、そこで検査している。
 */
export interface DashboardAnnotation {
  tone: "muted" | "warning" | "destructive";
  prefix: string;
  /** null なら金額を出さない */
  amount: Yen | null;
  suffix: string;
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
  /** グラフに打つ最低残高の点。無ければ null */
  lowPoint: { date: DateStr; value: Yen } | null;
  /** グラフの下の1行 */
  annotation?: DashboardAnnotation | null;

  /** 期間の切り替え。両方そろえば操作できる。片方でも欠ければ 90日固定 */
  range?: "90" | "6m" | "12m";
  onRangeChange?: (range: string) => void;

  todos: DashboardTodo[];
  /** やることの総数。todos には先頭だけを渡すことがある */
  todoCount: number;
  accounts: DashboardLedgerEntry[];
  cards: DashboardLedgerEntry[];
  /** 現預金 合計。渡さなければ出ない */
  total?: { label: string; value: Yen } | null;

  /* ---- 差し込み口。v0.6.0 の Figma には無いが v1.0 から引き継ぐもの ---- */

  /** Hero の右上。CSVを取り込む */
  heroActions?: React.ReactNode;
  /** 凡例の下。残高の警告とそこからの導線 */
  heroNotice?: React.ReactNode;
  /** やることの先頭。消し込みの警告（FR-43） */
  notices?: React.ReactNode;
  /** やることパネルの右上。消し込む */
  todoAction?: React.ReactNode;
  /** 各行の操作。渡さなければ操作列は出ない */
  rowAction?: (todo: DashboardTodo) => React.ReactNode;
  /** 画面の最後の注記（要件定義書 §7 制約3） */
  footer?: React.ReactNode;
}

const ANNOTATION_TONE: Record<DashboardAnnotation["tone"], string> = {
  muted: "text-muted-foreground",
  warning: "text-fg-warning",
  destructive: "text-fg-destructive",
};

/**
 * ダッシュボード（SC-02）の見た目
 *
 * 一次情報：docs/design/screens.md 01（Figma 2029:60）
 *
 * **計算をしない。** 値はすべて props で受け取る。本番は DashboardScreen が、
 * 開発用の /dev/screens/dashboard は固定値が渡す。同じ部品を両方から見る
 * ためで、見た目の確認用に別の実装を作らない。
 *
 * **v0.6.0 の Figma に無いものを差し込み口にしてある**（heroActions /
 * heroNotice / notices / todoAction / rowAction / total / footer）。
 * いずれも要件か受入基準に紐づいていて、落とすと退行する。
 * デザインとの差はこの7つだけで、ADR-0014 に理由を書いてある。
 */
export function DashboardView({
  today,
  balance,
  unrecorded,
  chart,
  lowPoint,
  annotation = null,
  range,
  onRangeChange,
  todos,
  todoCount,
  accounts,
  cards,
  total = null,
  heroActions,
  heroNotice,
  notices,
  todoAction,
  rowAction,
  footer,
}: DashboardViewProps) {
  const lowPointT = lowPoint
    ? new Date(
        Number(lowPoint.date.slice(0, 4)),
        Number(lowPoint.date.slice(5, 7)) - 1,
        Number(lowPoint.date.slice(8, 10)),
      ).getTime()
    : 0;

  const controlled = range !== undefined && onRangeChange !== undefined;

  return (
    <>
      {/* Hero — 2029:88。Main の全幅。パネルではない */}
      <section className="bg-background px-32 pt-32 pb-24">
        <div className="flex flex-wrap items-start justify-between gap-32">
          <div className="flex flex-col gap-4">
            <span className="t-body-sm text-muted-foreground">
              今日の残高（{formatMonthDayJa(today)}）
            </span>
            <div className="flex flex-wrap items-baseline gap-16">
              <span className="num t-balance text-foreground">{formatYen(balance)}</span>
              {/* AC-49d：件数を並べない。件数はやることの見出しが唯一の出しどころ */}
              {unrecorded !== null && (
                <span className="t-body-sm text-fg-primary">
                  {UNRECORDED_LABEL} <span className="num">{formatSignedYen(unrecorded)}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-12">
            <Tabs
              {...(controlled
                ? { value: range, onValueChange: onRangeChange }
                : { defaultValue: "90" })}
            >
              <TabsList>
                <TabsTrigger value="90">90日</TabsTrigger>
                <TabsTrigger value="6m">6ヶ月</TabsTrigger>
                <TabsTrigger value="12m">12ヶ月</TabsTrigger>
              </TabsList>
            </Tabs>
            {heroActions}
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

        {annotation && (
          <div className="mt-4 flex justify-end">
            <div className="flex items-center gap-8 rounded-sm border border-border bg-background px-12 py-6">
              {annotation.tone !== "muted" && (
                <ExclamationTriangleIcon
                  aria-hidden
                  className={`size-16 shrink-0 ${ANNOTATION_TONE[annotation.tone]}`}
                />
              )}
              <span className={`t-body-sm ${ANNOTATION_TONE[annotation.tone]}`}>
                {annotation.prefix}
                {annotation.amount !== null && (
                  <span className="num">{formatYen(annotation.amount)}</span>
                )}
                {annotation.suffix}
              </span>
            </div>
          </div>
        )}

        <div className="mt-16 flex flex-wrap items-center gap-24">
          <LegendItem series="actual" label="実績" />
          <LegendItem series="forecast" label="予測（予定から計算）" />
          <LegendItem series="defense" label="生活防衛ライン" />
        </div>

        {heroNotice ? <div className="mt-16">{heroNotice}</div> : null}
      </section>

      {/* Body — 2029:133 */}
      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 pt-24 pb-32 wide:flex-row">
        <Panel
          title="やること"
          count={`${todoCount}件`}
          action={todoAction}
          className="min-w-0 flex-1 self-start"
        >
          {notices}

          {todos.length === 0 ? (
            <p className="py-24 text-center t-body-sm text-muted-foreground">
              未入力はありません。
            </p>
          ) : (
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
                  actions={rowAction ? rowAction(t) : undefined}
                />
              ))}
            </div>
          )}

          {todoCount > todos.length && (
            <p className="t-body-sm text-muted-foreground">
              ほかに{todoCount - todos.length}件あります。
            </p>
          )}

          <p className="t-body-sm text-muted-foreground">
            予定額のまま予測に残っています。実績を入れて消し込むか、支払日を
            ずらしてください。残しておくと残高を実際より低く見積もります。
          </p>
        </Panel>

        <Panel title="口座・カード" className="shrink-0 self-start wide:w-ledger">
          <div className="flex flex-col">
            {accounts.map((a) => (
              <LedgerRow key={a.label} label={a.label} value={a.value} />
            ))}

            {total && (
              <>
                <hr className="my-8 border-t border-border" />
                <div className="flex items-center justify-between gap-16 py-4">
                  <span className="t-label text-foreground">{total.label}</span>
                  <span className="num t-label text-foreground">{formatYen(total.value)}</span>
                </div>
              </>
            )}

            {cards.length > 0 && <hr className="my-12 border-t border-border" />}
            {cards.map((c) => (
              <div key={c.label} className="flex flex-col">
                <LedgerRow label={c.label} value={c.value} type="expense" />
                {c.note ? (
                  <span className="-mt-4 pb-4 t-body-sm text-muted-foreground">{c.note}</span>
                ) : null}
              </div>
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

      {footer ? <div className="bg-muted px-32 pb-32">{footer}</div> : null}
    </>
  );
}
