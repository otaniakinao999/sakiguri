"use client";

/**
 * 繰延（この回だけの変更）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-1 手順4、§4.2 繰延操作
 * 対応する機能要件：FR-07（日付変更・金額変更・当回スキップ）、FR-55
 * 対応する受入基準：AC-59、AC-60
 *
 * **定期項目そのものは変えない。** 動かすのはこの1回だけ。
 *
 * **自分で面を持たない。** 以前は `Card` を持ち、画面の末尾に裸で
 * 置かれていた。押した行が画面の上のほうにあると**開いたことに気づけず**、
 * 利用者が「今回は無し」を見つけられなかった。出し方は `Modal` に
 * 一本化してある（AC-60）。題と［閉じる］と Esc は `Modal` が持つので、
 * ここでは繰り返さない。
 */

import { useState } from "react";

import type { ForecastInstance, Yen } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/legacy/Button";
import { DateInput, Field, NumberInput, TextInput } from "@/components/ui/inputs";
import { clearOverride, markReconciled, setOverride } from "@/lib/mutations";

export function DeferralEditor({
  plan,
  initialAmount,
  onClose,
}: {
  plan: ForecastInstance;
  /**
   * ［実際の金額］に打たれていた額（AC-59）。
   *
   * **打った額を捨てない。** 一部だけ払えた回を繰延するとき、以前は
   * `plan.amount` で初期化していたので、同じ額をもう一度打ち直す
   * ことになっていた。打っていなければ渡されず、予定の額が出る。
   *
   * **`plan` そのものには混ぜない。** 下の「実際に変えたものだけを
   * 書く」判定が `plan.amount` と比べているため、混ぜると打った額が
   * 「変えていない」と見なされて記録から落ちる。
   */
  initialAmount?: Yen;
  onClose: () => void;
}) {
  const { data, setData, session, today } = useAppData();
  const existing = data.overrides[plan.key];

  const [date, setDate] = useState(plan.date);
  const [amount, setAmount] = useState(initialAmount ?? plan.amount);
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
    <>
      <div className="grid gap-8 wide:grid-cols-3">
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
      </div>

      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        この回だけ動かします。定期項目そのものは変わりません。資金繰りの残高は
        動きますが、年月別収支ではその予定が移動先の月に移ります。
      </p>
    </>
  );
}
