import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — docs/design/components.md §1（Figma 6:482）
 *
 * 高さは --control-height-*、左右の余白は --control-padding-x-*。
 * どちらも [data-density="compact"] で縮む。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-8 rounded-md whitespace-nowrap t-label transition-colors disabled:pointer-events-none disabled:bg-disabled disabled:text-fg-disabled [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        outline: "border border-input bg-background text-foreground hover:bg-secondary",
        ghost: "text-foreground hover:bg-secondary",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
      },
      size: {
        sm: "h-control-sm px-control-sm [&_svg]:size-16",
        md: "h-control-md px-control-md [&_svg]:size-20",
        lg: "h-control-lg px-control-lg [&_svg]:size-20",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
