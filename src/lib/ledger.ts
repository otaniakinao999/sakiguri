/**
 * 入出金予定表のビューモデル（SC-03）
 *
 * 一次情報：docs/要件定義書.md §4.2 SC-03 入出金予定表の詳細要件
 * 対応する機能要件：FR-12
 * 対応する受入基準：AC-08
 *
 * **現金ベース。** カード払いの明細はここに出ず、締め日ごとにまとまった
 * 「引落」として現れる（CL-2）。年月別収支の発生日ベースとは日付が違う。
 */

import type { BalanceSeries } from "@/core/balance";
import { groupOfCategory } from "@/core/categories";
import { compareDate, compareString, toYearMonth } from "@/core/date";
import type { MonthlyCashflowRow, ShortfallWarning } from "@/core/monthly";
import type { CashEvent, DateStr, Yen, YearMonth } from "@/core/types";

/**
 * 種別フィルタ（要件定義書 §4.2）。
 *
 * すべて／入金／固定費／変動費／カード引落／振替。
 */
export type LedgerKind =
  | "all"
  | "income"
  | "fixed"
  | "variable"
  | "settle"
  | "transfer";

/** 状態フィルタ（要件定義書 §4.2）。予定+実績／予定のみ／実績のみ。 */
export type LedgerStatus = "all" | "plan" | "actual";

export const LEDGER_KINDS: readonly { value: LedgerKind; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "income", label: "入金" },
  { value: "fixed", label: "固定費" },
  { value: "variable", label: "変動費" },
  { value: "settle", label: "カード引落" },
  { value: "transfer", label: "振替" },
];

export const LEDGER_STATUSES: readonly { value: LedgerStatus; label: string }[] =
  [
    { value: "all", label: "予定+実績" },
    { value: "plan", label: "予定のみ" },
    { value: "actual", label: "実績のみ" },
  ];

/** 明細1行。 */
export interface LedgerEntry extends CashEvent {
  /** 実績として登録済みか、まだ予定か */
  status: "plan" | "actual";
  /** その日の予測残高（要件定義書 §4.2 明細列） */
  balance: Yen;
  /** 繰延された行か。背景色を変え、元の日付を併記する */
  deferred: boolean;
  /** 繰延前の日付。繰延されていなければ undefined */
  origDate?: DateStr;
  /** 生成物なので繰延できない（カード引落）*/
  editable: boolean;
}

/** 年月ごとのまとまり（要件定義書 §4.2 月グループ）。 */
export interface LedgerMonthGroup {
  yearMonth: YearMonth;
  entries: LedgerEntry[];
  /** 絞り込み後の件数 */
  count: number;
  /** 絞り込み後の入金計 */
  inflow: Yen;
  /** 絞り込み後の出金計 */
  outflow: Yen;
  /** 月末残高。絞り込みに関わらず残高の事実 */
  closing: Yen | null;
  /** 月中最低。同上 */
  lowest: Yen | null;
  /** 防衛ライン割れ／資金ショートの注記。無ければ null */
  warning: ShortfallWarning | null;
}

export interface LedgerView {
  groups: LedgerMonthGroup[];
  /** ヘッダに出す、絞り込み後の合計（要件定義書 §4.2 集計） */
  total: { count: number; inflow: Yen; outflow: Yen };
}

export interface LedgerInput {
  series: BalanceSeries;
  /** CL-6 の出力。月末残高・月中最低・警告をここから取る */
  monthly: MonthlyCashflowRow[];
  /** 表示する最初の年月（両端を含む） */
  from: YearMonth;
  /** 表示する最後の年月（両端を含む） */
  to: YearMonth;
  kind: LedgerKind;
  status: LedgerStatus;
}

/**
 * 種別フィルタに合うか。
 *
 * カード引落は `src === 'settle'`。振替は**資金移動（TRF）グループ全体**を
 * 指す。要件定義書 §4.2 のフィルタ一覧は費目マスタ（v1.5 で追加）より前に
 * 書かれており、借入返済の元金（TRF-06）のような `type = expense` の
 * 資金移動が想定されていない。TRF はすべて資金移動なので振替に寄せる。
 * そうしないと、どのフィルタにも掛からない行ができる。
 */
export function matchesKind(event: CashEvent, kind: LedgerKind): boolean {
  if (kind === "all") return true;

  const isSettle = event.src === "settle";
  if (kind === "settle") return isSettle;
  if (isSettle) return false;

  const isTransfer =
    event.type === "transfer" || groupOfCategory(event.categoryCode) === "TRF";
  if (kind === "transfer") return isTransfer;
  if (isTransfer) return false;

  if (kind === "income") return event.type === "income";

  /* 固定費・変動費は費用だけ。収入は costType を持たないため、
     ここで型を絞らないと「変動費」に収入が混ざる */
  if (event.type !== "expense") return false;
  const costType = event.costType ?? "variable";
  return kind === "fixed" ? costType === "fixed" : costType === "variable";
}

/** 状態フィルタに合うか。 */
export function matchesStatus(
  entryStatus: "plan" | "actual",
  status: LedgerStatus,
): boolean {
  return status === "all" || status === entryStatus;
}

/**
 * 入出金予定表を組み立てる。
 *
 * 明細は CL-3 の予測系列の現金イベント。実績から来たイベントは「実績」、
 * それ以外は「予定」とする。カード引落は生成物なので常に「予定」で、
 * 繰延の操作もできない。
 */
export function buildLedgerView(input: LedgerInput): LedgerView {
  const { series, monthly, from, to, kind, status } = input;

  /* 日付 → その日の予測残高 */
  const balanceByDate = new Map(series.rows.map((r) => [r.date, r.proj]));

  /* 繰延された予定のキー。CL-1 が origDate を持たせている */
  const deferredByKey = new Map<string, DateStr>();
  for (const plan of series.unmatchedForecast) {
    if (plan.origDate) deferredByKey.set(plan.key, plan.origDate);
  }

  const entries: LedgerEntry[] = [];
  for (const event of series.projectedCash) {
    const yearMonth = toYearMonth(event.date);
    if (yearMonth < from || yearMonth > to) continue;

    const entryStatus = event.src === "actual" ? "actual" : "plan";
    if (!matchesStatus(entryStatus, status)) continue;
    if (!matchesKind(event, kind)) continue;

    const origDate = event.key ? deferredByKey.get(event.key) : undefined;
    entries.push({
      ...event,
      status: entryStatus,
      balance: balanceByDate.get(event.date) ?? 0,
      deferred: origDate !== undefined,
      origDate,
      /* カード引落は CL-2 の生成物。利用者は動かせない（§4.2 繰延操作） */
      editable: entryStatus === "plan" && event.src !== "settle",
    });
  }

  entries.sort(
    (a, b) =>
      compareDate(a.date, b.date) ||
      compareString(a.name, b.name) ||
      compareString(a.key ?? "", b.key ?? ""),
  );

  const monthlyByYm = new Map(monthly.map((m) => [m.yearMonth, m]));

  const groups: LedgerMonthGroup[] = [];
  const total = { count: 0, inflow: 0, outflow: 0 };

  for (const entry of entries) {
    const yearMonth = toYearMonth(entry.date);
    let group = groups.at(-1);
    if (!group || group.yearMonth !== yearMonth) {
      const summary = monthlyByYm.get(yearMonth);
      group = {
        yearMonth,
        entries: [],
        count: 0,
        inflow: 0,
        outflow: 0,
        closing: summary?.closing ?? null,
        lowest: summary?.lowest ?? null,
        warning: summary?.warning ?? null,
      };
      groups.push(group);
    }

    group.entries.push(entry);
    group.count++;
    if (entry.type === "income") {
      group.inflow += entry.amount;
      total.inflow += entry.amount;
    } else if (entry.type === "expense") {
      group.outflow += entry.amount;
      total.outflow += entry.amount;
    }
    total.count++;
  }

  return { groups, total };
}
