"use client";

/**
 * 定期項目（FR-02、SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2 RecurringItem
 *   day は 1〜31。31 は月末になる（CL-1）。
 *   months が null なら毎月、配列ならその月だけ。
 *   active を false にすると展開しない（停止）。
 *
 * **並べ替えは押したときだけ並び直す。** 発生日や金額の欄は編集できるので、
 * 描画のたびに並べ直すと1打鍵ごとに行が動く（`lib/plan-order.ts`）。
 *
 * **既定は発生日の昇順。** これまでは登録した順だった。月の支払いを
 * 追うときに見る順と違っていた。
 */

import { useMemo } from "react";

import type { RecurringItem } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { SortableHeader } from "@/components/sakiguri/SortableHeader";
import type { PlanSort } from "@/lib/plan-order";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/sakiguri/Panel";
import { MonthsInput, NumberInput, TextInput } from "@/components/ui/inputs";
import {
  addRecurring,
  blankRecurring,
  newId,
  removeRecurring,
  toggleRecurringActive,
  updateRecurring,
} from "@/lib/mutations";

import { planAnchorId } from "@/lib/plan-anchor";

import { EntryFieldCells } from "./EntryFields";
import { usePlanOrder } from "./use-plan-order";

const CELL = "border-b border-border px-cell py-8 align-top";
const HEAD =
  "border-b border-border bg-muted px-cell py-8 text-left t-label-sm text-muted-foreground whitespace-nowrap";

/** 既定は発生日の昇順 */
const DEFAULT_SORT: PlanSort = { column: "when", direction: "asc" };

/** 日付列の値。**1箇所だけに置く。** 発生日は数なので数のまま渡す */
const whenOf = (item: RecurringItem) => item.day;

export function RecurringTable({ focus }: { focus?: string | null } = {}) {
  const { data, setData, session } = useAppData();

  const accountIds = useMemo(() => data.accounts.map((a) => a.id), [data.accounts]);
  const { sort, onSort, visible } = usePlanOrder(
    data.recurring,
    accountIds,
    whenOf,
    DEFAULT_SORT,
  );

  return (
    <Panel
      title={`定期項目（${data.recurring.length}件）`}
      action={
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
        <p className="text-muted-foreground py-24 text-center t-body-sm">
          毎月の家賃・売上・保険料などを登録すると、予測が立ち上がります。
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
                <SortableHeader
                  label="日"
                  column="when"
                  sort={sort}
                  onSort={onSort}
                  className={HEAD}
                />
                <th className={HEAD}>対象月</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                /* **明細の予定の行から飛んでくる**（FR-57・AC-63）。
                   id は `planAnchorId` が1箇所で作る ―― リンク側と別々に
                   組み立てると、押しても何も起きないリンクができる（§2.8）。
                   飛んできた行は `:target` で色が付く */
                <tr
                  key={item.id}
                  id={planAnchorId("recurring", item.id)}
                  className={`scroll-mt-64${
                    focus === planAnchorId("recurring", item.id)
                      ? " bg-primary-subtle"
                      : ""
                  }${item.active ? "" : " opacity-50"}`}
                >
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
                    <MonthsInput
                      aria-label="対象月"
                      value={item.months}
                      placeholder="毎月"
                      onValueChange={(months) =>
                        setData((d) => updateRecurring(d, item.id, { months }))
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
                        variant="destructive"
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
      <p className="text-muted-foreground mt-12 t-body-sm leading-normal">
        「日」に31を入れると月末に寄ります（2月は28日か29日）。「対象月」に
        6,8,10,1 と書くとその月だけ発生します（住民税など）。「事業%」が
        家事按分です。100なら全額経費、0なら家計、40なら4割を事業経費として
        集計します。初期値は0です。
      </p>
    </Panel>
  );
}
