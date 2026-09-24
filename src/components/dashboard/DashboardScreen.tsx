"use client";

/**
 * SC-02 ダッシュボード
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-02
 *
 * **6要素のうち3つに絞っている。**
 *   今後90日の資金繰り（最低残高と警告）
 *   実績が未入力の予定（件数と一覧）
 *   口座・カード残高
 * 当月の予実サマリ、直近の大きな入出金、繰延した予定の一覧は作らない。
 */

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { buildBalanceSeries } from "@/core/balance";
import { categoryOf } from "@/core/categories";
import { daysBetween } from "@/core/date";
import { buildForecast } from "@/core/forecast";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notification } from "@/components/ui/Notification";
import { track } from "@/lib/analytics/track";
import { isEmpty } from "@/lib/app-data";
import { buildDashboard, DASHBOARD_HORIZON_DAYS } from "@/lib/dashboard";
import { buildReconcileWarnings, STRANDED_DAYS } from "@/lib/reconcile-warnings";
import { formatAmount, formatMonthDay, formatYen } from "@/lib/format";
import { forecastEnd } from "@/lib/period";

const CELL = "border-b-border-base-low border-b px-8 py-8";

export function DashboardScreen() {
  const { data, today, session } = useAppData();

  const dashboard = useMemo(() => {
    if (!today || data.accounts.length === 0) return null;
    const to = forecastEnd(data.asOf);
    const forecast = buildForecast(
      {
        recurring: data.recurring,
        oneoffs: data.oneoffs,
        overrides: data.overrides,
      },
      data.asOf,
      to,
    );
    const series = buildBalanceSeries(
      { accounts: data.accounts, asOf: data.asOf, forecast, actuals: data.actuals },
      to,
      today,
    );
    return {
      ...buildDashboard({
        series,
        accounts: data.accounts,
        reserveLine: data.reserveLine,
        today,
      }),
      /* FR-43。消し込みの停止と取り残しは別の警告として出す */
      reconcile: buildReconcileWarnings({
        lastReconciledAt: data.lastReconciledAt,
        asOf: data.asOf,
        unmatchedForecast: series.unmatchedForecast,
        today,
      }),
    };
  }, [data, today]);

  /* 警告を見せたことを1回だけ記録する（指標の分母） */
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!dashboard?.warning || !today || warnedRef.current) return;
    warnedRef.current = true;
    track(session?.user.id, "shortfall_warned", {
      shortfall: dashboard.warning.kind === "shortfall",
      daysAhead: daysBetween(today, dashboard.warning.date),
    });
  }, [dashboard, today, session]);

  if (!today) return <Card title="ダッシュボード">読み込み中…</Card>;

  if (isEmpty(data) || !dashboard) {
    return (
      <Card title="ダッシュボード">
        <p className="text-object-base-high text-body-sm leading-normal">
          まだ口座が登録されていません。
        </p>
        <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
          「予定の設定」で基準日・口座残高・毎月の入出金を登録すると、
          ここに今後90日の見通しが出ます。
        </p>
        <div className="mt-16">
          <Link href="/settings">
            <Button color="black">予定の設定へ</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const { warning, lowest } = dashboard;

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-12 wide:grid-cols-2">
        {/* ---------- 今後90日の資金繰り ---------- */}
        <Card title={`今後${DASHBOARD_HORIZON_DAYS}日の資金繰り`}>
          <div className="text-object-base-mid text-body-xxs tracking-wide">
            最低残高（予測）
          </div>
          <div
            className={`num mt-4 text-headline-lg leading-none font-semibold tracking-tight ${
              warning ? "text-object-error-dim" : "text-object-base-high"
            }`}
          >
            {formatYen(lowest.balance)}
          </div>
          <p className="text-object-base-mid mt-8 text-body-xxs">
            {lowest.date.slice(0, 4)}年{formatMonthDay(lowest.date)} 時点 ／ 現在{" "}
            {formatYen(dashboard.current)}
          </p>

          <div className="mt-12">
            {warning === null ? (
              <p className="text-object-base-mid text-body-xs leading-normal">
                {DASHBOARD_HORIZON_DAYS}日先まで
                {data.reserveLine > 0 ? "防衛ラインを維持できる" : "残高を保てる"}
                見込みです。
              </p>
            ) : (
              <Notification variant={warning.kind === "shortfall" ? "error" : "caution"}>
                {warning.kind === "shortfall" ? (
                  <>
                    <strong className="font-semibold">
                      {formatMonthDay(warning.date)}に残高がマイナスになる予測です。
                    </strong>
                    　支払時期の調整か資金手当てを検討してください。
                  </>
                ) : (
                  <>
                    {formatMonthDay(warning.date)}に生活防衛ライン（
                    {formatYen(data.reserveLine)}）を下回る予測です。
                  </>
                )}
              </Notification>
            )}
          </div>

          {warning && (
            <div className="mt-12 flex flex-wrap gap-8">
              {/* ここを押したことを記録する。指標「残高警告からの操作率」の分子 */}
              <Link
                href="/entry"
                onClick={() =>
                  track(session?.user.id, "shortfall_acted", { toEntry: true })
                }
              >
                <Button color="black">支払日をずらす・実績を入れる</Button>
              </Link>
              <Link
                href="/cashflow"
                onClick={() =>
                  track(session?.user.id, "shortfall_acted", { toEntry: false })
                }
              >
                <Button>資金繰りを見る</Button>
              </Link>
            </div>
          )}
        </Card>

        {/* ---------- 実績が未入力の予定 ---------- */}
        <Card
          title={`実績が未入力の予定（${dashboard.unfilled.length}件）`}
          right={
            dashboard.unfilled.length > 0 ? (
              <Link href="/entry">
                <Button size="sm">消し込む</Button>
              </Link>
            ) : undefined
          }
        >
          {dashboard.unfilled.length === 0 ? (
            <p className="text-object-base-mid py-24 text-center text-body-xs">
              未入力はありません。
            </p>
          ) : (
            <div className="max-h-[var(--layout-dashboard-list-height)] overflow-auto">
              <table className="w-full border-collapse text-body-xs">
                <tbody>
                  {dashboard.unfilled.slice(0, 12).map((plan) => (
                    <tr key={plan.key}>
                      <td className={`${CELL} num text-object-base-mid whitespace-nowrap`}>
                        {formatMonthDay(plan.date)}
                      </td>
                      <td className={CELL}>
                        {plan.name}
                        <span className="text-object-base-mid block text-body-xxs">
                          {categoryOf(plan.categoryCode).name}
                        </span>
                      </td>
                      <td className={`${CELL} num text-right whitespace-nowrap`}>
                        {formatAmount(plan.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
            予定額のまま予測に残っています。実績を入れて消し込むか、支払日を
            ずらしてください。残しておくと残高を実際より低く見積もります。
          </p>
        </Card>
      </div>

      {/* ---------- 口座・カード ---------- */}
      <Card title="口座・カード">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-xs">
            <tbody>
              {dashboard.accounts.map(({ account, balance }) => (
                <tr key={account.id}>
                  <td className={CELL}>{account.name}</td>
                  <td
                    className={`${CELL} num text-right whitespace-nowrap ${
                      balance < 0 ? "text-object-error-dim" : ""
                    }`}
                  >
                    {formatAmount(balance)}
                  </td>
                </tr>
              ))}
              <tr>
                <td
                  className={`${CELL} bg-surface-accent-subtle border-t-object-base-high border-t-2 font-semibold`}
                >
                  現預金 合計
                </td>
                <td
                  className={`${CELL} bg-surface-accent-subtle num border-t-object-base-high border-t-2 text-right font-semibold whitespace-nowrap`}
                >
                  {formatAmount(dashboard.total)}
                </td>
              </tr>
              {dashboard.cards.map(({ card, due, next }) => (
                <tr key={card.id}>
                  <td className={CELL}>
                    {card.name}
                    <span className="text-object-base-mid block text-body-xxs">
                      次回引落{" "}
                      {next
                        ? `${formatMonthDay(next.date)} ${formatAmount(next.amount)}円`
                        : "—"}
                    </span>
                  </td>
                  <td
                    className={`${CELL} num text-object-error-bright text-right whitespace-nowrap`}
                  >
                    {formatAmount(due)}
                    <span className="text-object-base-mid block text-body-xxs">
                      未払
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- 消し込みの警告（FR-43）---------- */}
      {(dashboard.reconcile.stalled || dashboard.reconcile.stranded) && (
        <div className="flex flex-col gap-8">
          {dashboard.reconcile.stalled && (
            <Notification variant="caution">
              <strong className="font-semibold">
                消し込みが{dashboard.reconcile.stalled.sinceDays}日止まっています。
              </strong>
              　予測が予定額に依存しきっているため、残高が実態とずれている
              可能性があります。CSVを取り込むか、実績を入れてください。
              <span className="mt-8 block">
                <Link href="/import">
                  <Button size="sm">CSVを取り込む</Button>
                </Link>
              </span>
            </Notification>
          )}
          {dashboard.reconcile.stranded && (
            <Notification variant="caution">
              <strong className="font-semibold">
                {STRANDED_DAYS}日以上前の予定が
                {dashboard.reconcile.stranded.count}件、消し込まれずに
                残っています。
              </strong>
              　最も古いものは{formatMonthDay(dashboard.reconcile.stranded.oldest)}
              です。実績を入れるか、繰延してください。
              <span className="mt-8 block">
                <Link href="/entry">
                  <Button size="sm">要対応を見る</Button>
                </Link>
              </span>
            </Notification>
          )}
        </div>
      )}

      {/*
        要件定義書 §7 制約3。
        「利用者にはその旨を画面上で注記する」と明記されている。
      */}
      <p className="text-object-base-mid text-body-xxs leading-normal">
        借入の返済を定期項目1件として登録している場合、元金と利息が分かれない
        ため、年月別収支の費用が実際より大きく出ます（資金繰りの予測は実態と
        一致します）。元金と利息の自動分離は v2.0 で対応します。
      </p>
    </div>
  );
}
