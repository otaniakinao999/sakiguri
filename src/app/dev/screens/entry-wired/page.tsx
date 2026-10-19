"use client";

/**
 * 実績入力の確認（開発用）
 *
 * buildTodoList / findCandidates / buildActualList を本番と同じ順で通し、
 * EntryView に渡す。**認証の外に置いてある。**
 *
 * 操作は押せるが何も起きない（状態を持たないので）。［ほかの操作］の
 * 開閉と月の切り替えだけ動く。照合の帯を見るために、フィクスチャに
 * 候補の出る実績を1件足してある。
 */

import { useState } from "react";

import { EntryView } from "@/components/entry/EntryView";
import {
  buildEntryFixture,
  buildEntrySeries,
  FIXTURE_ACCOUNTS,
  FIXTURE_TODAY,
} from "@/components/entry/entry-fixture";
import {
  buildEntryActualRows,
  buildEntryMonths,
  buildEntryTodoRows,
  futureNoteOf,
} from "@/components/entry/entry-view-model";
import { Button } from "@/components/ui/v06/button";
import { Callout } from "@/components/sakiguri/Callout";
import { buildActualList } from "@/lib/actual-list";
import { buildHeaderStats } from "@/lib/header-stats";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

const fixture = buildEntryFixture();
const stats = buildHeaderStats(buildEntrySeries(), FIXTURE_ACCOUNTS, FIXTURE_TODAY);

export default function DevEntryWiredPage() {
  const [openRowId, setOpenRowId] = useState<string | null>(
    /* 1行目の予定を開いた状態で出す。Figma 2032:845 と見比べるため */
    buildEntryTodoRows(fixture.todo).find((r) => r.kind === "plan")?.id ?? null,
  );
  const [month, setMonth] = useState<string | null>(null);

  const list = buildActualList({ actuals: fixture.actuals, yearMonth: month });

  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex min-h-screen w-full max-w-main flex-col">
        <EntryView
          stats={stats}
          headerAction={
            <Button>
              <ArrowUpTrayIcon />
              CSVを取り込む
            </Button>
          }
          todoCount={fixture.todo.length}
          todos={buildEntryTodoRows(fixture.todo)}
          openRowId={openRowId}
          onToggleOther={(id) => setOpenRowId((p) => (p === id ? null : id))}
          months={buildEntryMonths(list, FIXTURE_TODAY)}
          onSelectMonth={setMonth}
          futureNote={futureNoteOf(list, FIXTURE_TODAY) ?? undefined}
          actuals={buildEntryActualRows(list.rows).map((row) => ({
            ...row,
            actions: (
              <>
                <Button variant="outline" size="sm">
                  編集
                </Button>
                <Button variant="destructive" size="sm">
                  削除
                </Button>
              </>
            ),
          }))}
          notices={
            fixture.candidateCount > 0 ? (
              <Callout tone="caution">
                同じ取引かもしれない実績と予定が{fixture.candidateCount}組あります。
                両方が残高に乗っているため、残高が実際より低く出ています。
              </Callout>
            ) : undefined
          }
          listAction={
            <Button variant="outline" size="sm">
              手入力する（例外のときだけ）
            </Button>
          }
        />
      </div>
    </div>
  );
}
