"use client";

import * as React from "react";

import { MonthTab } from "@/components/sakiguri/MonthTab";
import { PageHeader, type PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { Panel } from "@/components/sakiguri/Panel";
import { TodoRow } from "@/components/sakiguri/TodoRow";

import type { EntryActualRow, EntryMonth } from "./rows";

export interface ActualsViewProps {
  stats: PageHeaderStat[];
  /** 絞り込む口座（FR-42）。見出しの右に出る */
  headerAction?: React.ReactNode;

  months: EntryMonth[];
  onSelectMonth?: (value: string) => void;
  /** 未来の月を選んだときだけ */
  futureNote?: string;
  actuals: EntryActualRow[];

  /* 差し込み口。v0.6.0 に無いもの（ADR-0023） */
  notices?: React.ReactNode;
  listFooter?: React.ReactNode;
  dialog?: React.ReactNode;
}

/**
 * 実績一覧の見た目（FR-42・FR-54）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-05、docs/design/screens.md 04
 * （Figma 2032:900 の「実績一覧」パネル）
 *
 * **やることと別のページにしてある**（FR-54・AC-61）。1つのページに
 * 並べていたので、やることを片付けるあいだも長い一覧が下に付いていた。
 *
 * **照合の導線はここに無い。** 候補の提示はやること側である。
 * ただし**未照合の実績もこの一覧に出る** ―― 導線を片方に寄せた結果、
 * どちらからも直せない実績ができてはいけない（AC-61）。一覧は実績を
 * 選り分けずに全件出し、月で区切って辿れるようにする（AC-28）。
 *
 * **計算をしない。** 値はすべて props で受け取る。
 */
export function ActualsView({
  stats,
  headerAction,
  months,
  onSelectMonth,
  futureNote,
  actuals,
  notices,
  listFooter,
  dialog,
}: ActualsViewProps) {
  return (
    <>
      <PageHeader
        title="実績一覧"
        subtitle="記録された実績を月ごとに見ます。費目や口座の間違いはここで直します"
        stats={stats}
        action={headerAction}
      />

      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 py-24">
        {notices}

        {/* 実績一覧 — 2032:900 */}
        <Panel title="実績一覧">
          <div className="flex flex-wrap items-center gap-4">
            {months.map((m) => (
              <MonthTab
                key={m.value}
                state={m.state}
                onClick={() => onSelectMonth?.(m.value)}
              >
                {m.label}
              </MonthTab>
            ))}
          </div>

          {/* screens.md は Callout（caution）だが、Figma は枠も背景も無い
              ただの注記だった。Figma を採った（ADR-0023） */}
          {futureNote ? (
            <p className="t-body-sm text-fg-warning">{futureNote}</p>
          ) : null}

          {actuals.length === 0 ? (
            <p className="py-24 text-center t-body-sm text-muted-foreground">
              この月の実績はありません。
            </p>
          ) : (
            <div>
              {actuals.map((row, i) => (
                <TodoRow
                  key={row.id}
                  date={row.date}
                  title={row.title}
                  amount={row.display.value}
                  amountType={row.display.type}
                  signed={row.display.signed}
                  category={row.category}
                  status="実績"
                  last={i === actuals.length - 1}
                  actions={row.actions}
                />
              ))}
            </div>
          )}

          {listFooter}
        </Panel>
      </div>

      {dialog}
    </>
  );
}
