import * as React from "react";
import { ChevronRightIcon } from "@heroicons/react/16/solid";

import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "upcoming";

export interface StepItem {
  label: string;
  state: StepState;
}

/**
 * Steps — docs/design/components.md §2 Navigation / steps（Figma 2009:80）
 *
 * 番号の丸は 24px。done と current は塗り、upcoming は枠だけ。
 * ラベルの濃さで現在地を示す（done も muted）。
 */
export function Steps({ steps, className }: { steps: StepItem[]; className?: string }) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-12", className)}>
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-12">
          <span className="flex items-center gap-8">
            <span
              aria-hidden
              className={cn(
                "flex size-24 shrink-0 items-center justify-center rounded-full num t-label-sm",
                step.state === "upcoming"
                  ? "border border-input text-muted-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                "t-label",
                step.state === "current" ? "text-foreground" : "text-muted-foreground",
              )}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {step.label}
            </span>
          </span>
          {i < steps.length - 1 ? (
            <ChevronRightIcon aria-hidden className="size-16 text-muted-foreground" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
