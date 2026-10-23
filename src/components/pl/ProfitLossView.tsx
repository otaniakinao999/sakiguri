import * as React from "react";

import type { Yen } from "@/core/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/v06/tabs";
import { PageHeader, type PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { Panel } from "@/components/sakiguri/Panel";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
  type TableCellKind,
} from "@/components/sakiguri/Table";
import { formatAmount, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PLRowKind = "group" | "item" | "subtotal" | "total";

export interface PLViewRow {
  key: string;
  kind: PLRowKind;
  label: string;
  /** 1月〜12月 ＋ 年計。null はその月に何も出さない */
  values: (Yen | null)[];
  /** 当初予算の添え字（実績+予定のとき、見込みと違う月だけ） */
  planValues?: (Yen | null)[];
  /** 差異モードの色。good は正、bad は負 */
  tones?: ("good" | "bad" | null)[];
}

export interface PLSelect<T extends string> {
  value?: T;
  onChange?: (value: string) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  defaultValue: T;
}

export interface ProfitLossViewProps {
  stats: PageHeaderStat[];
  /** 例：年月別 収支（2026年度・合算） */
  panelTitle: string;
  /** 列の見出し。1月〜12月 ＋ 年計 */
  columns: string[];
  rows: PLViewRow[];
  /** 符号を付けて色を変える（差異モード） */
  signed?: boolean;

  year: PLSelect<string>;
  mode: PLSelect<string>;
  /** 合算 / 家計 / 事業（要件定義書 §4.1 SC-04）。Figma には無い */
  scope?: PLSelect<string>;

  /** 表の上。説明 */
  lead?: React.ReactNode;
  /** 表の下。注記（複数行） */
  notes?: React.ReactNode;
  /** v0.6.0 に無いもの（ADR-0023） */
  notices?: React.ReactNode;
}

const KIND: Record<PLRowKind, TableCellKind> = {
  group: "group",
  item: "item",
  subtotal: "subtotal",
  total: "total",
};

/** 差異の色。designsystem.md §1.4 の用途マッピング */
function toneClass(tone: "good" | "bad" | null | undefined): string | null {
  if (tone === "good") return "text-fg-success";
  if (tone === "bad") return "text-fg-destructive";
  return null;
}

function Segmented({ select }: { select: PLSelect<string> }) {
  const controlled = select.value !== undefined && select.onChange !== undefined;
  return (
    <Tabs
      {...(controlled
        ? { value: select.value, onValueChange: select.onChange }
        : { defaultValue: select.defaultValue })}
    >
      <TabsList>
        {select.options.map((o) => (
          <TabsTrigger key={o.value} value={o.value}>
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * 年月別 収支（SC-04）の見た目
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-04、docs/design/screens.md 03
 * （Figma 2031:256）
 *
 * **計算をしない。** 値はすべて props で受け取る。
 *
 * **金額に符号も色も付けない**（差異モードを除く）。Figma 2031:256 の
 * 費用は ¥106,400 のように実額で並んでいて、注記も「費用は実額で」と
 * 書いている。ほかの画面の Amount をそのまま持ち込むと「−」が付く。
 *
 * 1列目は横スクロールしても残す（TableCell の `sticky`）。
 * **列を削って収めようとしない**（要件定義書 §3.3 CL-5 手順5）。
 */
export function ProfitLossView({
  stats,
  panelTitle,
  columns,
  rows,
  signed = false,
  year,
  mode,
  scope,
  lead,
  notes,
  notices,
}: ProfitLossViewProps) {
  /* 当初予算を添える列が1つでもあるか。**行ごとに決めない。**
     添える行だけ背が高くなると、数字の並びが揃わず読みづらくなる */
  const showsPlan = rows.some((r) =>
    r.planValues?.some((v) => v !== null && v !== undefined),
  );

  return (
    <>
      <PageHeader
        title="年月別 収支"
        subtitle="損益だけを月ごとに並べます。振替とカード引落は含みません"
        stats={stats}
      />

      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 py-24">
        {notices}

        <Panel
          title={panelTitle}
          action={
            <div className="flex flex-wrap items-center gap-12">
              <Segmented select={year} />
              {scope ? <Segmented select={scope} /> : null}
              <Segmented select={mode} />
            </div>
          }
        >
          {lead}

          {/* **w-full にしない。** 器に合わせると13列が潰れて金額が読めない。
              内容ぶんの幅を取らせ、Table の overflow-x-auto で横に送る
              （設定の表と同じ。要望7）。費目の列は sticky left-0 なので
              横に送っても残る */}
          {/* **当初予算は行ではなく表で揃える。** 添える行と添えない行で
              高さが変わると、密度の高い数字の表は読みづらくなる。出す列が
              1つでもあれば、すべてのセルで2行ぶんの場所を取る */}
          <Table density="compact" className="w-max min-w-full">
            <TableHeaderRow>
              <TableHead className="sticky left-0 z-20 w-pl-label bg-muted">費目</TableHead>
              {columns.map((c) => (
                <TableHead key={c} align="right">
                  {c}
                </TableHead>
              ))}
            </TableHeaderRow>
            <tbody>
              {rows.map((row, i) => (
                <TableRow
                  key={row.key}
                  fixedHeight={!showsPlan}
                  last={i === rows.length - 1}
                >
                  <TableCell
                    kind={row.kind === "item" ? "row-header" : KIND[row.kind]}
                    sticky
                    className={cn(
                      "w-pl-label whitespace-nowrap",
                      row.kind === "item" ? "pl-24" : null,
                      /* sticky なセルは下の行が透ける。kind の背景を自分で持つ */
                      row.kind === "group" || row.kind === "total" ? "bg-muted" : "bg-card",
                    )}
                  >
                    {row.label}
                  </TableCell>

                  {row.values.map((value, j) => (
                    <TableCell
                      key={j}
                      kind={KIND[row.kind]}
                      align="right"
                      className={cn(
                        "num whitespace-nowrap",
                        signed ? toneClass(row.tones?.[j]) : null,
                        !signed && (row.kind === "subtotal" || row.kind === "total")
                          ? "text-fg-primary"
                          : null,
                      )}
                    >
                      {value === null ? (
                        row.kind === "group" ? null : (
                          <span className="text-muted-foreground">·</span>
                        )
                      ) : signed ? (
                        value === 0 ? (
                          "0"
                        ) : (
                          formatSigned(value)
                        )
                      ) : (
                        `¥${formatAmount(value)}`
                      )}
                      {/* 当初予算。見込みと違う月だけ添える。
                          **横に並べない。** ml-4 で並べると金額が2つ続いて
                          読めない（要望：予定と実績が近すぎる）。下に置き、
                          出さない月も場所だけ取って高さを揃える */}
                      {showsPlan ? (
                        <span className="block t-body-sm text-muted-foreground">
                          {row.planValues?.[j] !== null && row.planValues?.[j] !== undefined
                            ? `予 ¥${formatAmount(row.planValues[j] as Yen)}`
                            : "\u00A0"}
                        </span>
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </tbody>
          </Table>

          {notes}
        </Panel>
      </div>
    </>
  );
}
