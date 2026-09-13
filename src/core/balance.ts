/**
 * CL-3 残高推移の算出
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-3
 * 対応する機能要件：FR-08
 * 対応する受入基準：AC-01（CL-2 と合わせて）
 *
 * 基準日の残高を起点に、現金イベントを日次で累積する。
 * 予測系列（実績＋未消込の予定）と実績系列（実績のみ）の2本を持つ。
 */

import { actualToEvent, signedAmount, toCashEvents } from "./cash";
import { formatDate, lastDayOfMonth, parseDate } from "./date";
import { isCard } from "./types";
import type {
  Account,
  Actual,
  CashEvent,
  DateStr,
  ForecastInstance,
  LedgerEvent,
  Yen,
} from "./types";

/** CL-3 の入力。 */
export interface BalanceInput {
  accounts: Account[];
  /** 基準日。この日の残高を入力値として与える */
  asOf: DateStr;
  /** CL-1 の出力 */
  forecast: ForecastInstance[];
  actuals: Actual[];
}

/** 1日ぶんの残高。 */
export interface BalanceRow {
  date: DateStr;
  /** 予測残高（現預金の合計）。カードの未払残高は含まない */
  proj: Yen;
  /**
   * 実績残高。`actualEnd` より後は null。
   * グラフはここで線を切る（CL-3 手順4）。
   */
  act: Yen | null;
  /** 口座別の残高。キーは口座 id（カードを除く） */
  byAccount: Record<string, Yen>;
  /** カードの未払残高。キーはカード id */
  byCard: Record<string, Yen>;
}

/** CL-3 の出力。 */
export interface BalanceSeries {
  /** 基準日から `to` までの日次の行 */
  rows: BalanceRow[];
  /** 実績で消し込まれていない予定インスタンス */
  unmatchedForecast: ForecastInstance[];
  /** 実績系列を打ち切る日（今日と最終実績日のうち遅いほう） */
  actualEnd: DateStr;
  /** 予測系列の現金イベント */
  projectedCash: CashEvent[];
  /** 実績のみの現金イベント */
  actualCash: CashEvent[];
}

/** 翌日。'YYYY-MM-DD' のまま1日進める。 */
function nextDay(date: DateStr): DateStr {
  const { year, month, day } = parseDate(date);
  if (day < lastDayOfMonth(year, month)) return formatDate(year, month, day + 1);
  if (month < 12) return formatDate(year, month + 1, 1);
  return formatDate(year + 1, 1, 1);
}

/**
 * 現金イベント1件が、ある口座の残高を動かす額（CL-3 手順6）。
 *
 * 振替は送金元をマイナス、送金先をプラスにする。両方が現預金口座なら
 * 合計としては相殺されて0になる。
 */
export function accountDelta(event: CashEvent, accountId: string): Yen {
  if (event.type === "transfer") {
    if (event.accountId === accountId) return -event.amount;
    if (event.toAccountId === accountId) return event.amount;
    return 0;
  }
  if (event.accountId !== accountId) return 0;
  return signedAmount(event);
}

/**
 * カード利用が未払残高を動かす額。支出なら未払が増える。
 *
 * 現金の増減とは向きが逆になる。カードで1万円払うと、現金は動かないが
 * 未払は1万円増える。
 */
function cardUsageDelta(event: { type: string; amount: Yen }): Yen {
  return -signedAmount(event);
}

/**
 * カード引落が未払残高を動かす額。
 *
 * 引落は現預金から出ていき（`signedAmount` は負）、同じだけ未払が減る。
 * 締め期間の返金が利用を上回った場合、引落イベントは `income` になり、
 * このとき未払は**増える**（戻ってきた分だけマイナスの残高が解消される）。
 * 符号を `signedAmount` から導くことで、この向きを取り違えないようにしている。
 *
 * プロトタイプはここで常に `-= 金額の絶対値` としており、返金が上回る場合に
 * 符号を誤っていた。
 */
function cardSettleDelta(event: { type: string; amount: Yen }): Yen {
  return signedAmount(event);
}

/**
 * CL-3 残高推移の算出。
 *
 * @param to   日次の行をどこまで作るか（基準日から to まで、両端を含む）
 * @param today 今日。実績系列を打ち切る位置に使う。
 *              core は現在日時を自分で取らない（CLAUDE.md §2.3）
 */
export function buildBalanceSeries(
  input: BalanceInput,
  to: DateStr,
  today: DateStr,
): BalanceSeries {
  const { accounts, asOf, forecast, actuals } = input;

  const depositAccounts = accounts.filter((a) => !isCard(a));
  const cards = accounts.filter(isCard);

  /* 手順2：実績が持つキーの予定を予測から除外する（消し込み） */
  const matched = new Set(
    actuals.map((a) => a.key).filter((k): k is string => k !== null),
  );
  const unmatchedForecast = forecast.filter((f) => !matched.has(f.key));

  /* 手順3・4：2本の系列ぶんの現金イベントを作る */
  const actualEvents: LedgerEvent[] = actuals.map(actualToEvent);
  const projectedRaw: LedgerEvent[] = [...actualEvents, ...unmatchedForecast];

  const projectedCash = toCashEvents(projectedRaw, accounts, asOf);
  const actualCash = toCashEvents(actualEvents, accounts, asOf);

  /* 日ごとの増減をまとめる */
  interface DayDelta {
    proj: Yen;
    act: Yen;
    byAccount: Record<string, Yen>;
    byCard: Record<string, Yen>;
  }
  const deltas = new Map<DateStr, DayDelta>();
  const touch = (date: DateStr): DayDelta => {
    let d = deltas.get(date);
    if (!d) {
      d = {
        proj: 0,
        act: 0,
        byAccount: Object.fromEntries(depositAccounts.map((a) => [a.id, 0])),
        byCard: Object.fromEntries(cards.map((c) => [c.id, 0])),
      };
      deltas.set(date, d);
    }
    return d;
  };

  for (const event of projectedCash) {
    const d = touch(event.date);
    for (const account of depositAccounts) {
      const delta = accountDelta(event, account.id);
      d.proj += delta;
      d.byAccount[account.id] += delta;
    }
  }

  for (const event of actualCash) {
    const d = touch(event.date);
    for (const account of depositAccounts) {
      d.act += accountDelta(event, account.id);
    }
  }

  /* 手順5：カードの未払残高。利用日に増え、引落日に減る。
     利用は現金イベント化される前の列から拾う（現金イベントには残らないため） */
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const event of projectedRaw) {
    const account = byId.get(event.accountId);
    if (!account || !isCard(account) || event.type === "transfer") continue;
    touch(event.date).byCard[account.id] += cardUsageDelta(event);
  }
  for (const event of projectedCash) {
    if (event.src !== "settle" || !event.cardId) continue;
    touch(event.date).byCard[event.cardId] += cardSettleDelta(event);
  }

  /* 手順1：現金・銀行口座の基準日残高の合計が開始残高。カードは含めない */
  const opening = depositAccounts.reduce((sum, a) => sum + a.balance, 0);

  /* 手順4：実績系列を打ち切る日 */
  const lastActualDate = actuals.reduce(
    (latest, a) => (a.date > latest ? a.date : latest),
    asOf,
  );
  const actualEnd = lastActualDate > today ? lastActualDate : today;

  /* 基準日から日次で累積する */
  const runningAccount: Record<string, Yen> = Object.fromEntries(
    depositAccounts.map((a) => [a.id, a.balance]),
  );
  const runningCard: Record<string, Yen> = Object.fromEntries(
    cards.map((c) => [c.id, c.balance]),
  );
  let proj = opening;
  let act = opening;

  const rows: BalanceRow[] = [];
  for (let date = asOf; date <= to; date = nextDay(date)) {
    const d = deltas.get(date);
    if (d) {
      proj += d.proj;
      act += d.act;
      for (const account of depositAccounts) {
        runningAccount[account.id] += d.byAccount[account.id];
      }
      for (const card of cards) {
        runningCard[card.id] += d.byCard[card.id];
      }
    }
    rows.push({
      date,
      proj,
      act: date <= actualEnd ? act : null,
      byAccount: { ...runningAccount },
      byCard: { ...runningCard },
    });
  }

  return { rows, unmatchedForecast, actualEnd, projectedCash, actualCash };
}
