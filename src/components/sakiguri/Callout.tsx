import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Callout — docs/design/components.md（Figma 2007:55）
 *
 * 左辺に 2px の線。高さは中身に合わせて伸び、文字は上下中央に揃う。
 * アイコンは持たない（Figma も文字だけ）。
 */
const calloutVariants = cva("flex items-center rounded-sm border-l-2 py-12 pr-16 pl-20 t-body", {
  variants: {
    tone: {
      info: "bg-primary-subtle border-l-fg-primary text-fg-primary",
      caution: "bg-warning-subtle border-l-fg-warning text-fg-warning",
      error: "bg-destructive-subtle border-l-fg-destructive text-fg-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});

export interface CalloutProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof calloutVariants> {}

export function Callout({ className, tone = "info", children, ...props }: CalloutProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(calloutVariants({ tone }), className)}
      {...props}
    >
      {children}
    </div>
  );
}
