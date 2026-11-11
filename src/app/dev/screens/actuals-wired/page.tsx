"use client";

/**
 * 実績一覧の**配線**の確認（開発用）
 *
 * buildActualList を本番と同じ順で通し、ActualsView に渡す。
 * **認証の外に置いてある。** 月の切り替えだけ動く（状態を持たないので
 * 編集・削除は押せても何も起きない）。
 */

import { useState } from "react";

import { ActualsView } from "@/components/entry/ActualsView";
import {
  buildEntryFixture,
  buildEntrySeries,
  FIXTURE_ACCOUNTS,
  FIXTURE_TODAY,
} from "@/components/entry/entry-fixture";
import {
  buildEntryActualRows,
  buildEntryMonths,
  entryAmountScope,
  formatActualListFooter,
  futureNoteOf,
} from "@/components/entry/entry-view-model";
import { Select } from "@/components/ui/inputs";
import { Button } from "@/components/ui/button";
import { buildActualList } from "@/lib/actual-list";
import { buildHeaderStats } from "@/lib/header-stats";

const fixture = buildEntryFixture();
const scope = entryAmountScope(FIXTURE_ACCOUNTS);
const stats = buildHeaderStats(buildEntrySeries(), FIXTURE_ACCOUNTS, FIXTURE_TODAY);

export default function DevActualsWiredPage() {
  const [month, setMonth] = useState<string | null>(null);
  const list = buildActualList({ actuals: fixture.actuals, yearMonth: month });

  return (
    <ActualsView
      stats={stats}
      headerAction={
        <label className="flex shrink-0 items-center gap-8 whitespace-nowrap t-body-sm text-muted-foreground">
          口座
          <Select aria-label="絞り込む口座" defaultValue="all">
            <option value="all">すべて</option>
            {FIXTURE_ACCOUNTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      }
      months={buildEntryMonths(list, FIXTURE_TODAY)}
      onSelectMonth={setMonth}
      futureNote={futureNoteOf(list, FIXTURE_TODAY) ?? undefined}
      actuals={buildEntryActualRows(list.rows, scope).map((row) => ({
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
      listFooter={
        <p className="num t-body-sm text-muted-foreground">
          {formatActualListFooter(list)}
        </p>
      }
    />
  );
}
