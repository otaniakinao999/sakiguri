import * as React from "react";

import { categoryOf } from "@/core/categories";
import type { CostType } from "@/core/types";
import { Badge } from "@/components/ui/v06/badge";
import { cn } from "@/lib/utils";

/** 区分。カード引落は CSV取込 の画面にだけ出てくる（screens.md §1）。 */
export type Category = "収入" | "固定費" | "変動費" | "振替" | "カード引落";

/** docs/design/components.md の対応表。独自の割り当てを作らない。 */
const VARIANT: Record<Category, React.ComponentProps<typeof Badge>["variant"]> = {
  収入: "success",
  固定費: "info",
  変動費: "warning",
  振替: "secondary",
  カード引落: "secondary",
};

/**
 * 予定・実績1件を、画面に出す区分に置き換える。
 *
 * **固定／変動は費目から決めない（要件定義書 §3.1.2 適用規則1）。**
 * 同じ費目が固定費と変動費の両方に出てくる（AC-18）。だから `costType`
 * を見る。費用なのに `costType` が無い場合は**どちらとも書かずに null を
 * 返す。** 推奨値で埋めると「費目が固定／変動を決める」ことになり、
 * 適用規則1に反する。
 *
 * **ここが唯一の対応表。** 画面ごとに書くと片方だけずれる
 * （CLAUDE.md §2.8）。
 */
export function categoryTagFor(
  categoryCode: string,
  costType: CostType | null,
): Category | null {
  const group = categoryOf(categoryCode).group;
  if (group === "INC") return "収入";
  if (group === "TRF") return "振替";
  if (costType === "fixed") return "固定費";
  if (costType === "variable") return "変動費";
  return null;
}

/** CategoryTag — Figma 2007:20。Badge を角丸 sm で包むだけ。 */
export function CategoryTag({
  category,
  className,
}: {
  category: Category;
  className?: string;
}) {
  return (
    <Badge variant={VARIANT[category]} className={cn("rounded-sm", className)}>
      {category}
    </Badge>
  );
}
