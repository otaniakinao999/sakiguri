"use client";

/**
 * 残高ヘッダー（SC-01 共通ヘッダ）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-01、docs/designsystem.md §5
 *   現預金残高・30日後・90日後・カード未払を横に並べる。
 *   スティッキー。白背景、下に border-base-low の罫線。
 */

import { useMemo } from "react";

import { useAppData } from "./AppDataProvider";
import { formatMonthDay, formatSignedYen, formatYen } from "@/lib/format";
import { computeBalanceSummary } from "@/lib/summary";

function Figure({
  label,
  value,
  tone = "base",
}: {
  label: string;
  value: string;
  tone?: "base" | "card";
}) {
  return (
    <div>
      <div
        className={`num text-body-lg leading-none font-semibold tracking-tight ${
          tone === "card" ? "text-object-error-bright" : "text-object-base-high"
        }`}
      >
        {value}
      </div>
      <div className="text-object-base-mid mt-4 text-body-xxs leading-none">
        {label}
      </div>
    </div>
  );
}

export function BalanceHeader() {
  const { data, today } = useAppData();

  const summary = useMemo(
    () => (today ? computeBalanceSummary(data, today) : null),
    [data, today],
  );

  return (
    <header
      className="
        bg-surface-base-primary border-b-border-base-low sticky top-0 z-10
        flex flex-wrap items-end gap-16 border-b px-12 py-16
        wide:gap-32 wide:px-24
      "
    >
      <div>
        <div className="text-object-base-mid text-body-xxs tracking-wide">
          現預金 見込み{today ? `（${formatMonthDay(today)}）` : ""}
        </div>
        <div className="num text-object-base-high mt-4 text-headline-lg leading-none font-semibold tracking-tight wide:text-headline-xlg">
          {summary ? formatYen(summary.current) : "—"}
        </div>
        {/* 見込みの内訳。消し込みが済んでいれば出さない（AC-49b）。
            **件数を並べない（AC-49d）。** 金額は現金が動く日で数えるが、
            件数は発生日で数えるため、並べると内訳に見えて値が食い違う。
            件数を出すのは「実績が未入力の予定」1箇所だけ */}
        {summary !== null && summary.unrecorded.count > 0 && (
          <div className="text-object-base-mid mt-4 text-body-xxs leading-none">
            うち未記録の予定{" "}
            <span className="num">
              {formatSignedYen(summary.unrecorded.amount)}
            </span>
          </div>
        )}
      </div>

      <Figure
        label="30日後の予測"
        value={summary ? formatYen(summary.in30) : "—"}
      />
      <Figure
        label="90日後の予測"
        value={summary ? formatYen(summary.in90) : "—"}
      />
      {summary !== null && summary.cardDue !== 0 && (
        <Figure
          label="カード未払"
          value={formatYen(summary.cardDue)}
          tone="card"
        />
      )}
    </header>
  );
}
