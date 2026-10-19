import * as React from "react";

import type { Yen } from "@/core/types";
import { Amount, type AmountType } from "./Amount";
import { cn } from "@/lib/utils";

export interface LedgerRowProps {
  label: string;
  value: Yen;
  type?: AmountType;
  className?: string;
}

/**
 * LedgerRow — docs/design/components.md（Figma 2008:56）
 *
 * components.md は「行の高さ 48px、区切りは border-b」と書いているが、
 * ダッシュボードの実物（2029:171〜176）は約33px で罫線がなく、
 * 口座とカードの間に区切りが1本あるだけだった。**画面側を採った。**
 * 間隔は親が gap で持つ。
 */
export function LedgerRow({ label, value, type = "neutral", className }: LedgerRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-16 py-4", className)}>
      <span className="t-body text-foreground">{label}</span>
      <Amount value={value} type={type} size="body" />
    </div>
  );
}
