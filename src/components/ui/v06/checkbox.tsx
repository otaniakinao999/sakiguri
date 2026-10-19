"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "@heroicons/react/16/solid";

import { cn } from "@/lib/utils";

/** Checkbox — docs/design/components.md §1（shadcn 相当） */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "size-16 shrink-0 rounded-sm border border-input bg-background",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
      "data-[state=checked]:text-primary-foreground",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <CheckIcon className="size-12" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

/** ラベル付き。クリック範囲をラベルまで広げる */
export function CheckboxField({
  id,
  checked,
  onCheckedChange,
  children,
  className,
}: {
  id: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-8", className)}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
      />
      <label htmlFor={id} className="t-body text-foreground">
        {children}
      </label>
    </div>
  );
}
