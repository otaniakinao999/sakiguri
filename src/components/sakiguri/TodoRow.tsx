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
  /**
   * 内容の下に小さく出す1行。**資金移動の向き**（FR-63・AC-70）。
   *
   * 備考（キャッシュフローの列）とは別物である。あちらは1行に1つしか
   * 出せず、優先順位で落ちる（繰延・未入力が先）。向きは落ちてはいけない
   * ので内容に添える。
   */
  detail?: string;
  amount: Yen;
  amountType?: AmountType;
  /** 符号を付けるか。残高の動きで決まる（AC-58b・`amountView`） */
  signed?: boolean;
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
  detail,
  amount,
  amountType = "neutral",
  signed,
  category,
  status,
  actions,
  children,
  last,
  className,
}: TodoRowProps) {
  return (
    <div className={cn(last ? null : "border-b border-border", className)}>
      {/* **狭い幅では2段にする**（375px の決定5。decisions.md 未決5）。
          1段目が日付と項目、2段目が金額・区分・状態・操作。

          1段に収めると、375px では項目の欄が 84px しか残らず、
          **「○○商会 売上入金」が読めない。** 900px 以上は1段のまま
          （`wide:` の側に元の形を残してある）。

          2段目は `w-full` で改行させる ―― `flex-wrap` の行の中で幅
          いっぱいの要素は必ず次の行に落ちる。 */}
      <div className="flex flex-wrap items-center gap-12 py-12 wide:flex-nowrap">
        <span className="num w-48 shrink-0 t-table text-muted-foreground">{date}</span>
        <div className="min-w-0 flex-1">
          <span className="block truncate t-body text-foreground">{title}</span>
          {detail ? (
            <span className="block truncate t-body-sm text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </div>
        <div className="flex w-full items-center justify-end gap-12 wide:w-auto">
          <Amount
            value={amount}
            type={amountType}
            signed={signed}
            size="body"
            className="shrink-0"
          />
          {category ? <CategoryTag category={category} /> : null}
          {status ? <StatusChip status={status} /> : null}
          {actions ? <div className="flex shrink-0 items-center gap-8">{actions}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}
