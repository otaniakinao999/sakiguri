"use client";

/**
 * 二重計上の候補（FR-46、AC-30）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-3「未消込の過去予定の扱い」、CL-7「予定との自動照合」
 *
 * `key` を持たない実績は消し込みに掛からないため、同じ取引が予定と実績の
 * 両方で残高に乗る。残高が低く出ると防衛ラインの警告が誤って鳴る。
 *
 * **自動では消し込まない。** 候補として見せ、利用者が「同じ取引」と確定した
 * ときだけ紐づける。金額と日付が近いという理由で残高から消すと、利用者が
 * 気づけない誤りになる。
 */

import { categoryOf } from "@/core/categories";
import type { Account } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notification } from "@/components/ui/Notification";
import { formatAmount, formatMonthDay } from "@/lib/format";
import { linkActualToPlan } from "@/lib/mutations";
import type { DoubleCount } from "@/lib/reconcile";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";

export function DoubleCountCard({
  candidates,
  accounts,
}: {
  candidates: DoubleCount[];
  accounts: Account[];
}) {
  const { setData } = useAppData();
  if (candidates.length === 0) return null;

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? "—";

  /** 二重に乗っている額。予定ぶんが余計に引かれている */
  const doubled = candidates.reduce((sum, c) => sum + c.plan.amount, 0);

  return (
    <Card title={`二重計上のおそれ（${candidates.length}件）`}>
      <Notification variant="caution">
        予定と実績の両方が残高に乗っています。
        <strong className="font-semibold">
          残高が {formatAmount(doubled)}円 低く出ています。
        </strong>
        同じ取引なら「同じ取引」を押して紐づけてください。
      </Notification>

      <div className="mt-12 overflow-x-auto">
        <table className="w-full border-collapse text-body-xs">
          <tbody>
            {candidates.map(({ actual, plan, dayGap }) => (
              <tr key={actual.id}>
                <td className={CELL}>
                  <span className="text-object-base-mid block text-body-xxs">
                    実績
                  </span>
                  <span className="num">{formatMonthDay(actual.date)}</span>{" "}
                  {actual.name}
                  <span className="text-object-base-mid block text-body-xxs">
                    {categoryOf(actual.categoryCode).name} ／{" "}
                    {accountName(actual.accountId)}
                  </span>
                </td>
                <td className={CELL}>
                  <span className="text-object-base-mid block text-body-xxs">
                    予定
                  </span>
                  <span className="num">{formatMonthDay(plan.date)}</span>{" "}
                  {plan.name}
                  <span className="text-object-base-mid block text-body-xxs">
                    {categoryOf(plan.categoryCode).name} ／{" "}
                    {dayGap === 0 ? "同じ日" : `${dayGap}日違い`}
                  </span>
                </td>
                <td className={`${CELL} num text-right whitespace-nowrap`}>
                  {formatAmount(actual.amount)}
                </td>
                <td className={`${CELL} text-right`}>
                  <Button
                    size="sm"
                    color="black"
                    onClick={() =>
                      setData((d) => linkActualToPlan(d, actual.id, plan.key))
                    }
                  >
                    同じ取引
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        金額・収支の向き・口座が一致し、日付が12日以内のものを候補にしています。
        別の取引なら何もしなくて構いません。自動では消し込みません。
      </p>
    </Card>
  );
}
