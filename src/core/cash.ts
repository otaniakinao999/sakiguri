/**
 * CL-2 現金イベントへの変換（カード引落ラグ）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-2、§3.2「予定インスタンスキーの規約」
 * 対応する機能要件：FR-09
 * 対応する受入基準：AC-01
 *
 * 予定インスタンスと実績を、**口座残高を実際に動かす**イベント列に変換する。
 * カードで払った支出は利用日には残高を動かさず、締め期間ごとに合算されて
 * 引落日に1件の出金として現れる。
 */

import { CATEGORY_CARD_SETTLEMENT } from "./categories";
import {
  compareDate,
  compareString,
  dayInMonth,
  parseDate,
  shiftMonth,
} from "./date";
import { isCard } from "./types";
import type {
  Account,
  Actual,
  CardAccount,
  CashEvent,
  DateStr,
  LedgerEvent,
  Yen,
} from "./types";

/** カード引落イベントのキー（要件定義書 §3.2）。例 `s:c1|2026-09-10` */
export function settleKey(cardId: string, settleDate: DateStr): string {
  return `s:${cardId}|${settleDate}`;
}

/** 実績を CL-2 の入力形に変換する。 */
export function actualToEvent(actual: Actual): LedgerEvent {
  return {
    key: actual.key,
    date: actual.date,
    name: actual.name,
    type: actual.type,
    costType: actual.costType,
    categoryCode: actual.categoryCode,
    amount: actual.amount,
    bizRatio: actual.bizRatio,
    accountId: actual.accountId,
    toAccountId: actual.toAccountId,
    src: "actual",
    /* 入出金予定表から編集するために実績の id を運ぶ（FR-41）。
       key は予定との紐づけで、突発の実績では null になるため使えない */
    srcId: actual.id,
  };
}

/**
 * 口座残高から見た増減。income は増、expense は減、transfer は0。
 *
 * 振替は「合計残高に対して増減0」（CL-3 手順6）であり、口座別の付け替えは
 * balance.ts で扱う。
 */
export function signedAmount(event: { type: string; amount: Yen }): Yen {
  if (event.type === "income") return event.amount;
  if (event.type === "expense") return -event.amount;
  return 0;
}

/**
 * カード利用日から引落日を求める（CL-2 手順2）。
 *
 * - 利用日の日 ≤ 締日 → 締め月 = 利用月。それ以外 → 締め月 = 利用月 + 1ヶ月
 * - 支払月 = 締め月 + payMonthOffset
 * - 引落日 = min(payDay, 支払月の末日)
 *
 * 例（AC-01）：締日15日・翌月・支払日10日のカードで 8/20 に利用
 *   → 20 > 15 なので締め月は9月 → 支払月は10月 → 引落日は 10/10
 */
export function settleDateOf(card: CardAccount, usedOn: DateStr): DateStr {
  const { year, month, day } = parseDate(usedOn);
  const closing =
    day <= card.closingDay ? { year, month } : shiftMonth({ year, month }, 1);
  const paying = shiftMonth(closing, card.payMonthOffset);
  return dayInMonth(paying.year, paying.month, card.payDay);
}

/**
 * 基準日以降で最初に到来する引落日（CL-2 手順4）。
 *
 * 当月の引落日が基準日より前なら翌月。基準日は必ず当月にあるため、
 * 翌月の引落日は必ず基準日より後になる。2回で足りる。
 */
export function firstSettleDateOnOrAfter(
  card: CardAccount,
  asOf: DateStr,
): DateStr {
  const { year, month } = parseDate(asOf);
  for (let i = 0; i < 2; i++) {
    const m = shiftMonth({ year, month }, i);
    const date = dayInMonth(m.year, m.month, card.payDay);
    if (date >= asOf) return date;
  }
  /* istanbul ignore next -- 上のループで必ず返る */
  throw new Error(`引落日を決められません: ${card.id}`);
}

function indexAccounts(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((a) => [a.id, a]));
}

/**
 * CL-2 現金イベントへの変換。
 *
 * @param events 予定インスタンスと実績を合わせたイベント列
 * @param accounts 口座・カード
 * @param asOf 基準日。カードの未払残高をどの引落日に載せるかに使う
 */
export function toCashEvents(
  events: LedgerEvent[],
  accounts: Account[],
  asOf: DateStr,
): CashEvent[] {
  const byId = indexAccounts(accounts);

  /**
   * (カードid, 引落日) ごとの合算。支出は正、返金は負（CL-2 手順3）。
   * キーから復元せず、カードと引落日をそのまま持つ。
   */
  interface Bucket {
    card: CardAccount;
    date: DateStr;
    total: Yen;
  }
  const buckets = new Map<string, Bucket>();
  const bump = (card: CardAccount, settleDate: DateStr, delta: Yen): void => {
    const k = settleKey(card.id, settleDate);
    const bucket = buckets.get(k);
    if (bucket) bucket.total += delta;
    else buckets.set(k, { card, date: settleDate, total: delta });
  };

  const cash: CashEvent[] = [];

  for (const event of events) {
    const account = byId.get(event.accountId);
    if (!account) {
      throw new Error(
        `イベントの口座が見つかりません: ${event.accountId} (${event.key ?? event.name})`,
      );
    }

    /* 手順1：カード払いの支出・収入は口座残高を動かさない。
       振替はカードが絡んでも現金の移動なのでそのまま通す。 */
    if (isCard(account) && event.type !== "transfer") {
      bump(account, settleDateOf(account, event.date), -signedAmount(event));
      continue;
    }

    cash.push(event);
  }

  /* 手順4：基準日時点の未払残高を、最初に到来する引落日に加算する */
  for (const account of accounts) {
    if (!isCard(account) || account.balance === 0) continue;
    bump(account, firstSettleDateOnOrAfter(account, asOf), account.balance);
  }

  /* 手順5：合算が0でないものを引落イベントにする */
  const settlements: CashEvent[] = [];
  for (const [key, { card, date, total }] of buckets) {
    if (total === 0) continue;
    settlements.push({
      key,
      date,
      name: `${card.name} 引落`,
      type: total > 0 ? "expense" : "income",
      costType: null,
      /* TRF-04 カード引落。費目マスタが「CL-2 が生成する」としている
         （要件定義書 §3.1.2）。TRF なので CL-5 の損益集計から外れる。 */
      categoryCode: CATEGORY_CARD_SETTLEMENT,
      amount: Math.abs(total),
      bizRatio: 0,
      accountId: card.settleAccountId,
      src: "settle",
      cardId: card.id,
    });
  }

  /* 手順6：結合して日付昇順。並びを実行環境に依存させないため、
     同日は内容とキーで割る（localeCompare を使わない） */
  return [...cash, ...settlements].sort(
    (a, b) =>
      compareDate(a.date, b.date) ||
      compareString(a.name, b.name) ||
      compareString(a.key ?? "", b.key ?? ""),
  );
}
