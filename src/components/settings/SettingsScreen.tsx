"use client";

/**
 * SC-07 予定の設定
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-07
 *   基準日・防衛ライン、口座・カード、定期項目、単発予定、
 *   オーバーライド一覧。
 * 対応する機能要件：FR-01（口座）、FR-02（定期項目）、FR-03（単発予定）
 */

import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateInput, Field, NumberInput } from "@/components/ui/inputs";
import { describeOverride, listOverrides } from "@/lib/override-view";
import {
  clearOverride,
  setAsOf,
  setReserveLine,
} from "@/lib/mutations";

import { AccountsTable } from "./AccountsTable";
import { OneoffsTable } from "./OneoffsTable";
import { RecurringTable } from "./RecurringTable";

export function SettingsScreen() {
  const { data, setData, today } = useAppData();

  if (!today) return <Card title="予定の設定">読み込み中…</Card>;

  const overrides = listOverrides(data);

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-12 wide:grid-cols-2">
        {/* ---------- 基準日と防衛ライン ---------- */}
        <Card title="基準日と生活防衛ライン">
          <div className="grid gap-8 wide:grid-cols-2">
            <Field
              label="基準日"
              hint="この日の口座残高を入力値として与えます"
            >
              {(id) => (
                <DateInput
                  id={id}
                  value={data.asOf}
                  onChange={(e) => setData((d) => setAsOf(d, e.target.value))}
                />
              )}
            </Field>
            <Field
              label="生活防衛ライン"
              hint="下回ると警告します。法人では必要運転資金ライン"
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={data.reserveLine}
                  onValueChange={(v) => setData((d) => setReserveLine(d, v))}
                />
              )}
            </Field>
          </div>
          <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
            使い始めるときは、基準日に今日の日付、各口座に通帳残高、カードに
            現在の未払額を入れてください。
          </p>
        </Card>

        {/* ---------- オーバーライド一覧 ---------- */}
        <Card title={`この回だけ変更した予定（${overrides.length}件）`}>
          {overrides.length === 0 ? (
            <p className="text-object-base-mid py-24 text-center text-body-xs">
              変更はありません。
            </p>
          ) : (
            <table className="w-full border-collapse text-body-xs">
              <tbody>
                {overrides.map((entry) => (
                  <tr key={entry.key}>
                    <td className="border-b-border-base-low border-b px-8 py-8">
                      {entry.name ?? (
                        <span className="text-object-base-mid">
                          （元の予定が見つかりません）
                        </span>
                      )}
                      <span className="text-object-base-mid num block text-body-xxs">
                        {describeOverride(entry)}
                      </span>
                      {entry.override.note && (
                        <span className="text-object-base-mid block text-body-xxs">
                          {entry.override.note}
                        </span>
                      )}
                    </td>
                    <td className="border-b-border-base-low border-b px-8 py-8 text-right">
                      <Button
                        size="sm"
                        color="danger"
                        onClick={() => setData((d) => clearOverride(d, entry.key))}
                      >
                        解除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <AccountsTable />
      <RecurringTable />
      <OneoffsTable />
    </div>
  );
}
