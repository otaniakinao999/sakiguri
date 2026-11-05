import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/16/solid";

import type { PlanSort, PlanSortColumn } from "@/lib/plan-order";
import { cn } from "@/lib/utils";

/**
 * 並べ替えられる見出し
 *
 * **押したときだけ並び直す。** 並べ替えの基準になる列は編集もできるので、
 * 描画のたびに並べ直すと入力中に行が動く（`lib/plan-order.ts` の冒頭）。
 *
 * 向きは `aria-sort` でも伝える。矢印は**いま並べ替えに使っている列に
 * だけ**出す。全列に出すと、どれで並んでいるのかが読めない。
 */
export function SortableHeader({
  label,
  column,
  sort,
  onSort,
  className,
  align = "left",
}: {
  label: React.ReactNode;
  column: PlanSortColumn;
  sort: PlanSort;
  onSort: (column: PlanSortColumn) => void;
  className?: string;
  /** 金額のように右寄せの列では矢印を左に置く */
  align?: "left" | "right";
}) {
  const active = sort.column === column;
  const Arrow = sort.direction === "asc" ? ChevronUpIcon : ChevronDownIcon;

  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-4 hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          active && "text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {active ? <Arrow aria-hidden className="size-16" /> : null}
      </button>
    </th>
  );
}
