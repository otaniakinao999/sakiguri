import * as React from "react";

import type { Yen } from "@/core/types";
import { formatSignedYen, formatYen, MINUS } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AmountType = "income" | "expense" | "neutral";
export type AmountSize = "table" | "body" | "kpi";

/**
 * docs/design/components.md §3。収入は teal、支出は plum、残高は foreground。
 *
 * **PageHeader も使う（色だけ）。** 同じ対応を2箇所に書かない
 * （CLAUDE.md §2.8）。向こうは符号を付けないので、Amount ごとは使えない。
 */
export const AMOUNT_TONE: Record<AmountType, string> = {
  income: "text-fg-success",
  expense: "text-fg-destructive",
  neutral: "text-foreground",
};

const SIZE: Record<AmountSize, string> = {
  table: "t-table",
  body: "t-body",
  kpi: "t-kpi",
};

export interface AmountProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: Yen;
  type?: AmountType;
  size?: AmountSize;
  /** 増減を示す箇所で + を付ける。例：うち未記録の予定 +¥186,400 */
  signed?: boolean;
}

/**
 * Amount — Figma 2007:48
 *
 * 整形は src/lib/format.ts に一本化してある（CLAUDE.md §2.8）。
 * ここでは色と字の大きさだけを決める。
 *
 * expense は、呼び出し側が正負どちらで渡しても頭に U+2212 を付ける。
 * 一覧では符号で向きを示さず、色と区分で示すため。
 */
export function Amount({
  value,
  type = "neutral",
  size = "body",
  signed = false,
  className,
  ...props
}: AmountProps) {
  const text = signed
    ? formatSignedYen(value)
    : type === "expense"
      ? MINUS + formatYen(Math.abs(value))
      : formatYen(value);

  return (
    <span className={cn("num text-right", SIZE[size], AMOUNT_TONE[type], className)} {...props}>
      {text}
    </span>
  );
}
