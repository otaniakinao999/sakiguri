"use client";

/**
 * SC-07 予定の設定
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-07
 *   基準日・防衛ライン、口座・カード、定期項目、単発予定、
 *   オーバーライド一覧。
 * 対応する機能要件：FR-01（口座）、FR-02（定期項目）、FR-03（単発予定）
 */

import { useState } from "react";

import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Notification } from "@/components/ui/Notification";
import { DateInput, Field, NumberInput } from "@/components/ui/inputs";
import { formatYearMonthDay } from "@/lib/format";
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
  /**
   * 基準日を変えようとしている日付。null なら確認を出していない。
   *
   * **変更そのものは止めない。** OI-6（締め処理として基準日を前に進める
   * 操作を許すか）が未決なので、仕組みで禁じると後で外すことになる。
   * ここで止めたいのは**気づかないまま変わること**だけである。
   */
  const [pendingAsOf, setPendingAsOf] = useState<string | null>(null);

  if (!today) return <Card title="予定の設定">読み込み中…</Card>;

  const overrides = listOverrides(data);

  /**
   * 基準日を変更する前の確認（OI-6）。
   *
   * **止めるためではなく、気づくために出す。** 変更そのものは通す。
   *
   * 文面に3つを入れる。
   *
   * 1. この日付より前の実績が残高計算から外れること
   * 2. 口座の残高が「新しい基準日時点の残高」として読まれること
   * 3. **変更前の日付** ── これが要る。元に戻すには何日だったかが要るが、
   *    変えたあとの画面にはどこにも残らない
   */
  const confirmAsOf = pendingAsOf !== null && (
    <Modal title="基準日を変更しますか" onClose={() => setPendingAsOf(null)}>
      <div className="flex flex-col gap-12">
        <table className="w-full border-collapse text-body-xs">
          <tbody>
            <tr>
              <td className="text-object-base-mid py-4 pr-16 whitespace-nowrap">
                いまの基準日
              </td>
              <td className="num text-object-base-high py-4 font-semibold">
                {formatYearMonthDay(data.asOf)}
              </td>
            </tr>
            <tr>
              <td className="text-object-base-mid py-4 pr-16 whitespace-nowrap">
                変更後
              </td>
              <td className="num text-object-base-high py-4 font-semibold">
                {formatYearMonthDay(pendingAsOf)}
              </td>
            </tr>
          </tbody>
        </table>

        <Notification variant="caution">
          <strong className="font-semibold">
            この日付より前の実績は、残高の計算から外れます。
          </strong>
          　口座の残高は「{formatYearMonthDay(pendingAsOf)}
          時点の残高」として読み直されます。いま入れてある金額の意味が
          変わるので、口座とカードの残高も入れ直しが要ります。
        </Notification>

        <p className="text-object-base-mid text-body-xxs leading-normal">
          元に戻すには、基準日を{" "}
          <strong className="text-object-base-high num font-semibold">
            {formatYearMonthDay(data.asOf)}
          </strong>{" "}
          に設定し直してください。
          <strong className="text-object-base-high font-semibold">
            この日付は変更後の画面に残りません。
          </strong>
          　必要なら控えてから進めてください。
        </p>

        <div className="flex flex-wrap gap-8">
          <Button
            color="black"
            onClick={() => {
              setData((d) => setAsOf(d, pendingAsOf));
              setPendingAsOf(null);
            }}
          >
            変更する
          </Button>
          <Button onClick={() => setPendingAsOf(null)}>やめる</Button>
        </div>
      </div>
    </Modal>
  );

  return (
    <div className="flex flex-col gap-12">
      {confirmAsOf}
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
                  /* **直接は書き換えない。** 確認してから適用する */
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next && next !== data.asOf) setPendingAsOf(next);
                  }}
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
