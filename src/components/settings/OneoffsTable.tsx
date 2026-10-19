"use client";

/**
 * 単発の予定（FR-03、SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2 OneoffItem
 *   RecurringItem から day / months / active を除き、date を持つ。
 */

import { compareDate } from "@/core/date";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/v06/button";
import { Panel } from "@/components/sakiguri/Panel";
import { DateInput, TextInput } from "@/components/ui/inputs";
import {
  addOneoff,
  blankOneoff,
  newId,
  removeOneoff,
  updateOneoff,
} from "@/lib/mutations";

import { EntryFieldCells } from "./EntryFields";

const CELL = "border-b border-border px-cell py-8 align-top";
const HEAD =
  "border-b border-border bg-muted px-cell py-8 text-left t-label-sm text-muted-foreground whitespace-nowrap";

export function OneoffsTable() {
  const { data, setData, today, session } = useAppData();
  const sorted = [...data.oneoffs].sort((a, b) => compareDate(a.date, b.date));

  return (
    <Panel
      title={`単発の予定（${data.oneoffs.length}件）`}
      action={
        <Button
          size="sm"
          disabled={data.accounts.length === 0 || !today}
          onClick={() => {
            setData((d) =>
              addOneoff(d, blankOneoff(newId(), d.accounts[0].id, today ?? d.asOf)),
            );
            track(session?.user.id, "plan_created", { recurring: false });
          }}
        >
          ＋ 追加
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-muted-foreground py-24 text-center t-body-sm">
          予定納税、設備投資、大型の入金など、1回限りのものを登録します。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse t-body-sm">
            <thead>
              <tr>
                <th className={HEAD}>日付</th>
                <th className={`${HEAD} min-w-[var(--layout-field-width)]`}>内容</th>
                <th className={HEAD}>収支</th>
                <th className={HEAD}>固定/変動</th>
                <th className={HEAD}>費目</th>
                <th className={`${HEAD} text-right`}>金額</th>
                <th className={HEAD}>事業%</th>
                <th className={HEAD}>口座</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id}>
                  <td className={CELL}>
                    <DateInput
                      aria-label="日付"
                      value={item.date}
                      onChange={(e) =>
                        setData((d) => updateOneoff(d, item.id, { date: e.target.value }))
                      }
                    />
                  </td>
                  <td className={CELL}>
                    <TextInput
                      aria-label="内容"
                      value={item.name}
                      onChange={(e) =>
                        setData((d) => updateOneoff(d, item.id, { name: e.target.value }))
                      }
                    />
                  </td>
                  <EntryFieldCells
                    value={item}
                    accounts={data.accounts}
                    onChange={(patch) => setData((d) => updateOneoff(d, item.id, patch))}
                  />
                  <td className={`${CELL} text-right`}>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setData((d) => removeOneoff(d, item.id))}
                    >
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
