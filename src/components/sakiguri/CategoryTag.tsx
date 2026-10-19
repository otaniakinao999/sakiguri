import * as React from "react";

import { Badge } from "@/components/ui/badge";
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
