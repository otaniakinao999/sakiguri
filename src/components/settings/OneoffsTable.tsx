"use client";

/**
 * 単発の予定（FR-03、SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2 OneoffItem
 *   RecurringItem から day / months / active を除き、date を持つ。
 */

import { compareDate } from "@/core/date";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, TextInput } from "@/components/ui/inputs";
import {
  addOneoff,
  blankOneoff,
  newId,
  removeOneoff,
  updateOneoff,
} from "@/lib/mutations";

import { EntryFieldCells } from "./EntryFields";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";
const HEAD =
  "bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-8 py-8 text-left text-body-xxs font-semibold tracking-wide whitespace-nowrap";

export function OneoffsTable() {
  const { data, setData, today } = useAppData();
  const sorted = [...data.oneoffs].sort((a, b) => compareDate(a.date, b.date));

  return (
    <Card
      title={`単発の予定（${data.oneoffs.length}件）`}
      right={
        <Button
          size="sm"
          disabled={data.accounts.length === 0 || !today}
          onClick={() =>
            setData((d) =>
              addOneoff(d, blankOneoff(newId(), d.accounts[0].id, today ?? d.asOf)),
            )
          }
        >
          ＋ 追加
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-object-base-mid py-24 text-center text-body-xs">
          予定納税、設備投資、大型の入金など、1回限りのものを登録します。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-xs">
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
                      color="danger"
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
    </Card>
  );
}
