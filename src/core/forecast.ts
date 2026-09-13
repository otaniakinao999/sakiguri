/**
 * CL-1 予定インスタンスの展開
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-1、§3.2「予定インスタンスキーの規約」
 * 対応する機能要件：FR-04
 * 対応する受入基準：AC-02
 *
 * 定期項目と単発予定を、対象期間のあいだの個々の予定に展開する。
 * オーバーライド（この回だけの変更）を適用したうえで、日付昇順で返す。
 */

import {
  compareDate,
  dayInMonth,
  eachMonth,
  isWithin,
  parseDate,
} from "./date";
import type {
  DateStr,
  ForecastInstance,
  OneoffItem,
  Override,
  Overrides,
  RecurringItem,
} from "./types";

/** CL-1 の入力。 */
export interface ForecastInput {
  recurring: RecurringItem[];
  oneoffs: OneoffItem[];
  /** 予定インスタンスキーをキーとするマップ。省略可 */
  overrides?: Overrides;
}

/**
 * 定期項目の予定インスタンスキー。
 *
 * `date` は**オーバーライド適用前**の発生日。日付をずらしても
 * 紐づけが切れないようにするため（要件定義書 §3.2）。
 */
export function recurringKey(recurringId: string, date: DateStr): string {
  return `r:${recurringId}:${date}`;
}

/** 単発予定の予定インスタンスキー。 */
export function oneoffKey(oneoffId: string): string {
  return `o:${oneoffId}`;
}

/** ロケール非依存の文字列比較。並びを実行環境に依存させない。 */
function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 定期項目1件を、対象期間にかかる各月ぶんに展開する（CL-1 手順1〜2）。
 *
 * - `active` が false の項目は展開しない
 * - `months` が null なら毎月、配列ならその月（1〜12）だけ
 * - 発生日は `min(day, その月の末日)`。`day = 31` は月末になる
 *
 * オーバーライドはまだ適用しない。期間による絞り込みも行わない
 * （オーバーライドで日付が動きうるため、絞り込みは最後にまとめて行う）。
 */
export function expandRecurring(
  item: RecurringItem,
  from: DateStr,
  to: DateStr,
): ForecastInstance[] {
  if (!item.active) return [];

  const out: ForecastInstance[] = [];
  for (const { year, month } of eachMonth(from, to)) {
    if (item.months && !item.months.includes(month)) continue;

    const date = dayInMonth(year, month, item.day);
    out.push({
      key: recurringKey(item.id, date),
      date,
      name: item.name,
      type: item.type,
      costType: item.costType,
      category: item.category,
      amount: item.amount,
      bizRatio: item.bizRatio,
      accountId: item.accountId,
      toAccountId: item.toAccountId,
      src: "recurring",
      srcId: item.id,
    });
  }
  return out;
}

/** 単発予定1件を予定インスタンスにする（CL-1 手順3）。 */
export function expandOneoff(item: OneoffItem): ForecastInstance {
  parseDate(item.date); // 書式と実在を検証する
  return {
    key: oneoffKey(item.id),
    date: item.date,
    name: item.name,
    type: item.type,
    costType: item.costType,
    category: item.category,
    amount: item.amount,
    bizRatio: item.bizRatio,
    accountId: item.accountId,
    toAccountId: item.toAccountId,
    src: "oneoff",
    srcId: item.id,
  };
}

/**
 * オーバーライドを1件に適用する（CL-1 手順4）。
 *
 * - `skipped` なら null を返す（＝当回を発生させない）
 * - `date` があれば日付を差し替え、元の日付を `origDate` に残す
 * - `amount` があれば金額を差し替える
 *
 * `origDate` は**日付が実際に動いたときだけ**設定する。金額だけを変えた回に
 * 「◯/◯ ← ◯/◯」と同じ日付を並べても意味がないため。
 * オーバーライドの有無そのものは `override` で判定できる。
 */
function applyOverride(
  base: ForecastInstance,
  override: Override | undefined,
): ForecastInstance | null {
  if (!override) return base;
  if (override.skipped) return null;

  if (override.date !== undefined) {
    parseDate(override.date); // 壊れた日付で並び順と絞り込みを狂わせない
  }

  const date = override.date ?? base.date;
  const applied: ForecastInstance = {
    ...base,
    date,
    amount: override.amount ?? base.amount,
    override,
  };
  if (date !== base.date) {
    applied.origDate = base.date;
  }
  return applied;
}

/**
 * CL-1 予定インスタンスの展開。
 *
 * 定期項目と単発予定を展開し、オーバーライドを適用し、対象期間 [from, to]
 * の外に出たものを除いて、日付昇順で返す（CL-1 手順1〜5）。
 *
 * 並びは 日付 → 内容 → キー の順。実行環境で順序が変わらないよう、
 * `localeCompare` ではなく符号位置の比較を使う。
 *
 * @param from 対象期間の開始日（両端を含む）
 * @param to   対象期間の終了日（両端を含む）
 */
export function buildForecast(
  input: ForecastInput,
  from: DateStr,
  to: DateStr,
): ForecastInstance[] {
  const overrides = input.overrides ?? {};

  const raw: ForecastInstance[] = [
    ...input.recurring.flatMap((item) => expandRecurring(item, from, to)),
    ...input.oneoffs.map(expandOneoff),
  ];

  const out: ForecastInstance[] = [];
  for (const instance of raw) {
    const applied = applyOverride(instance, overrides[instance.key]);
    if (applied && isWithin(applied.date, from, to)) {
      out.push(applied);
    }
  }

  return out.sort(
    (a, b) =>
      compareDate(a.date, b.date) ||
      compareString(a.name, b.name) ||
      compareString(a.key, b.key),
  );
}
