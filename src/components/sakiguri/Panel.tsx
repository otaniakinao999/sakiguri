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
 *
 * **狭い幅ではカードにしない**（375px の決定3。decisions.md 未決5）。
 * 内側の 24px × 2 と、ページの余白 32px × 2 を合わせると、375px の
 * 画面で**本文に使える幅が 263px しか残らない。** カードの枠を外して
 * 横いっぱいに使い、ページ側の 16px だけを余白にする。
 *
 * **`min-w-0` を付ける。** これが無いと、中身（`truncate` の行や表）の
 * min-content がそのままパネルの幅になり、**ページが横にはみ出す。**
 * 表は中の `overflow-x-auto` で横に送る（決定2と同じ考え）。
 *
 * 900px 以上は従来どおり（`wide:` の側に元の値を残してある）。
 */
export function Panel({ title, count, action, className, children, ...props }: PanelProps) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-16 bg-transparent p-0",
        "wide:rounded-lg wide:bg-card wide:p-24",
        className,
      )}
      {...props}
    >
      {title || action ? (
        /* **狭い幅では折り返す**（375px の決定）。見出しの横に出す件数は
           「38件 ／ 入金 ¥2,057,777 ／ 出金 −¥3,442,277」のように長く、
           1行に収めようとすると**パネルの幅が画面を超える** */
        <header className="flex flex-wrap items-baseline justify-between gap-16">
          <div className="flex min-w-0 flex-wrap items-baseline gap-8">
            {title ? <h2 className="t-card-title">{title}</h2> : null}
            {count ? <span className="t-body-sm text-muted-foreground">{count}</span> : null}
          </div>
          {/* **狭い幅では縮める・折り返す。** `shrink-0` のままだと、
              年月別 収支の操作列（年度・合算/家計/事業・モード）が
              560px のまま縮まず、画面を横にはみ出させる */}
          {action ? (
            <div className="flex min-w-0 flex-wrap items-center gap-8 wide:shrink-0 wide:flex-nowrap">
              {action}
            </div>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
