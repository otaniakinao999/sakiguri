import * as React from "react";
import { ChevronDownIcon } from "@heroicons/react/16/solid";

import { cn } from "@/lib/utils";

/**
 * Select — docs/design/components.md §1（shadcn 相当）
 *
 * **ネイティブの `<select>` を使う。** Radix の Select に替えると、
 * 候補が多いとき（費目・口座・月）に自前の仮想スクロールが要るうえ、
 * モバイルの既定の選択 UI を捨てることになる。見た目だけ寄せる。
 */
export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-control-md w-full appearance-none rounded-md border border-input bg-background",
          "px-control-md pr-32 t-body text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-12 size-16 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  ),
);
Select.displayName = "Select";

/** ラベルと入力の組。縦に 4px */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <label htmlFor={htmlFor} className="t-label-sm text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <span className="t-body-sm text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
