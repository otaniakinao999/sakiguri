import * as React from "react";

import { cn } from "@/lib/utils";

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  /** 見出しの横にベースラインを揃えて出す。例：4件 */
  count?: React.ReactNode;
  action?: React.ReactNode;
}

/**
 * Panel — docs/design/components.md（Figma 2008:62、Figma 上の名前は Card）
 *
 * bg-card / 枠線なし / rounded-lg / 内側 24px / 要素の間隔 16px。
 */
export function Panel({ title, count, action, className, children, ...props }: PanelProps) {
  return (
    <section className={cn("flex flex-col gap-16 rounded-lg bg-card p-24", className)} {...props}>
      {title || action ? (
        <header className="flex items-baseline justify-between gap-16">
          <div className="flex items-baseline gap-8">
            {title ? <h2 className="t-card-title">{title}</h2> : null}
            {count ? <span className="t-body-sm text-muted-foreground">{count}</span> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-8">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
