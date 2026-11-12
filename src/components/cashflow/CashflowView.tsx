import * as React from "react";
import Link from "next/link";

import type { Yen } from "@/core/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Amount } from "@/components/sakiguri/Amount";
import type { AmountView } from "@/components/sakiguri/amount-view";
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
import { MonthJumpNav } from "@/components/sakiguri/MonthJumpNav";
import { Panel } from "@/components/sakiguri/Panel";
import { StickyBar } from "@/components/sakiguri/StickyBar";
import { PageHeader, type PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { Callout } from "@/components/sakiguri/Callout";
import { StatusChip, type Status } from "@/components/sakiguri/StatusChip";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
} from "@/components/sakiguri/Table";
import { formatSignedYen, formatYen } from "@/lib/format";

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
  /** 月中の最低が生活防衛ラインを割る月。口座別のときは常に false */
  highlight?: boolean;
}

export interface CashflowLedgerEntry {
  id: string;
  /** 整形済み。例：9/25 */
  date: string;
  title: string;
  amount: Yen;
  /** 画面に出す値・符号・色。`amountView` が1箇所で決める（AC-58b） */
  display: AmountView;
  /**
   * 資金移動の向き（「現金 → ○○銀行」。FR-63・AC-70）。
   *
   * **内容の列に添える。備考ではない。** 備考は1行に1つしか出せず
   * （繰延・未入力が先に取る）、向きは落ちてはいけない。
   */
  direction?: string;
  category: Category | null;
  status: Status;
  /**
   * **この行を処理した直後の残高**（要件定義書 §4.2 明細列）。
   *
   * Figma 2030:349 の列には無いが、1件ずつ効いていく様子が読めないと
   * 「いつ足りなくなるか」を行から追えない。絞り込みで隠れた行も
   * 積んだうえでの値なので、連続する2行の差が金額と一致しないことがある。
   */
  balance?: Yen;
  /** 備考。振替・カード引落・繰延・未入力の注記 */
  note?: string;

  /**
   * 月の区切り行。入れると、この行は明細ではなく見出しとして描かれる。
   *
   * **Figma 2030:348 には無い。** 9月と10月が区切り無しで続いている。
   * だが要件定義書 §4.2 は月ごとのまとまりと、月末残高・月中最低を
   * 求めている。落とすと、どの月を見ているのか分からなくなる（ADR-0023）。
   */
  groupLabel?: string;
  closing?: Yen | null;
  lowest?: Yen | null;

  /** 実績の id。`onEditActual` と両方そろうと内容が押せるようになる（FR-41） */
  actualId?: string;

  /**
   * 予定の行から、元の定期項目・単発予定の設定へのリンク（FR-57・AC-63）。
   *
   * **明細の中で予定を編集させない。** させると「この回だけ」と「項目
   * そのもの」のどちらなのかを選ばせることになる。明細で見つかる誤り
   * ―― 振替先の未設定、費目の間違い ―― は項目そのものの誤りであり、
   * この回だけ直しても次回また出る（OI-23）。
   *
   * カード引落（`settle`）は CL-2 の生成物なので元の設定が無く、入らない。
   */
  planHref?: string;
}

/**
 * 口座の日ごとの増減と残高（FR-64・AC-71）。
 *
 * **出納帳と1日ずつ突き合わせるための表である。** 月次資金繰り表は
 * 月単位、残高推移のグラフは合計なので、どちらも「どの日でずれたか」を
 * 答えない（制約11）。
 */
export interface CashflowDailyRow {
  /** 整形済み。例：10/14 */
  date: string;
  delta: Yen;
  balance: Yen;
  /** 件数。「2件」「1件（予定1件）」 */
  note: string;
}

export interface CashflowDaily {
  accountName: string;
  opening: Yen;
  closing: Yen;
  /** 増減の合計。**行から足したもの**（残高の差ではない。AC-71） */
  total: Yen;
  /** 合計と「期末 − 期首」の差。**0 でなければ画面に出す** */
  gap: Yen;
  rows: CashflowDailyRow[];
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
  /**
   * 見ている口座の選択（FR-56・AC-62）。
   *
   * **追従する領域に入る。** 以前は `PageHeader` の右にあったので、
   * 明細の末尾まで送ると「いまどの口座を見ているのか」が画面から消えて
   * いた。月の切り替え（`ledgerMonths`）と同じバーに並べる。
   */
  accountControl?: React.ReactNode;

  chart: {
    points: ForecastPoint[];
    todayT: number;
    /** 口座別に見ているときは null */
    defenseLine: Yen | null;
  };
  /** 残高推移の 日次 / 月次 */
  trend: TabGroup<"daily" | "monthly">;
  /** 月次に切り替えたときに出すもの */
  monthlyChart: MonthlyBalancePoint[];

  months: CashflowMonthRow[];
  /** 表の下の注記。ハイライトした月の名を含む */
  monthsNote: React.ReactNode;

  /**
   * 口座を選んでいるときの日別（FR-64）。合計を見ているときは null。
   *
   * **明細の絞り込みには従わない。** 種別や状態で絞ると増減の合計が
   * 「期末 − 期首」と合わなくなり、AC-71 の留め具が意味を失う。
   */
  accountDaily?: CashflowDaily | null;

  ledger: CashflowLedgerEntry[];
  /** 明細の月へ飛ぶ見出し。view-model が ledger と同じループで作る（要望9） */
  ledgerMonths?: Array<{ id: string; label: string }>;
  /** 入出金予定表の3組のフィルター */
  period: TabGroup<string>;
  categoryFilter: TabGroup<string>;
  kindFilter: TabGroup<string>;

  /** v0.6.0 に無いもの（ADR-0023）。渡さなければ出ない */
  notices?: React.ReactNode;
  footer?: React.ReactNode;
  /** 入出金予定表の見出しに出す集計（要件定義書 §4.2） */
  ledgerTotal?: React.ReactNode;
  /** 期間に「期間を指定」を選んだときの開始月・終了月 */
  periodDetail?: React.ReactNode;
  /**
   * 実績を編集する画面（FR-41・FR-55）。
   *
   * **明細の上ではなく、末尾に置く。** 以前は入出金予定表の上端に箱を
   * 出していたので、下のほうの行を押しても**開いた画面が画面外**にあった。
   * いまは `Modal` が渡ってくる（`fixed` なので置き場所に関わらず画面の
   * 中に出る。AC-60）。
   */
  dialog?: React.ReactNode;
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
  accountControl,
  chart,
  trend,
  monthlyChart,
  months,
  monthsNote,
  accountDaily,
  ledger,
  ledgerMonths,
  period,
  categoryFilter,
  kindFilter,
  notices,
  footer,
  ledgerTotal,
  periodDetail,
  dialog,
  onEditActual,
}: CashflowViewProps) {
  return (
    <>
      <PageHeader
        title="キャッシュフロー"
        subtitle="実績と予定から、日々の残高と月ごとの資金繰りを見ます"
        stats={stats}
      />

      {/* 追従する領域（FR-56・AC-62）。実績一覧と同じ部品を使う（§2.8） */}
      {accountControl || ledgerMonths ? (
        <StickyBar lead={accountControl}>
          {ledgerMonths ? <MonthJumpNav months={ledgerMonths} /> : null}
        </StickyBar>
      ) : null}

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
            {/* 口座別のときは線を引かないので、凡例も出さない */}
            {chart.defenseLine !== null && (
              <LegendItem
                series="defense"
                label={`生活防衛ライン ${formatYen(chart.defenseLine)}`}
              />
            )}
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

        {/* 口座の日ごとの増減と残高（FR-64・AC-71）。
            **出納帳と1日ずつ突き合わせるための表。** 月次資金繰り表は
            月単位、グラフは合計なので、どちらも「どの日でずれたか」を
            答えない（制約11） */}
        <Panel title="口座の日ごとの増減と残高">
          {accountDaily === null || accountDaily === undefined ? (
            <p className="t-body-sm text-muted-foreground">
              口座を選ぶと、その口座の日ごとの増減と残高が出ます。出納帳や
              通帳と1日ずつ突き合わせるための表です。
            </p>
          ) : (
            <>
              <p className="t-body-sm text-muted-foreground">
                {accountDaily.accountName}。この表は上の絞り込みに従いません
                ―― 絞ると増減の合計が残高の動きと合わなくなります。
              </p>

              <Table density="compact">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[26%]" />
                  <col className="w-[26%]" />
                  <col className="w-[34%]" />
                </colgroup>
                <TableHeaderRow>
                  <TableHead>日付</TableHead>
                  <TableHead align="right">増減</TableHead>
                  <TableHead align="right">残高</TableHead>
                  <TableHead>件数</TableHead>
                </TableHeaderRow>
                <tbody>
                  <TableRow fixedHeight>
                    <TableCell kind="group" colSpan={2}>
                      期首残高
                    </TableCell>
                    <TableCell kind="group" align="right">
                      <span className="num">{formatYen(accountDaily.opening)}</span>
                    </TableCell>
                    <TableCell kind="group" />
                  </TableRow>

                  {accountDaily.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-24 text-center text-muted-foreground">
                        この期間に、この口座を動かした行はありません。
                      </TableCell>
                    </TableRow>
                  ) : (
                    accountDaily.rows.map((row) => (
                      <TableRow key={row.date} fixedHeight>
                        <TableCell className="num whitespace-nowrap">{row.date}</TableCell>
                        <TableCell align="right">
                          {/* **増減は符号を必ず付ける。** 0 の行は残高に
                              反映していない振替（`oneSidedReason`） */}
                          <Amount value={row.delta} signed size="table" />
                        </TableCell>
                        <TableCell align="right" className="num whitespace-nowrap">
                          {formatYen(row.balance)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.note}</TableCell>
                      </TableRow>
                    ))
                  )}

                  <TableRow fixedHeight last>
                    {/* **「合計」。** 増減の列には合計を、残高の列には
                        期末残高を置く ―― 行の見出しを「期末残高」に
                        すると、隣の +¥27,000 が残高に読める */}
                    <TableCell kind="group">合計</TableCell>
                    <TableCell kind="group" align="right">
                      <Amount value={accountDaily.total} signed size="table" />
                    </TableCell>
                    <TableCell kind="group" align="right">
                      <span className="num">{formatYen(accountDaily.closing)}</span>
                    </TableCell>
                    <TableCell kind="group" />
                  </TableRow>
                </tbody>
              </Table>

              {/* AC-71 の留め具を画面にも出す。**合うときも出す** ――
                  出ないものだけを見ると、こちらが違う場所を見ている
                  場合と区別が付かない（CLAUDE.md §2.11） */}
              {accountDaily.gap === 0 ? (
                <p className="t-body-sm text-muted-foreground">
                  期首残高 {formatYen(accountDaily.opening)} ＋ 増減の合計{" "}
                  {formatSignedYen(accountDaily.total)} ＝ 期末残高{" "}
                  {formatYen(accountDaily.closing)}。
                </p>
              ) : (
                <Callout tone="error">
                  増減の合計が残高の動きと {formatYen(Math.abs(accountDaily.gap))}{" "}
                  ずれています。どこかの行を二重に数えているか、落としています。
                </Callout>
              )}
            </>
          )}
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

          <Table density="compact">
            {/* 列幅は Figma 2030:349。1088px 中 88 / 364 / 140 / 120 / 96 / 280 */}
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[27%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[24%]" />
            </colgroup>
            <TableHeaderRow>
              <TableHead>日付</TableHead>
              <TableHead>内容</TableHead>
              <TableHead align="right">金額</TableHead>
              <TableHead align="right">残高</TableHead>
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
                    <TableRow
                      key={row.id}
                      id={row.id}
                      fixedHeight
                      last={i === ledger.length - 1}
                      /* 上の月見出しの下に潜らせない */
                      className="scroll-mt-64"
                    >
                      <TableCell kind="group" colSpan={3}>
                        {row.groupLabel}
                      </TableCell>
                      <TableCell kind="group" colSpan={4} align="right">
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
                        ) : row.planHref ? (
                          /* 予定の行は元の設定へ飛ぶ（FR-57・AC-63）。
                             実績の行とは**行き先が違う** ―― あちらは
                             その実績の編集、こちらは項目そのものの設定 */
                          <Link
                            href={row.planHref}
                            className="text-left underline-offset-2 hover:underline focus-visible:outline-ring"
                          >
                            {row.title}
                          </Link>
                        ) : (
                          row.title
                        )}
                        {/* 資金移動の向き（FR-63・AC-70）。合計で見ている
                            ときは符号が付かないので、これが無いと引出しと
                            預け入れの区別が付かない */}
                        {row.direction ? (
                          <span className="block t-body-sm text-muted-foreground">
                            {row.direction}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell align="right">
                        <Amount
                          value={row.display.value}
                          type={row.display.type}
                          signed={row.display.signed}
                          size="table"
                        />
                      </TableCell>
                      {/* 残高は色を付けない。増減ではなく水準なので */}
                      <TableCell align="right" className="num whitespace-nowrap">
                        {row.balance === undefined ? "" : formatYen(row.balance)}
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

      {dialog}
    </>
  );
}
