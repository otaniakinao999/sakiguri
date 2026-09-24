"use client";

/**
 * 繰延（この回だけの変更）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-1 手順4、§4.2 繰延操作
 * 対応する機能要件：FR-07（日付変更・金額変更・当回スキップ）
 *
 * **定期項目そのものは変えない。** 動かすのはこの1回だけ。
 */

import { useState } from "react";

import type { ForecastInstance } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, Field, NumberInput, TextInput } from "@/components/ui/inputs";
import { clearOverride, markReconciled, setOverride } from "@/lib/mutations";

export function DeferralEditor({
  plan,
  onClose,
}: {
  plan: ForecastInstance;
  onClose: () => void;
}) {
  const { data, setData, session, today } = useAppData();
  const existing = data.overrides[plan.key];

  const [date, setDate] = useState(plan.date);
  const [amount, setAmount] = useState(plan.amount);
  const [note, setNote] = useState(existing?.note ?? "");

  const apply = (patch: Parameters<typeof setOverride>[2] | null) => {
    setData((d) => {
      const next =
        patch === null ? clearOverride(d, plan.key) : setOverride(d, plan.key, patch);
      /* 繰延も消し込み操作のひとつ（FR-43、§3.2 Settings） */
      return today ? markReconciled(next, today) : next;
    });
    if (patch !== null) {
      track(session?.user.id, "plan_deferred", {
        skipped: patch.skipped === true,
      });
    }
    onClose();
  };

  return (
    <Card title={`この回だけ動かす — ${plan.name}`}>
      <div className="grid gap-8 wide:grid-cols-4">
        <Field label="支払日を変更">
          {(id) => (
            <DateInput id={id} value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <Field label="金額を変更">
          {(id) => (
            <NumberInput id={id} value={amount} onValueChange={setAmount} />
          )}
        </Field>
        <Field label="理由のメモ">
          {(id) => (
            <TextInput
              id={id}
              value={note}
              placeholder="資金繰りの都合で延期"
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="mt-12 flex flex-wrap gap-8">
        <Button
          color="black"
          disabled={date === plan.date && amount === plan.amount && !note.trim()}
          onClick={() =>
            /* 実際に変えたものだけを書く。変えていない金額まで記録すると、
               あとで定期項目の金額を直したときに、この回だけ古い額に
               固定されてしまう。 */
            apply({
              date: date === plan.date ? undefined : date,
              amount: amount === plan.amount ? undefined : amount,
              note: note.trim() || undefined,
            })
          }
        >
          この回だけ変更
        </Button>
        <Button onClick={() => apply({ skipped: true })}>今回は無し</Button>
        {existing && (
          <Button color="danger" onClick={() => apply(null)}>
            元に戻す
          </Button>
        )}
        <Button color="line_gray" onClick={onClose}>
          閉じる
        </Button>
      </div>

      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        この回だけ動かします。定期項目そのものは変わりません。資金繰りの残高は
        動きますが、年月別収支ではその予定が移動先の月に移ります。
      </p>
    </Card>
  );
}
