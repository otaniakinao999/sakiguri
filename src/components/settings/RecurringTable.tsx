"use client";

/**
 * 定期項目（FR-02、SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2 RecurringItem
 *   day は 1〜31。31 は月末になる（CL-1）。
 *   months が null なら毎月、配列ならその月だけ。
 *   active を false にすると展開しない（停止）。
 */

import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { NumberInput, TextInput } from "@/components/ui/inputs";
import { parseMonthsField } from "@/lib/number-field";
import {
  addRecurring,
  blankRecurring,
  newId,
  removeRecurring,
  toggleRecurringActive,
  updateRecurring,
} from "@/lib/mutations";

import { EntryFieldCells } from "./EntryFields";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";
const HEAD =
  "bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-8 py-8 text-left text-body-xxs font-semibold tracking-wide whitespace-nowrap";

export function RecurringTable() {
  const { data, setData, session } = useAppData();

  return (
    <Card
      title={`定期項目（${data.recurring.length}件）`}
      right={
        <Button
          size="sm"
          disabled={data.accounts.length === 0}
          onClick={() => {
            setData((d) => addRecurring(d, blankRecurring(newId(), d.accounts[0].id)));
            track(session?.user.id, "plan_created", { recurring: true });
          }}
        >
          ＋ 追加
        </Button>
      }
    >
      {data.recurring.length === 0 ? (
        <p className="text-object-base-mid py-24 text-center text-body-xs">
          毎月の家賃・売上・保険料などを登録すると、予測が立ち上がります。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-xs">
            <thead>
              <tr>
                <th className={`${HEAD} min-w-[var(--layout-field-width)]`}>内容</th>
                <th className={HEAD}>収支</th>
                <th className={HEAD}>固定/変動</th>
                <th className={HEAD}>費目</th>
                <th className={`${HEAD} text-right`}>金額</th>
                <th className={HEAD}>事業%</th>
                <th className={HEAD}>口座</th>
                <th className={HEAD}>日</th>
                <th className={HEAD}>対象月</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {data.recurring.map((item) => (
                <tr key={item.id} className={item.active ? "" : "opacity-50"}>
                  <td className={CELL}>
                    <TextInput
                      aria-label="内容"
                      value={item.name}
                      onChange={(e) =>
                        setData((d) => updateRecurring(d, item.id, { name: e.target.value }))
                      }
                    />
                  </td>
                  <EntryFieldCells
                    value={item}
                    accounts={data.accounts}
                    onChange={(patch) =>
                      setData((d) => updateRecurring(d, item.id, patch))
                    }
                  />
                  <td className={CELL}>
                    <NumberInput
                      aria-label="発生日"
                      value={item.day}
                      max={31}
                      onValueChange={(day) =>
                        setData((d) =>
                          updateRecurring(d, item.id, { day: Math.max(1, day) }),
                        )
                      }
                    />
                  </td>
                  <td className={CELL}>
                    <TextInput
                      aria-label="対象月"
                      value={item.months ? item.months.join(",") : ""}
                      placeholder="毎月"
                      onChange={(e) =>
                        setData((d) =>
                          updateRecurring(d, item.id, {
                            months: parseMonthsField(e.target.value),
                          }),
                        )
                      }
                    />
                  </td>
                  <td className={`${CELL} text-right`}>
                    <span className="flex justify-end gap-4">
                      <Button
                        size="sm"
                        onClick={() => setData((d) => toggleRecurringActive(d, item.id))}
                      >
                        {item.active ? "停止" : "再開"}
                      </Button>
                      <Button
                        size="sm"
                        color="danger"
                        onClick={() => setData((d) => removeRecurring(d, item.id))}
                      >
                        削除
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        「日」に31を入れると月末に寄ります（2月は28日か29日）。「対象月」に
        6,8,10,1 と書くとその月だけ発生します（住民税など）。「事業%」が
        家事按分です。100なら全額経費、0なら家計、40なら4割を事業経費として
        集計します。初期値は0です。
      </p>
    </Card>
  );
}
