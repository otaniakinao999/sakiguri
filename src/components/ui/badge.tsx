import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badge — docs/design/components.md §1（Figma 9:121）
 *
 * 色の意味は sakiguri 独自。info と success は teal、warning は green、
 * destructive は plum。**赤と黄は使わない。**
 */
const badgeVariants = cva(
  "inline-flex items-center gap-6 rounded-md px-8 py-2 t-label-sm whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-muted-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        info: "bg-primary-subtle text-fg-primary",
        success: "bg-success-subtle text-fg-success",
        warning: "bg-warning-subtle text-fg-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** 先頭に現在の文字色で点を打つ */
  dot?: boolean;
}

export function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden className="size-6 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export { badgeVariants };
