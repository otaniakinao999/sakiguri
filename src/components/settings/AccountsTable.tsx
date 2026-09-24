"use client";

/**
 * 口座・カードの登録（FR-01、SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2 Account
 *   card のときは 締日・支払月・支払日・引落元口座が必須。
 */

import type { Account, CardAccount } from "@/core/types";
import { isCard } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { NumberInput, Select, TextInput } from "@/components/ui/inputs";
import {
  addAccount,
  blankBankAccount,
  blankCardAccount,
  newId,
  removeAccount,
  updateAccount,
} from "@/lib/mutations";

const CELL = "border-b-border-base-low border-b px-8 py-8 align-top";
const HEAD =
  "bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-8 py-8 text-left text-body-xxs font-semibold tracking-wide whitespace-nowrap";

export function AccountsTable() {
  const { data, setData } = useAppData();
  const deposits = data.accounts.filter((a) => !isCard(a));

  const patch = (id: string, value: Partial<Account>) =>
    setData((d) => updateAccount(d, id, value));

  return (
    <Card
      title={`口座・カード（${data.accounts.length}件）`}
      right={
        <span className="flex gap-8">
          <Button
            size="sm"
            onClick={() => setData((d) => addAccount(d, blankBankAccount(newId())))}
          >
            ＋ 口座
          </Button>
          <Button
            size="sm"
            disabled={deposits.length === 0}
            onClick={() =>
              setData((d) =>
                addAccount(d, blankCardAccount(newId(), deposits[0]?.id ?? "")),
              )
            }
          >
            ＋ カード
          </Button>
        </span>
      }
    >
      {data.accounts.length === 0 ? (
        <p className="text-object-base-mid py-24 text-center text-body-xs">
          まず口座を1つ登録してください。ここが資金繰りの起点になります。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-xs">
            <thead>
              <tr>
                <th className={`${HEAD} min-w-[var(--layout-field-width)]`}>名前</th>
                <th className={HEAD}>種類</th>
                <th className={`${HEAD} text-right`}>基準日の残高／確定金額</th>
                <th className={`${HEAD} text-right`}>未確定分</th>
                <th className={HEAD}>締日</th>
                <th className={HEAD}>支払月</th>
                <th className={HEAD}>支払日</th>
                <th className={HEAD}>引落口座</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => (
                <tr key={account.id}>
                  <td className={CELL}>
                    <TextInput
                      aria-label="名前"
                      value={account.name}
                      onChange={(e) => patch(account.id, { name: e.target.value })}
                    />
                  </td>
                  <td className={CELL}>
                    <Select
                      aria-label="種類"
                      value={account.kind}
                      onChange={(e) => {
                        const kind = e.target.value;
                        setData((d) =>
                          updateAccount(
                            d,
                            account.id,
                            kind === "card"
                              ? (blankCardAccount(account.id, deposits[0]?.id ?? "") as CardAccount)
                              : { kind: kind as "bank" | "cash" },
                          ),
                        );
                      }}
                    >
                      <option value="bank">銀行</option>
                      <option value="cash">現金</option>
                      <option value="card">カード</option>
                    </Select>
                  </td>
                  <td className={CELL}>
                    <NumberInput
                      aria-label={isCard(account) ? "確定金額" : "残高"}
                      value={account.balance}
                      /* 口座はマイナスを許す（当座借越・残高マイナス）。
                         カードの未払は「正の値」と決まっている（§3.2）。
                         返金はカードの未払ではなく口座側で処理する */
                      allowNegative={!isCard(account)}
                      onValueChange={(balance) => patch(account.id, { balance })}
                    />
                  </td>
                  <td className={CELL}>
                    {isCard(account) ? (
                      /* CL-2 手順4。確定金額は最初の引落日、未確定分はその次の
                         引落日に載せる。1つにまとめると最大1ヶ月ぶんの支出を
                         前倒しで計上してしまう（AC-36） */
                      <NumberInput
                        aria-label="未確定分"
                        value={account.unbilledBalance ?? 0}
                        onValueChange={(unbilledBalance) =>
                          patch(account.id, { unbilledBalance } as Partial<Account>)
                        }
                      />
                    ) : (
                      <span className="text-object-base-mid">—</span>
                    )}
                  </td>
                  {isCard(account) ? (
                    <>
                      <td className={CELL}>
                        <NumberInput
                          aria-label="締日"
                          value={account.closingDay}
                          max={31}
                          onValueChange={(closingDay) =>
                            patch(account.id, { closingDay: Math.max(1, closingDay) } as Partial<Account>)
                          }
                        />
                      </td>
                      <td className={CELL}>
                        <Select
                          aria-label="支払月"
                          value={account.payMonthOffset}
                          onChange={(e) =>
                            patch(account.id, {
                              payMonthOffset: Number(e.target.value),
                            } as Partial<Account>)
                          }
                        >
                          <option value={0}>当月</option>
                          <option value={1}>翌月</option>
                          <option value={2}>翌々月</option>
                        </Select>
                      </td>
                      <td className={CELL}>
                        <NumberInput
                          aria-label="支払日"
                          value={account.payDay}
                          max={31}
                          onValueChange={(payDay) =>
                            patch(account.id, { payDay: Math.max(1, payDay) } as Partial<Account>)
                          }
                        />
                      </td>
                      <td className={CELL}>
                        <Select
                          aria-label="引落口座"
                          value={account.settleAccountId}
                          onChange={(e) =>
                            patch(account.id, {
                              settleAccountId: e.target.value,
                            } as Partial<Account>)
                          }
                        >
                          {deposits.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </>
                  ) : (
                    <td className={`${CELL} text-object-base-mid`} colSpan={4}>
                      —
                    </td>
                  )}
                  <td className={`${CELL} text-right`}>
                    <Button
                      size="sm"
                      color="danger"
                      onClick={() => setData((d) => removeAccount(d, account.id))}
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
      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        例：15日締め・翌月10日払いなら 締日15／支払月「翌月」／支払日10。
        カードで払った支出は、利用日ではなくこの日に口座から出ていく前提で
        残高を計算します。口座を削除すると、その口座を使う予定と実績も
        一緒に消えます。
        カードの「確定金額」には次回引き落とされる金額を、「未確定分」には
        まだ請求が確定していない利用額を入れてください。カード会社の明細に
        その2つが並んで載っています。分けずに合計を入れると、1ヶ月先に
        落ちるはずの金額まで次回に計上され、残高が実際より低く出ます。
      </p>
    </Card>
  );
}
