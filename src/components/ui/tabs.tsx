"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * Tabs — docs/design/components.md §1（Figma 12:18）Segmented
 *
 * bg-muted の器の中で、選ばれたタブだけを bg-background に浮かせる。
 *
 * **狭い幅では帯ごと横に送る**（375px の決定2と同じ考え。decisions.md
 * 未決5）。選択肢が6つある帯（入出金予定表の期間）は 468px あり、
 * 中のタブは折り返せないので、**そのままだと画面を横にはみ出させる。**
 * 900px 以上は従来どおり（`wide:` の側に元の形を残してある）。
 */
export const Tabs = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  /* **器にも幅の上限を付ける。** 中の帯の `max-w-full` は親（この器）を
     基準にするので、器が内容ぶんに広がったままだと 100% が 468px に
     なって何も効かない（2026-11-13 に実機で見つけた） */
  <TabsPrimitive.Root
    ref={ref}
    className={cn("min-w-0 max-w-full", className)}
    {...props}
  />
));
Tabs.displayName = TabsPrimitive.Root.displayName;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex max-w-full items-center gap-4 overflow-x-auto rounded-md bg-muted p-4",
      "wide:max-w-none wide:overflow-visible",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded-md px-12 py-6 t-label whitespace-nowrap",
      "text-muted-foreground transition-colors",
      "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-16", className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
