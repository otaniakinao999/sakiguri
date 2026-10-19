import * as React from "react";

import { cn } from "@/lib/utils";

export type Series = "actual" | "forecast" | "defense";

const STROKE: Record<Series, string> = {
  actual: "bg-chart-actual",
  forecast: "bg-chart-forecast",
  defense: "bg-chart-defense",
};

/** LegendItem — docs/design/components.md（Figma 2009:97）。実績だけ実線。 */
export function LegendItem({
  series,
  label,
  className,
}: {
  series: Series;
  label: string;
  className?: string;
}) {
  const dashed = series !== "actual";
  return (
    <span className={cn("inline-flex items-center gap-8", className)}>
      <span aria-hidden className="inline-flex w-24 items-center">
        {dashed ? (
          <span className="flex w-full justify-between">
            <span className={cn("h-2 w-6", STROKE[series])} />
            <span className={cn("h-2 w-6", STROKE[series])} />
            <span className={cn("h-2 w-6", STROKE[series])} />
          </span>
        ) : (
          <span className={cn("h-2 w-full", STROKE[series])} />
        )}
      </span>
      <span className="t-body-sm text-muted-foreground">{label}</span>
    </span>
  );
}
