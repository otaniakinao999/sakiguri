/**
 * データベースの行とアプリの型の変換
 *
 * 一次情報：supabase/migrations/0001_initial_schema.sql、要件定義書 §3.2
 *
 * 列名はスネークケース、アプリ側はキャメルケース。境界はここだけにする。
 * 純関数なのでテストできる。
 */

import type {
  Account,
  Actual,
  CardAccount,
  DateStr,
  OneoffItem,
  Override,
  Overrides,
  RecurringItem,
  Yen,
} from "@/core/types";

import type { AppData } from "../app-data";

/* ========================= 行の形 ========================= */

export interface SettingsRow {
  user_id: string;
  as_of: DateStr;
  reserve_line: Yen;
  /** 最後に消し込み操作を行った日。FR-43 の警告のためだけに持つ */
  last_reconciled_at: DateStr | null;
}

export interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  kind: "bank" | "cash" | "card";
  balance: Yen;
  /** card のみ。次回の引落に含まれない未確定の利用額（CL-2 手順4） */
  unbilled_balance: Yen;
  closing_day: number | null;
  pay_month_offset: number | null;
  pay_day: number | null;
  settle_account_id: string | null;
}

interface EntryRowBase {
  id: string;
  user_id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  cost_type: "fixed" | "variable" | null;
  category_code: string;
  amount: Yen;
  biz_ratio: number;
  account_id: string;
  to_account_id: string | null;
}

export interface RecurringRow extends EntryRowBase {
  day: number;
  months: number[] | null;
  active: boolean;
}

export interface OneoffRow extends EntryRowBase {
  date: DateStr;
}

export interface ActualRow extends EntryRowBase {
  date: DateStr;
  plan_key: string | null;
  /** key が null である理由が「予定に対応しない」と確定済みか（FR-46） */
  unplanned: boolean;
}

export interface OverrideRow {
  user_id: string;
  plan_key: string;
  date: DateStr | null;
  amount: Yen | null;
  skipped: boolean | null;
  note: string | null;
}

/* ========================= 取得する列 ========================= */

/**
 * 取得する列を列挙する。
 *
 * **`select("*")` を使わない。** 読み込みは本文の転送が律速で（`docs/受入
 * 基準の充足状況.md`「パースは律速ではない」）、送るバイト数がそのまま
 * 時間になる。どのテーブルも `created_at` と `updated_at` を持つが、
 * どちらも読んでいない。`user_id` も読んでいない（行を絞るのは RLS の
 * 仕事で、アプリは受け取った行をそのまま使う）。この3列で1行あたり
 * 100バイト以上ある。
 *
 * **列を1つでも書き落とすと型エラーになる。** `Record<keyof Row, true>`
 * はキーの過不足を許さないので、`Row` に項目を足したときにここが落ちる
 * （CLAUDE.md §2.8）。DB に列を足しても `Row` に足さなければ落ちないが、
 * その列は誰も読んでいないので取る必要もない。
 */
function columns<Row>(map: Record<keyof Omit<Row, "user_id">, true>): string {
  return Object.keys(map).join(",");
}

/** `settings` は1行なので `fetchAll` を通さない。列は同じ考えで絞る */
export const SETTINGS_COLUMNS = columns<SettingsRow>({
  as_of: true,
  reserve_line: true,
  last_reconciled_at: true,
});

/** `fetchAll` が引くテーブルと、その取得列。 */
export const SELECT_COLUMNS = {
  accounts: columns<AccountRow>({
    id: true,
    name: true,
    kind: true,
    balance: true,
    unbilled_balance: true,
    closing_day: true,
    pay_month_offset: true,
    pay_day: true,
    settle_account_id: true,
  }),
  recurring_items: columns<RecurringRow>({
    id: true,
    name: true,
    type: true,
    cost_type: true,
    category_code: true,
    amount: true,
    biz_ratio: true,
    account_id: true,
    to_account_id: true,
    day: true,
    months: true,
    active: true,
  }),
  oneoff_items: columns<OneoffRow>({
    id: true,
    name: true,
    type: true,
    cost_type: true,
    category_code: true,
    amount: true,
    biz_ratio: true,
    account_id: true,
    to_account_id: true,
    date: true,
  }),
  actuals: columns<ActualRow>({
    id: true,
    name: true,
    type: true,
    cost_type: true,
    category_code: true,
    amount: true,
    biz_ratio: true,
    account_id: true,
    to_account_id: true,
    date: true,
    plan_key: true,
    unplanned: true,
  }),
  overrides: columns<OverrideRow>({
    plan_key: true,
    date: true,
    amount: true,
    skipped: true,
    note: true,
  }),
} as const;

/** `fetchAll` が引けるテーブル。列を定義していないテーブルは引けない */
export type FetchTable = keyof typeof SELECT_COLUMNS;

/* ========================= 行 → アプリ ========================= */

export function toAccount(row: AccountRow): Account {
  if (row.kind === "card") {
    return {
      id: row.id,
      name: row.name,
      kind: "card",
      balance: row.balance,
      /* card なら4項目が揃っていることを DB の check 制約で担保している。
         settle_account_id だけは、引落元の口座を消したときに空になりうる */
      unbilledBalance: row.unbilled_balance ?? 0,
      closingDay: row.closing_day ?? 15,
      payMonthOffset: row.pay_month_offset ?? 1,
      payDay: row.pay_day ?? 10,
      settleAccountId: row.settle_account_id ?? "",
    } satisfies CardAccount;
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    balance: row.balance,
  };
}

export function toRecurring(row: RecurringRow): RecurringItem {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    costType: row.cost_type,
    categoryCode: row.category_code,
    amount: row.amount,
    bizRatio: row.biz_ratio,
    accountId: row.account_id,
    toAccountId: row.to_account_id ?? undefined,
    day: row.day,
    months: row.months,
    active: row.active,
  };
}

export function toOneoff(row: OneoffRow): OneoffItem {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    type: row.type,
    costType: row.cost_type,
    categoryCode: row.category_code,
    amount: row.amount,
    bizRatio: row.biz_ratio,
    accountId: row.account_id,
    toAccountId: row.to_account_id ?? undefined,
  };
}

export function toActual(row: ActualRow): Actual {
  return {
    id: row.id,
    key: row.plan_key,
    unplanned: row.unplanned ?? false,
    date: row.date,
    name: row.name,
    type: row.type,
    costType: row.cost_type,
    categoryCode: row.category_code,
    amount: row.amount,
    bizRatio: row.biz_ratio,
    accountId: row.account_id,
    toAccountId: row.to_account_id ?? undefined,
  };
}

export function toOverrides(rows: OverrideRow[]): Overrides {
  const out: Overrides = {};
  for (const row of rows) {
    const override: Override = {};
    if (row.date !== null) override.date = row.date;
    if (row.amount !== null) override.amount = row.amount;
    if (row.skipped !== null) override.skipped = row.skipped;
    if (row.note !== null) override.note = row.note;
    out[row.plan_key] = override;
  }
  return out;
}

/* ========================= アプリ → 行 ========================= */

/**
 * settings の、`user_id` を除いた中身。
 *
 * **差分の判定もここを見る（`diffAppData`）。** 項目を1つ足したときに
 * 差分側が古いまま残ると、その項目は画面では変わるのに保存されない。
 * 実際 `last_reconciled_at` がその状態にあり、FR-43 の警告が永久に
 * 「一度も消し込んでいない」を指し続けていた（CLAUDE.md §2.8）。
 */
export function settingsPayload(data: AppData): Omit<SettingsRow, "user_id"> {
  return {
    as_of: data.asOf,
    reserve_line: data.reserveLine,
    last_reconciled_at: data.lastReconciledAt,
  };
}

export function fromSettings(data: AppData, userId: string): SettingsRow {
  return { user_id: userId, ...settingsPayload(data) };
}

export function fromAccount(account: Account, userId: string): AccountRow {
  const card = account.kind === "card" ? account : null;
  return {
    id: account.id,
    user_id: userId,
    name: account.name,
    kind: account.kind,
    balance: account.balance,
    unbilled_balance: card?.unbilledBalance ?? 0,
    closing_day: card?.closingDay ?? null,
    pay_month_offset: card?.payMonthOffset ?? null,
    pay_day: card?.payDay ?? null,
    settle_account_id: card?.settleAccountId || null,
  };
}

export function fromRecurring(item: RecurringItem, userId: string): RecurringRow {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    type: item.type,
    cost_type: item.costType,
    category_code: item.categoryCode,
    amount: item.amount,
    biz_ratio: item.bizRatio,
    account_id: item.accountId,
    to_account_id: item.toAccountId ?? null,
    day: item.day,
    months: item.months,
    active: item.active,
  };
}

export function fromOneoff(item: OneoffItem, userId: string): OneoffRow {
  return {
    id: item.id,
    user_id: userId,
    date: item.date,
    name: item.name,
    type: item.type,
    cost_type: item.costType,
    category_code: item.categoryCode,
    amount: item.amount,
    biz_ratio: item.bizRatio,
    account_id: item.accountId,
    to_account_id: item.toAccountId ?? null,
  };
}

export function fromActual(item: Actual, userId: string): ActualRow {
  return {
    id: item.id,
    user_id: userId,
    plan_key: item.key,
    unplanned: item.unplanned ?? false,
    date: item.date,
    name: item.name,
    type: item.type,
    cost_type: item.costType,
    category_code: item.categoryCode,
    amount: item.amount,
    biz_ratio: item.bizRatio,
    account_id: item.accountId,
    to_account_id: item.toAccountId ?? null,
  };
}

export function fromOverride(
  planKey: string,
  override: Override,
  userId: string,
): OverrideRow {
  return {
    user_id: userId,
    plan_key: planKey,
    date: override.date ?? null,
    amount: override.amount ?? null,
    skipped: override.skipped ?? null,
    note: override.note ?? null,
  };
}
