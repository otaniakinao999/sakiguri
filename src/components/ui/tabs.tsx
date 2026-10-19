"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * Tabs — docs/design/components.md §1（Figma 12:18）Segmented
 *
 * bg-muted の器の中で、選ばれたタブだけを bg-background に浮かせる。
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex items-center gap-4 rounded-md bg-muted p-4", className)}
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
