import * as React from "react";

import type { Yen } from "@/core/types";
import { Amount, type AmountType } from "./Amount";
import { CategoryTag, type Category } from "./CategoryTag";
import { StatusChip, type Status } from "./StatusChip";
import { cn } from "@/lib/utils";

export interface TodoRowProps {
  /** 整形済み。例：9/27 */
  date: string;
  title: string;
  amount: Yen;
  amountType?: AmountType;
  /**
   * 区分。**null なら出さない。**
   * 費用で固定／変動が決まっていない場合がある（§3.1.2 適用規則1）。
   */
  category?: Category | null;
  status?: Status;
  actions?: React.ReactNode;
  /** 行の下に開く領域（照合候補・ほかの操作） */
  children?: React.ReactNode;
  last?: boolean;
  className?: string;
}

/**
 * TodoRow — docs/design/components.md（Figma 2038:77）
 *
 * 列の順は Figma の実物に合わせてある：日付・内容・金額・区分・状態・操作。
 * components.md の本文は区分と状態を金額より前に並べているが、
 * 2029:60 の描画はこの順だった。
 */
export function TodoRow({
  date,
  title,
  amount,
  amountType = "neutral",
  category,
  status,
  actions,
  children,
  last,
  className,
}: TodoRowProps) {
  return (
    <div className={cn(last ? null : "border-b border-border", className)}>
      <div className="flex items-center gap-12 py-12">
        <span className="num w-48 shrink-0 t-table text-muted-foreground">{date}</span>
        <span className="min-w-0 flex-1 truncate t-body text-foreground">{title}</span>
        <Amount value={amount} type={amountType} size="body" className="shrink-0" />
        {category ? <CategoryTag category={category} /> : null}
        {status ? <StatusChip status={status} /> : null}
        {actions ? <div className="flex shrink-0 items-center gap-8">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
