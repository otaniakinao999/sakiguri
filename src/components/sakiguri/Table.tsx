import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Table — docs/design/components.md §2「TableCell（sakiguri）」（Figma 2009:67）
 *
 * **密度で2つの値だけが変わる。** `--table-row-height`（48 / 36）と
 * `--table-cell-padding-x`（16 / 12）。`data-density="compact"` を
 * 親に付けると切り替わる（tokens.css）。
 *
 * **Figma の実物に合わせて、行の高さは使う側が決める。**
 *   月次資金繰り表（2030:190）：48px 固定。フレーム名は「Density: Compact」
 *     だが、描かれているのは既定の 48px だった。**描画を採った。**
 *   入出金予定表（2030:348）：41〜43px。
 *
 * **41〜43px は作れない。** 10px の上下余白が要るが、§2.6 の間隔は
 * 4/8/12/16/24/32/40/48 で 10 が無く、ADR-0004 によりスケール外の値は
 * クラスが生成されない（`py-10` と書いても効かない。実際に潰れた）。
 * **デザインシステム側の値を採る。** compact の行の高さ 36px
 * （components.md §2「寸法」）で固定する。どちらの表も `fixedHeight` を
 * 付け、密度で 48px / 36px を選ぶ。
 */

export function Table({
  density = "default",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableElement> & { density?: "default" | "compact" }) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        data-density={density === "compact" ? "compact" : undefined}
        className={cn("w-full border-collapse text-left", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeaderRow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <thead>
      <tr className={cn("border-b border-border bg-muted", className)} {...props}>
        {children}
      </tr>
    </thead>
  );
}

export function TableHead({
  align = "left",
  className,
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-cell py-8 t-label-sm text-muted-foreground whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** 生活防衛ラインを割る月など。components.md の kind `highlight` */
  highlight?: boolean;
  /** 行の高さを `--table-row-height` に固定する */
  fixedHeight?: boolean;
  /** 最終行は下の罫線を引かない */
  last?: boolean;
}

export function TableRow({
  highlight,
  fixedHeight,
  last,
  className,
  children,
  ...props
}: TableRowProps) {
  return (
    <tr
      className={cn(
        last ? null : "border-b border-border",
        fixedHeight ? "h-row" : null,
        highlight ? "bg-warning-subtle text-fg-warning" : null,
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

/** components.md の kind。`highlight` は行の状態なので TableRow にある。 */
export type TableCellKind = "row-header" | "group" | "item" | "subtotal" | "total";

const KIND: Record<TableCellKind, string> = {
  "row-header": "t-table",
  group: "t-table-strong bg-muted",
  item: "t-table",
  subtotal: "t-table-strong border-t border-border",
  total: "t-table-strong bg-muted",
};

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  kind?: TableCellKind;
  align?: "left" | "right";
  /** 年月別 収支の費目列。横スクロールしても残す */
  sticky?: boolean;
}

export function TableCell({
  kind = "item",
  align = "left",
  sticky,
  className,
  children,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn(
        "px-cell py-8 align-middle",
        KIND[kind],
        align === "right" ? "text-right" : "text-left",
        /* bg を持たない kind だと、下の行が透けて読めなくなる */
        sticky ? "sticky left-0 z-10 bg-card" : null,
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
