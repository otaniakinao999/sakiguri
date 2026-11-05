"use client";

/**
 * 単発の予定（FR-03、SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2 OneoffItem
 *   RecurringItem から day / months / active を除き、date を持つ。
 *
 * **実績が付いたものは既定で隠す。** 単発の予定は実績が付けば終わるので、
 * 残り続けると項目が増えるほど、これから起きる予定が読めなくなる。
 * **消さずに隠すだけにする。** 片道で消すと、間違って登録した実績を
 * 直す道が画面から消える。
 *
 * **並べ替えは押したときだけ並び直す。** 日付欄は編集できるので、
 * 描画のたびに並べ直すと日付を直した瞬間に行が動く（`lib/plan-order.ts`）。
 */

import { useMemo, useState } from "react";

import type { OneoffItem } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Panel } from "@/components/sakiguri/Panel";
import { SortableHeader } from "@/components/sakiguri/SortableHeader";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { DateInput, TextInput } from "@/components/ui/inputs";
import {
  addOneoff,
  blankOneoff,
  newId,
  removeOneoff,
  updateOneoff,
} from "@/lib/mutations";
import type { PlanSort } from "@/lib/plan-order";
import { settledOneoffIds } from "@/lib/settled-plans";

import { EntryFieldCells } from "./EntryFields";
import { usePlanOrder } from "./use-plan-order";

const CELL = "border-b border-border px-cell py-8 align-top";
const HEAD =
  "border-b border-border bg-muted px-cell py-8 text-left t-label-sm text-muted-foreground whitespace-nowrap";

/** 既定は日付の昇順。これまでの並びと同じ */
const DEFAULT_SORT: PlanSort = { column: "when", direction: "asc" };

/** 日付列の値。**1箇所だけに置く。** 2箇所に書くと片方だけ直る */
const whenOf = (item: OneoffItem) => item.date;

export function OneoffsTable() {
  const { data, setData, today, session } = useAppData();

  const settled = useMemo(() => settledOneoffIds(data.actuals), [data.actuals]);
  const [showSettled, setShowSettled] = useState(false);

  const rows = useMemo(
    () => (showSettled ? data.oneoffs : data.oneoffs.filter((o) => !settled.has(o.id))),
    [data.oneoffs, settled, showSettled],
  );

  const accountIds = useMemo(() => data.accounts.map((a) => a.id), [data.accounts]);

  const { sort, onSort, visible } = usePlanOrder(rows, accountIds, whenOf, DEFAULT_SORT);

  const hidden = data.oneoffs.length - rows.length;

  return (
    <Panel
      title={`単発の予定（${data.oneoffs.length}件）`}
      count={
        hidden > 0 && !showSettled ? `実績が付いた${hidden}件を隠しています` : undefined
      }
      action={
        <>
          {settled.size > 0 ? (
            <CheckboxField
              id="show-settled-oneoffs"
              checked={showSettled}
              onCheckedChange={setShowSettled}
              className="mr-8"
            >
              <span className="t-body-sm text-muted-foreground">済みも表示</span>
            </CheckboxField>
          ) : null}
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
        </>
      }
    >
      {visible.length === 0 ? (
        <p className="text-muted-foreground py-24 text-center t-body-sm">
          {data.oneoffs.length === 0
            ? "予定納税、設備投資、大型の入金など、1回限りのものを登録します。"
            : "これから起きる単発の予定はありません。実績が付いたものは「済みも表示」で出せます。"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* **w-full にしない。** 器に合わせると列が潰れて、金額や事業割合が
              読めない細い箱になる。内容ぶんの幅を取らせて、親の
              overflow-x-auto で横に送る */}
          <table className="w-max min-w-full border-collapse t-body-sm">
            <thead>
              <tr>
                <SortableHeader
                  label="日付"
                  column="when"
                  sort={sort}
                  onSort={onSort}
                  className={HEAD}
                />
                <SortableHeader
                  label="内容"
                  column="name"
                  sort={sort}
                  onSort={onSort}
                  className={`${HEAD} min-w-[var(--layout-field-width)]`}
                />
                <SortableHeader
                  label="収支"
                  column="type"
                  sort={sort}
                  onSort={onSort}
                  className={HEAD}
                />
                <SortableHeader
                  label="固定/変動"
                  column="costType"
                  sort={sort}
                  onSort={onSort}
                  className={HEAD}
                />
                <SortableHeader
                  label="費目"
                  column="category"
                  sort={sort}
                  onSort={onSort}
                  className={HEAD}
                />
                <SortableHeader
                  label="金額"
                  column="amount"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                  className={`${HEAD} text-right`}
                />
                <th className={HEAD}>事業%</th>
                <SortableHeader
                  label="口座"
                  column="account"
                  sort={sort}
                  onSort={onSort}
                  className={HEAD}
                />
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className={settled.has(item.id) ? "opacity-50" : ""}>
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
