import * as React from "react";

import type { Yen } from "@/core/types";
import { AMOUNT_TONE, type AmountType } from "./Amount";
import { formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PageHeaderStat {
  label: string;
  value: Yen;
  /**
   * 色だけを決める。**符号は付けない。**
   * Figma のカード未払は plum だが頭に「−」が無い（2038:1151）。
   * Amount をそのまま使うと expense に「−」が付いてしまう。
   */
  tone?: AmountType;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** 右側の残高サマリー。今日の残高 / 30日後 / 90日後 / カード未払 */
  stats?: PageHeaderStat[];
  action?: React.ReactNode;
  className?: string;
}

/**
 * PageHeader — docs/design/components.md §2 Layout（Figma 2038:49 / 2038:1151）
 *
 * 02〜06 の画面が共通で使う。01 ダッシュボードは PageHeader を持たず、
 * Hero が先頭に来る（2029:88）。
 *
 * **残高サマリーは screens.md に書かれていない。** 02 の節は
 * タイトルとサブタイトルしか挙げていないが、Figma の 2030:97 には
 * 4項目が描かれている。components.md §2 PageHeader の「右側」が
 * 同じものを指しているので、そちらを根拠に作った。
 */
export function PageHeader({
  title,
  subtitle,
  stats,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-24",
        "border-b border-border bg-background px-32 py-20",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="t-h4 text-foreground">{title}</h1>
        {subtitle ? <p className="t-body-sm text-muted-foreground">{subtitle}</p> : null}
      </div>

      {stats?.length || action ? (
        <div className="flex flex-wrap items-center gap-32">
          {stats?.map((stat) => (
            <div key={stat.label} className="flex flex-col items-end gap-2">
              <span className="t-label-sm text-muted-foreground">{stat.label}</span>
              <span
                className={cn(
                  "num t-label-lg font-semibold",
                  AMOUNT_TONE[stat.tone ?? "neutral"],
                )}
              >
                {formatYen(stat.value)}
              </span>
            </div>
          ))}
          {action}
        </div>
      ) : null}
    </header>
  );
}
