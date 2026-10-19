import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Input — docs/design/components.md §1（shadcn 相当）
 *
 * 高さと横余白はトークン（`--control-height-md` / `--control-padding-x-md`）。
 * 金額や日付は呼び出し側で `num` を足す。
 */
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-control-md w-full rounded-md border border-input bg-background px-control-md t-body",
        "text-foreground placeholder:text-muted-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
