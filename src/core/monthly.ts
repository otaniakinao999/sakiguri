/**
 * CL-6 月次資金繰り表
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-6
 * 対応する機能要件：FR-13
 * 対応する受入基準：AC-06、AC-20（後半）
 *
 * CL-3 の予測系列と現金イベントから、月ごとの繰越・入金・出金・収支・
 * 月末残高・月中最低を組み立てる。**現金ベース**であり、カード利用は
 * 利用日ではなく引落日で出金に計上する（CL-5 の発生日ベースとは異なる）。
 */

import type { BalanceRow, BalanceSeries } from "./balance";
import { toYearMonth } from "./date";
import type { CashEvent, DateStr, Yen, YearMonth } from "./types";

/** 残高が生活防衛ラインを下回る種別。 */
export type ShortfallKind =
  /** 防衛ライン割れ。残高は0以上だがラインを下回る */
  | "reserveBreach"
  /** 資金ショート。残高がマイナスになる */
  | "shortfall";

/** 月中最低が生活防衛ラインを下回った月の注記。 */
export interface ShortfallWarning {
  kind: ShortfallKind;
  /** 最低残高をつけた日 */
  date: DateStr;
  /** そのときの残高 */
  balance: Yen;
}

/** 月次資金繰り表の1行。 */
export interface MonthlyCashflowRow {
  yearMonth: YearMonth;
  /** 前月繰越。前月の月末残高。初月は 月末残高 − 当月入金 + 当月出金 */
  opening: Yen;
  /** 当月の現金イベントのうち type = income の合計 */
  inflow: Yen;
  /** 同 type = expense の合計。カード引落と借入返済の元金を含む */
  outflow: Yen;
  /** 収支 = 入金 − 出金 */
  net: Yen;
  /** 当月末日の予測残高 */
  closing: Yen;
  /** 当月の日次予測残高の最小値 */
  lowest: Yen;
  /** 月中最低をつけた最初の日 */
  lowestDate: DateStr;
  /** 生活防衛ラインを下回らなければ null */
  warning: ShortfallWarning | null;
}

/**
 * 月中最低から警告を決める。
 *
 * 残高マイナス（資金ショート）と防衛ライン割れを区別する。
 * 表示側は後者の警告色を弱める（要件定義書 §4.3）。
 */
function warningOf(
  lowest: Yen,
  lowestDate: DateStr,
  reserveLine: Yen,
): ShortfallWarning | null {
  if (lowest >= reserveLine) return null;
  return {
    kind: lowest < 0 ? "shortfall" : "reserveBreach",
    date: lowestDate,
    balance: lowest,
  };
}

/**
 * CL-6 月次資金繰り表の算出。
 *
 * 初月と最終月は月の途中から／途中までになりうる。基準日が月初でなければ
 * 初月は部分月であり、その「前月繰越」は基準日時点の残高を意味する。
 *
 * @param series CL-3 の出力
 * @param reserveLine 生活防衛ライン。法人では必要運転資金ライン
 */
export function buildMonthlyCashflow(
  series: BalanceSeries,
  reserveLine: Yen,
): MonthlyCashflowRow[] {
  if (series.rows.length === 0) return [];

  /* 日次の行を月ごとにまとめる。行は日付昇順なので月も出現順に並ぶ */
  const monthOrder: YearMonth[] = [];
  const daysByMonth = new Map<YearMonth, BalanceRow[]>();
  for (const row of series.rows) {
    const ym = toYearMonth(row.date);
    let days = daysByMonth.get(ym);
    if (!days) {
      days = [];
      daysByMonth.set(ym, days);
      monthOrder.push(ym);
    }
    days.push(row);
  }

  /* 現金イベントを月ごとに集計する。
     CL-2 の出力は対象期間の外にも出うる（基準日より前の実績、`to` より後の
     引落日）。CL-3 が残高に反映していない範囲を数えると、
     前月繰越 + 収支 = 月末残高 が崩れるため、行のある範囲だけを数える。 */
  const firstDate = series.rows[0].date;
  const lastDate = series.rows[series.rows.length - 1].date;

  interface Flow {
    inflow: Yen;
    outflow: Yen;
  }
  const flows = new Map<YearMonth, Flow>();
  const flowOf = (ym: YearMonth): Flow => {
    let flow = flows.get(ym);
    if (!flow) {
      flow = { inflow: 0, outflow: 0 };
      flows.set(ym, flow);
    }
    return flow;
  };

  for (const event of series.projectedCash as CashEvent[]) {
    if (event.date < firstDate || event.date > lastDate) continue;
    const flow = flowOf(toYearMonth(event.date));
    if (event.type === "income") flow.inflow += event.amount;
    else if (event.type === "expense") flow.outflow += event.amount;
    /* transfer は合計残高を動かさないので入金にも出金にも数えない */
  }

  const rows: MonthlyCashflowRow[] = [];
  let previousClosing: Yen | null = null;

  for (const yearMonth of monthOrder) {
    const days = daysByMonth.get(yearMonth)!;
    const { inflow, outflow } = flows.get(yearMonth) ?? { inflow: 0, outflow: 0 };
    const net = inflow - outflow;
    const closing = days[days.length - 1].proj;

    /* 前月繰越。初月だけ、月末残高から当月の収支を差し引いて求める */
    const opening = previousClosing ?? closing - inflow + outflow;

    let lowest = days[0].proj;
    let lowestDate = days[0].date;
    for (const day of days) {
      if (day.proj < lowest) {
        lowest = day.proj;
        lowestDate = day.date;
      }
    }

    rows.push({
      yearMonth,
      opening,
      inflow,
      outflow,
      net,
      closing,
      lowest,
      lowestDate,
      warning: warningOf(lowest, lowestDate, reserveLine),
    });

    previousClosing = closing;
  }

  return rows;
}
