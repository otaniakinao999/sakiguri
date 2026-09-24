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
import { fetchAll } from "./fetch-all";
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
 * 保存済みのデータを読む（FR-47）。
 *
 * 行が1件も無ければ（＝はじめての利用）空のデータを返す。
 * サンプルデータは入れない（PoC開発計画 §4 の指標のため）。
 *
 * **2段階で読む。** 先に設定を読んで基準日を確定させ、そのうえで実績と
 * 単発予定を基準日以降に絞る。CL-3 の開始残高が基準日時点で定義され、
 * FR-40 で基準日より前の月を参照しないと決めたため、基準日より前の実績を
 * 読み込む必要がない（§5.1）。性能上の工夫ではなく、計算の定義から従う制約。
 *
 * 取得はすべて `fetchAll` を通す。順序を固定したうえで分割し、総件数と
 * 照合する。合わなければ例外を投げ、**部分的なデータで計算に進ませない**
 * （§5.1.2、AC-34・AC-35）。
 */
export async function loadAppData(
  supabase: SupabaseClient,
  fallbackAsOf: string,
): Promise<AppData> {
  /* 段階1：基準日を確定させる。以降の絞り込みの基準になる */
  const settings = await supabase.from("settings").select("*").maybeSingle();
  if (settings.error) throw new Error(settings.error.message);

  const settingsRow = settings.data as SettingsRow | null;
  const asOf = settingsRow?.as_of ?? fallbackAsOf;
  const since = { column: "date", value: asOf };

  /* 段階2：残りを取る。日付を持つ2つだけ基準日以降に絞る。
     overrides は予定インスタンスキーで引くので日付で絞れない。
     accounts と recurring_items はもともと件数が小さい */
  const [accounts, recurring, oneoffs, actuals, overrides] = await Promise.all([
    fetchAll<AccountRow>(supabase, "accounts"),
    fetchAll<RecurringRow>(supabase, "recurring_items"),
    fetchAll<OneoffRow>(supabase, "oneoff_items", { since }),
    fetchAll<ActualRow>(supabase, "actuals", { since }),
    /* overrides の主キーは plan_key。id 列を持たない */
    fetchAll<OverrideRow>(supabase, "overrides", { idColumn: "plan_key" }),
  ]);

  return {
    asOf,
    reserveLine: settingsRow?.reserve_line ?? 0,
    accounts: accounts.map(toAccount),
    recurring: recurring.map(toRecurring),
    oneoffs: oneoffs.map(toOneoff),
    actuals: actuals.map(toActual),
    overrides: toOverrides(overrides),
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
