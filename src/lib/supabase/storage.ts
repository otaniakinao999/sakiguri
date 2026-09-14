"use client";

/**
 * 読み込みと保存
 *
 * 一次情報：docs/要件定義書.md FR-17、§5.2
 *   保存は変更から400msのデバウンス後に自動実行し、失敗時は画面上に
 *   明示する。保存失敗時もセッション中のデータは失わないこと。
 *
 * **送るのは差分だけ**（diff.ts）。テーブルの絞り込みに user_id を
 * 書いていないのは、RLS が行を絞るためである（CLAUDE.md §2.5）。
 * 念のため insert する行には user_id を入れる。with check が弾く。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppData } from "../app-data";
import { emptyAppData } from "../app-data";
import type { DataDiff } from "./diff";
import {
  fromAccount,
  fromActual,
  fromOneoff,
  fromOverride,
  fromRecurring,
  fromSettings,
  toAccount,
  toActual,
  toOneoff,
  toOverrides,
  toRecurring,
  type AccountRow,
  type ActualRow,
  type OneoffRow,
  type OverrideRow,
  type RecurringRow,
  type SettingsRow,
} from "./rows";

/**
 * 保存済みのデータを読む。
 *
 * 行が1件も無ければ（＝はじめての利用）空のデータを返す。
 * サンプルデータは入れない（PoC開発計画 §4 の指標のため）。
 */
export async function loadAppData(
  supabase: SupabaseClient,
  fallbackAsOf: string,
): Promise<AppData> {
  const [settings, accounts, recurring, oneoffs, actuals, overrides] =
    await Promise.all([
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("accounts").select("*"),
      supabase.from("recurring_items").select("*"),
      supabase.from("oneoff_items").select("*"),
      supabase.from("actuals").select("*"),
      supabase.from("overrides").select("*"),
    ]);

  for (const result of [settings, accounts, recurring, oneoffs, actuals, overrides]) {
    if (result.error) throw new Error(result.error.message);
  }

  const settingsRow = settings.data as SettingsRow | null;

  return {
    asOf: settingsRow?.as_of ?? fallbackAsOf,
    reserveLine: settingsRow?.reserve_line ?? 0,
    accounts: ((accounts.data ?? []) as AccountRow[]).map(toAccount),
    recurring: ((recurring.data ?? []) as RecurringRow[]).map(toRecurring),
    oneoffs: ((oneoffs.data ?? []) as OneoffRow[]).map(toOneoff),
    actuals: ((actuals.data ?? []) as ActualRow[]).map(toActual),
    overrides: toOverrides((overrides.data ?? []) as OverrideRow[]),
    ...(settingsRow ? {} : emptyDefaults(fallbackAsOf)),
  };
}

/** 設定が無いときの既定。空のデータと同じ値にする。 */
function emptyDefaults(asOf: string): Pick<AppData, "asOf" | "reserveLine"> {
  const base = emptyAppData(asOf);
  return { asOf: base.asOf, reserveLine: base.reserveLine };
}

/**
 * 差分を保存する。
 *
 * どれか1つでも失敗したら例外を投げる。呼び出し側は「前回保存に
 * 成功した状態」を更新せず、次回のデバウンスで再送する。
 */
export async function saveDiff(
  supabase: SupabaseClient,
  userId: string,
  diff: DataDiff,
  data: AppData,
): Promise<void> {
  const tasks: PromiseLike<{ error: { message: string } | null }>[] = [];

  if (diff.settingsChanged) {
    tasks.push(supabase.from("settings").upsert(fromSettings(data, userId)));
  }

  /** 消えた行を落とす。RLS が他人の行には当たらないようにしている */
  const remove = (table: string, ids: string[], idColumn = "id") => {
    if (ids.length > 0) {
      tasks.push(supabase.from(table).delete().in(idColumn, ids));
    }
  };

  if (diff.accounts.upsert.length > 0) {
    tasks.push(
      supabase
        .from("accounts")
        .upsert(diff.accounts.upsert.map((a) => fromAccount(a, userId))),
    );
  }
  remove("accounts", diff.accounts.deleteIds);

  if (diff.recurring.upsert.length > 0) {
    tasks.push(
      supabase
        .from("recurring_items")
        .upsert(diff.recurring.upsert.map((r) => fromRecurring(r, userId))),
    );
  }
  remove("recurring_items", diff.recurring.deleteIds);

  if (diff.oneoffs.upsert.length > 0) {
    tasks.push(
      supabase
        .from("oneoff_items")
        .upsert(diff.oneoffs.upsert.map((o) => fromOneoff(o, userId))),
    );
  }
  remove("oneoff_items", diff.oneoffs.deleteIds);

  if (diff.actuals.upsert.length > 0) {
    tasks.push(
      supabase
        .from("actuals")
        .upsert(diff.actuals.upsert.map((a) => fromActual(a, userId))),
    );
  }
  remove("actuals", diff.actuals.deleteIds);

  if (diff.overrides.upsert.length > 0) {
    tasks.push(
      supabase
        .from("overrides")
        .upsert(
          diff.overrides.upsert.map(({ key, value }) =>
            fromOverride(key, value, userId),
          ),
        ),
    );
  }
  remove("overrides", diff.overrides.deleteIds, "plan_key");

  const results = await Promise.all(tasks);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/** サインアウト時に、そのブラウザから消す。 */
export function clearLocalData(asOf: string): AppData {
  return emptyAppData(asOf);
}
