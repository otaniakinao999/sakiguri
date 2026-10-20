import * as React from "react";

import type { Yen } from "@/core/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/v06/tabs";
import { Amount, type AmountType } from "@/components/sakiguri/Amount";
import { CategoryTag, type Category } from "@/components/sakiguri/CategoryTag";
import {
  ForecastChart,
  type ForecastPoint,
} from "@/components/sakiguri/ForecastChart";
import { LegendItem } from "@/components/sakiguri/LegendItem";
import {
  MonthlyBalanceChart,
  type MonthlyBalancePoint,
} from "@/components/sakiguri/MonthlyBalanceChart";
import { Panel } from "@/components/sakiguri/Panel";
import { PageHeader, type PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { StatusChip, type Status } from "@/components/sakiguri/StatusChip";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
} from "@/components/sakiguri/Table";
import { formatYen } from "@/lib/format";

/* ---------------------------------------------------------------- 型 */

export interface CashflowMonthRow {
  /** 整形済み。例：2026年9月 */
  label: string;
  income: Yen;
  /** 正の数で渡す。表示側が「−」を付ける */
  expense: Yen;
  endBalance: Yen;
  /** 月中の最低残高 */
  lowest: Yen;
  /** 月中の最低が生活防衛ラインを割る月 */
  highlight?: boolean;
}

export interface CashflowLedgerEntry {
  id: string;
  /** 整形済み。例：9/25 */
  date: string;
  title: string;
  amount: Yen;
  amountType: AmountType;
  category: Category | null;
  status: Status;
  /** 備考。振替・カード引落・繰延・未入力の注記 */
  note?: string;

  /**
   * 月の区切り行。入れると、この行は明細ではなく見出しとして描かれる。
   *
   * **Figma 2030:348 には無い。** 9月と10月が区切り無しで続いている。
   * だが要件定義書 §4.2 は月ごとのまとまりと、月末残高・月中最低を
   * 求めている。落とすと、どの月を見ているのか分からなくなる（ADR-0014）。
   */
  groupLabel?: string;
  closing?: Yen | null;
  lowest?: Yen | null;

  /** 実績の id。`onEditActual` と両方そろうと内容が押せるようになる（FR-41） */
  actualId?: string;
}

export interface TabGroup<T extends string> {
  value?: T;
  onChange?: (value: string) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  /** 操作できないときの表示値 */
  defaultValue: T;
}

export interface CashflowViewProps {
  /** PageHeader 右側の残高サマリー */
  stats: PageHeaderStat[];
  headerAction?: React.ReactNode;

  chart: {
    points: ForecastPoint[];
    todayT: number;
    defenseLine: Yen;
  };
  /** 残高推移の 日次 / 月次 */
  trend: TabGroup<"daily" | "monthly">;
  /** 月次に切り替えたときに出すもの */
  monthlyChart: MonthlyBalancePoint[];

  months: CashflowMonthRow[];
  /** 表の下の注記。ハイライトした月の名を含む */
  monthsNote: React.ReactNode;

  ledger: CashflowLedgerEntry[];
  /** 入出金予定表の3組のフィルター */
  period: TabGroup<string>;
  categoryFilter: TabGroup<string>;
  kindFilter: TabGroup<string>;

  /** v0.6.0 に無いもの（ADR-0014）。渡さなければ出ない */
  notices?: React.ReactNode;
  footer?: React.ReactNode;
  /** 入出金予定表の見出しに出す集計（要件定義書 §4.2） */
  ledgerTotal?: React.ReactNode;
  /** 期間に「期間を指定」を選んだときの開始月・終了月 */
  periodDetail?: React.ReactNode;
  /** 明細の上に出す編集フォーム（FR-41） */
  ledgerEditor?: React.ReactNode;
  /** 実績の行を押したとき（FR-41） */
  onEditActual?: (actualId: string) => void;
}

/* ------------------------------------------------------------ 小物 */

/** 値と onChange が両方そろえば操作でき、片方でも欠ければ固定表示。 */
function FilterTabs<T extends string>({ group }: { group: TabGroup<T> }) {
  const controlled = group.value !== undefined && group.onChange !== undefined;
  return (
    <Tabs
      {...(controlled
        ? { value: group.value, onValueChange: group.onChange }
        : { defaultValue: group.defaultValue })}
    >
      <TabsList>
        {group.options.map((o) => (
          <TabsTrigger key={o.value} value={o.value}>
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/* ------------------------------------------------------------ 本体 */

/**
 * キャッシュフロー（SC-03）の見た目
 *
 * 一次情報：docs/design/screens.md 02（Figma 2030:97）
 *
 * **計算をしない。** 値はすべて props で受け取る。本番は CashflowScreen
 * が、開発用の /dev/screens/cashflow は固定値が渡す。
 *
 * screens.md と Figma が食い違う箇所は Figma を採った。
 *   区分フィルターは6つ（screens.md は「入金」が抜けている）
 *   月次資金繰り表の行は 48px（フレーム名は Compact だが描画は既定値）
 * 凡例の文言はダッシュボード（01）と違う。画面ごとの指定に従う。
 */
export function CashflowView({
  stats,
  headerAction,
  chart,
  trend,
  monthlyChart,
  months,
  monthsNote,
  ledger,
  period,
  categoryFilter,
  kindFilter,
  notices,
  footer,
  ledgerTotal,
  periodDetail,
  ledgerEditor,
  onEditActual,
}: CashflowViewProps) {
  return (
    <>
      <PageHeader
        title="キャッシュフロー"
        subtitle="実績と予定から、日々の残高と月ごとの資金繰りを見ます"
        stats={stats}
        action={headerAction}
      />

      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 py-24">
        {notices}

        {/* 残高推移 — 2030:152 */}
        <Panel title="残高推移" action={<FilterTabs group={trend} />}>
          {/* **タブで中身を変える。** 以前はタブが光るだけで、
              日次のグラフのままだった */}
          {(trend.value ?? trend.defaultValue) === "monthly" ? (
            <MonthlyBalanceChart
              points={monthlyChart}
              defenseLine={chart.defenseLine}
            />
          ) : (
            <ForecastChart
              points={chart.points}
              todayT={chart.todayT}
              defenseLine={chart.defenseLine}
              markers={[]}
              yAxis
              todayLabel="今日"
              defenseLabel={false}
            />
          )}
          <div className="flex flex-wrap items-center gap-24">
            <LegendItem series="actual" label="実績（本日まで）" />
            <LegendItem series="forecast" label="予測" />
            <LegendItem
              series="defense"
              label={`生活防衛ライン ${formatYen(chart.defenseLine)}`}
            />
            {(trend.value ?? trend.defaultValue) === "monthly" ? (
              <span className="t-body-sm text-muted-foreground">
                棒は入金と出金、細い破線は月中の最低
              </span>
            ) : null}
          </div>
        </Panel>

        {/* 月次資金繰り表 — 2030:186 */}
        <Panel title="月次資金繰り表">
          <Table>
            <TableHeaderRow>
              <TableHead>月</TableHead>
              <TableHead align="right">入金</TableHead>
              <TableHead align="right">出金</TableHead>
              <TableHead align="right">月末残高</TableHead>
              <TableHead align="right">月中の最低</TableHead>
            </TableHeaderRow>
            <tbody>
              {months.map((m, i) => (
                <TableRow
                  key={m.label}
                  fixedHeight
                  highlight={m.highlight}
                  last={i === months.length - 1}
                >
                  <TableCell kind="row-header">{m.label}</TableCell>
                  <TableCell align="right">
                    <Amount value={m.income} type="income" size="table" />
                  </TableCell>
                  <TableCell align="right">
                    <Amount value={m.expense} type="expense" size="table" />
                  </TableCell>
                  <TableCell align="right">
                    <span className="num t-table">{formatYen(m.endBalance)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="num t-table">{formatYen(m.lowest)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          <p className="t-body-sm text-muted-foreground">{monthsNote}</p>
        </Panel>

        {/* 入出金予定表 — 2030:310 */}
        <Panel
          title="入出金予定表"
          count={ledgerTotal}
          action={<FilterTabs group={period} />}
        >
          <div className="flex flex-wrap items-center gap-12">
            <FilterTabs group={categoryFilter} />
            <FilterTabs group={kindFilter} />
            {periodDetail}
          </div>

          {ledgerEditor}

          <Table density="compact">
            {/* 列幅は Figma 2030:349。1088px 中 88 / 364 / 140 / 120 / 96 / 280 */}
            <colgroup>
              <col className="w-[8%]" />
              <col className="w-[33%]" />
              <col className="w-[13%]" />
              <col className="w-[11%]" />
              <col className="w-[9%]" />
              <col className="w-[26%]" />
            </colgroup>
            <TableHeaderRow>
              <TableHead>日付</TableHead>
              <TableHead>内容</TableHead>
              <TableHead align="right">金額</TableHead>
              <TableHead>区分</TableHead>
              <TableHead>状態</TableHead>
              <TableHead>備考</TableHead>
            </TableHeaderRow>
            <tbody>
              {ledger.length === 0 ? (
                <TableRow last>
                  <TableCell colSpan={6} className="py-24 text-center text-muted-foreground">
                    この条件に合う予定・実績はありません。
                  </TableCell>
                </TableRow>
              ) : (
                ledger.map((row, i) =>
                  row.groupLabel !== undefined ? (
                    <TableRow key={row.id} fixedHeight last={i === ledger.length - 1}>
                      <TableCell kind="group" colSpan={3}>
                        {row.groupLabel}
                      </TableCell>
                      <TableCell kind="group" colSpan={3} align="right">
                        {row.closing !== null && row.closing !== undefined ? (
                          <span className="num">
                            月末残高 {formatYen(row.closing)}
                            {row.lowest !== null && row.lowest !== undefined
                              ? ` ／ 月中の最低 ${formatYen(row.lowest)}`
                              : null}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={row.id} fixedHeight last={i === ledger.length - 1}>
                      <TableCell className="num whitespace-nowrap">{row.date}</TableCell>
                      <TableCell>
                        {row.actualId && onEditActual ? (
                          <button
                            type="button"
                            onClick={() => onEditActual(row.actualId as string)}
                            className="text-left underline-offset-2 hover:underline focus-visible:outline-ring"
                          >
                            {row.title}
                          </button>
                        ) : (
                          row.title
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Amount value={row.amount} type={row.amountType} size="table" />
                      </TableCell>
                      <TableCell>
                        {row.category ? <CategoryTag category={row.category} /> : null}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={row.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.note ?? ""}</TableCell>
                    </TableRow>
                  ),
                )
              )}
            </tbody>
          </Table>
        </Panel>

        {footer}
      </div>
    </>
  );
}
