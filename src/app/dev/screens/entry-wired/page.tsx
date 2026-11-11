"use client";

/**
 * やること（実績入力）の**配線**の確認（開発用）
 *
 * buildTodoList / findCandidates を本番と同じ順で通し、EntryView に渡す。
 * **認証の外に置いてある。**
 *
 * 操作は押せるが何も起きない（状態を持たないので）。［ほかの操作］の
 * 開閉だけ動く。照合の帯を見るために、フィクスチャに候補の出る実績を
 * 1件足してある。
 *
 * 実績一覧は `/dev/screens/actuals-wired`（FR-54 で別ページにした）。
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
  buildEntryTodoRows,
  entryAmountScope,
} from "@/components/entry/entry-view-model";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/sakiguri/Callout";
import { buildHeaderStats } from "@/lib/header-stats";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

const fixture = buildEntryFixture();
const scope = entryAmountScope(FIXTURE_ACCOUNTS);
const stats = buildHeaderStats(buildEntrySeries(), FIXTURE_ACCOUNTS, FIXTURE_TODAY);

export default function DevEntryWiredPage() {
  const [openRowId, setOpenRowId] = useState<string | null>(
    /* 1行目の予定を開いた状態で出す。Figma 2032:845 と見比べるため */
    buildEntryTodoRows(fixture.todo, scope).find((r) => r.kind === "plan")?.id ?? null,
  );

  return (
    <EntryView
      stats={stats}
      headerAction={
        <Button>
          <ArrowUpTrayIcon />
          CSVを取り込む
        </Button>
      }
      todoCount={fixture.todo.length}
      todos={buildEntryTodoRows(fixture.todo, scope)}
      openRowId={openRowId}
      onToggleOther={(id) => setOpenRowId((p) => (p === id ? null : id))}
      notices={
        fixture.candidateCount > 0 ? (
          <Callout tone="caution">
            同じ取引かもしれない実績と予定が{fixture.candidateCount}組あります。
            両方が残高に乗っているため、残高が実際より低く出ています。
          </Callout>
        ) : undefined
      }
      todoAction={
        <Button variant="outline" size="sm">
          手入力する（例外のときだけ）
        </Button>
      }
    />
  );
}
