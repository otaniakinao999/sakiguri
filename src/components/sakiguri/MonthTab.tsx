import * as React from "react";

import { cn } from "@/lib/utils";

export type MonthTabState = "active" | "inactive" | "future";

const STATE: Record<MonthTabState, string> = {
  active: "bg-primary-subtle text-fg-primary",
  inactive: "text-muted-foreground hover:bg-muted",
  /* 基準日より後の、予定だけの月。枠で「まだ実績が揃っていない」と示す */
  future: "border border-border-primary-subtle text-muted-foreground hover:bg-muted",
};

export interface MonthTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  state?: MonthTabState;
}

/** MonthTab — docs/design/components.md §2（Figma 2009:87） */
export function MonthTab({
  state = "inactive",
  className,
  children,
  ...props
}: MonthTabProps) {
  return (
    <button
      type="button"
      aria-current={state === "active" ? "true" : undefined}
      className={cn(
        "h-control-sm rounded-md px-12 t-label whitespace-nowrap transition-colors",
        STATE[state],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
