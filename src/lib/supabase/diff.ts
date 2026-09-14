/**
 * 保存する差分の算出
 *
 * 一次情報：docs/要件定義書.md §5.2
 *   保存は変更から400msのデバウンス後に自動実行する。
 *
 * 毎回すべてを送り直すと、実績10万件（§5.1）では通信量が現実的でない。
 * 前回保存した状態と比べて、**変わった行と消えた行だけ**を送る。
 *
 * 純関数。Supabase には触れない。
 */

import type { Actual, OneoffItem, Overrides, RecurringItem } from "@/core/types";
import type { Account } from "@/core/types";

import type { AppData } from "../app-data";

/** 何を upsert し、何を delete するか。 */
export interface TableDiff<T> {
  upsert: T[];
  /** 消えた行の識別子 */
  deleteIds: string[];
}

export interface DataDiff {
  settingsChanged: boolean;
  accounts: TableDiff<Account>;
  recurring: TableDiff<RecurringItem>;
  oneoffs: TableDiff<OneoffItem>;
  actuals: TableDiff<Actual>;
  overrides: TableDiff<{ key: string; value: Overrides[string] }>;
  /** 送るものが何も無いか */
  empty: boolean;
}

/**
 * 同じ内容か。
 *
 * 行は素直なオブジェクトなので JSON で比べて足りる。キーの順序が
 * 変わると別物と判定されうるが、同じコードが作る以上、順序は揃う。
 * 取りこぼしても「余分に送る」だけで、壊れはしない。
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffById<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): TableDiff<T> {
  const before = new Map(previous.map((item) => [item.id, item]));
  const upsert = next.filter((item) => !same(before.get(item.id), item));

  const nextIds = new Set(next.map((item) => item.id));
  const deleteIds = previous
    .map((item) => item.id)
    .filter((id) => !nextIds.has(id));

  return { upsert, deleteIds };
}

function diffOverrides(
  previous: Overrides,
  next: Overrides,
): TableDiff<{ key: string; value: Overrides[string] }> {
  const upsert = Object.entries(next)
    .filter(([key, value]) => !same(previous[key], value))
    .map(([key, value]) => ({ key, value }));

  const deleteIds = Object.keys(previous).filter((key) => !(key in next));

  return { upsert, deleteIds };
}

const nothing = <T>(diff: TableDiff<T>): boolean =>
  diff.upsert.length === 0 && diff.deleteIds.length === 0;

/**
 * 前回保存した状態と今の状態を比べる。
 *
 * @param previous 前回保存に成功した状態。初回は null
 */
export function diffAppData(previous: AppData | null, next: AppData): DataDiff {
  const base: AppData | null = previous;

  const accounts = diffById(base?.accounts ?? [], next.accounts);
  const recurring = diffById(base?.recurring ?? [], next.recurring);
  const oneoffs = diffById(base?.oneoffs ?? [], next.oneoffs);
  const actuals = diffById(base?.actuals ?? [], next.actuals);
  const overrides = diffOverrides(base?.overrides ?? {}, next.overrides);

  const settingsChanged =
    base === null ||
    base.asOf !== next.asOf ||
    base.reserveLine !== next.reserveLine;

  return {
    settingsChanged,
    accounts,
    recurring,
    oneoffs,
    actuals,
    overrides,
    empty:
      !settingsChanged &&
      nothing(accounts) &&
      nothing(recurring) &&
      nothing(oneoffs) &&
      nothing(actuals) &&
      nothing(overrides),
  };
}
