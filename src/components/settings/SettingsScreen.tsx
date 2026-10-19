"use client";

/**
 * SC-07 予定の設定
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-07、docs/design/screens.md 06
 *   基準日・防衛ライン、口座・カード、定期項目、単発予定、
 *   オーバーライド一覧。
 * 対応する機能要件：FR-01（口座）、FR-02（定期項目）、FR-03（単発予定）
 *
 * **Figma は読み取り専用の表しか描いていない。** 実装は常時編集できる
 * グリッドで、編集をやめると項目を直す手段が画面から消える。
 * **編集は残し、見た目だけ寄せた**（04 の手入力モーダルと同じ扱い）。
 */

import { useState } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Callout } from "@/components/sakiguri/Callout";
import { PageHeader } from "@/components/sakiguri/PageHeader";
import { Panel } from "@/components/sakiguri/Panel";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
} from "@/components/sakiguri/Table";
import { Button } from "@/components/ui/v06/button";
import { DateInput, NumberInput } from "@/components/ui/inputs";
import { buildHeaderStats } from "@/lib/header-stats";
import { formatYearMonthDay, formatYen } from "@/lib/format";
import { describeOverride, listOverrides } from "@/lib/override-view";
import { clearOverride, setAsOf, setReserveLine } from "@/lib/mutations";
import { forecastEnd } from "@/lib/period";

import { AccountsTable } from "./AccountsTable";
import { AsOfDialog } from "./AsOfDialog";
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
  /** Figma 2034:940 は値と［変更］。押すと入力に変わる */
  const [editAsOf, setEditAsOf] = useState(false);
  const [editReserve, setEditReserve] = useState(false);

  if (!today) return <Panel title="予定の設定">読み込み中…</Panel>;

  const overrides = listOverrides(data);

  const to = forecastEnd(data.asOf);
  const series =
    data.accounts.length > 0
      ? buildBalanceSeries(
          {
            accounts: data.accounts,
            asOf: data.asOf,
            forecast: buildForecast(
              {
                recurring: data.recurring,
                oneoffs: data.oneoffs,
                overrides: data.overrides,
              },
              data.asOf,
              to,
            ),
            actuals: data.actuals,
          },
          to,
          today,
        )
      : null;

  return (
    <>
      <PageHeader
        title="予定の設定"
        subtitle="残高を計算するもとになる設定です"
        stats={series ? buildHeaderStats(series, data.accounts, today) : []}
      />

      <div className="flex flex-1 flex-col gap-24 bg-muted px-32 py-24">
        <Callout tone="error">
          ここを変えると、ほかの画面の数字がすべて変わります。日々の記帳では触りません。
        </Callout>

        {/* 基準日と生活防衛ライン — 2034:930 */}
        <Panel title="基準日と生活防衛ライン">
          <div className="flex flex-wrap items-end gap-32">
            <div className="flex flex-col gap-4">
              <span className="t-label-sm text-muted-foreground">
                基準日（残高を計算し始める日）
              </span>
              <div className="flex items-center gap-12">
                {editAsOf ? (
                  <span className="w-ledger">
                    <DateInput
                      autoFocus
                      aria-label="基準日"
                      value={data.asOf}
                      /* **直接は書き換えない。** 確認してから適用する */
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next && next !== data.asOf) setPendingAsOf(next);
                      }}
                    />
                  </span>
                ) : (
                  <span className="num t-h4 text-foreground">
                    {formatYearMonthDay(data.asOf)}
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={() => setEditAsOf((v) => !v)}>
                  {editAsOf ? "閉じる" : "変更"}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <span className="t-label-sm text-muted-foreground">生活防衛ライン</span>
              <div className="flex items-center gap-12">
                {editReserve ? (
                  <span className="w-amount">
                    <NumberInput
                      autoFocus
                      aria-label="生活防衛ライン"
                      value={data.reserveLine}
                      onValueChange={(v) => setData((d) => setReserveLine(d, v))}
                    />
                  </span>
                ) : (
                  <span className="num t-h4 text-foreground">
                    {formatYen(data.reserveLine)}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditReserve((v) => !v)}
                >
                  {editReserve ? "閉じる" : "変更"}
                </Button>
              </div>
            </div>
          </div>

          <Callout tone="caution">
            基準日は変えないでください。変えると、それより前の実績が計算から外れ、
            口座とカードの残高も入れ直しになります。
          </Callout>

          {/* Figma に無い。使い始めの手順はここにしか書いていない */}
          <p className="t-body-sm text-muted-foreground">
            使い始めるときは、基準日に今日の日付、各口座に通帳残高、カードに
            現在の未払額を入れてください。
          </p>
        </Panel>

        <AccountsTable />
        <RecurringTable />
        <OneoffsTable />

        {/* この回だけ変更した予定 — 2034:1150 */}
        <Panel title={`この回だけ変更した予定（${overrides.length}件）`}>
          {overrides.length === 0 ? (
            <p className="py-24 text-center t-body-sm text-muted-foreground">
              変更はありません。
            </p>
          ) : (
            <Table density="compact">
              <TableHeaderRow>
                <TableHead>内容</TableHead>
                <TableHead>変更の内容</TableHead>
                <TableHead />
              </TableHeaderRow>
              <tbody>
                {overrides.map((entry, i) => (
                  <TableRow
                    key={entry.key}
                    fixedHeight
                    last={i === overrides.length - 1}
                    /* Figma 2034:1180 はこの行に薄い帯を敷いている */
                    className="bg-muted/50"
                  >
                    <TableCell>
                      {entry.name ?? (
                        <span className="text-muted-foreground">
                          （元の予定が見つかりません）
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-fg-primary">
                      <span className="num">{describeOverride(entry)}</span>
                      {entry.override.note ? (
                        <span className="block t-body-sm text-muted-foreground">
                          {entry.override.note}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setData((d) => clearOverride(d, entry.key))}
                      >
                        解除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <AsOfDialog
        current={data.asOf}
        next={pendingAsOf}
        onConfirm={(next) => {
          setData((d) => setAsOf(d, next));
          setPendingAsOf(null);
          setEditAsOf(false);
        }}
        onCancel={() => setPendingAsOf(null)}
      />
    </>
  );
}
