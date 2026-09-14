/**
 * オーバーライド一覧の表示（SC-07）
 *
 * 一次情報：docs/要件定義書.md §3.2「予定インスタンスキーの規約」、§4.1 SC-07
 *
 * オーバーライドはキーだけを持つマップなので、そのままでは
 * `o:47d6ec8e-…` としか出せない。キーから元の項目を引いて、
 * 「何の予定を、いつからいつへ動かしたか」を読める形にする。
 */

import type { DateStr, Override } from "@/core/types";

import type { AppData } from "./app-data";

export interface OverrideEntry {
  key: string;
  override: Override;
  /** 元の項目の名前。見つからなければ null */
  name: string | null;
  /** 定期項目なら元の発生日。単発予定なら登録されている日付 */
  originalDate: DateStr | null;
  /** 定期項目か単発予定か。判別できなければ null */
  source: "recurring" | "oneoff" | null;
  /** 元の項目がもう無い。消し忘れたオーバーライド */
  orphaned: boolean;
}

/**
 * キーを分解する。
 *
 * 定期項目 `r:{recurringId}:{元の発生日}`、単発予定 `o:{oneoffId}`。
 * 発生日は末尾10文字に固定なので、id にコロンが含まれていても切り出せる。
 */
export function parseOverrideKey(key: string): {
  source: "recurring" | "oneoff" | null;
  id: string;
  originalDate: DateStr | null;
} {
  if (key.startsWith("r:") && key.length > 13) {
    return {
      source: "recurring",
      id: key.slice(2, key.length - 11),
      originalDate: key.slice(-10),
    };
  }
  if (key.startsWith("o:")) {
    return { source: "oneoff", id: key.slice(2), originalDate: null };
  }
  return { source: null, id: key, originalDate: null };
}

/** 一覧に出す形にする。並びは元の日付の順。 */
export function listOverrides(data: AppData): OverrideEntry[] {
  return Object.entries(data.overrides)
    .map(([key, override]): OverrideEntry => {
      const { source, id, originalDate } = parseOverrideKey(key);

      if (source === "recurring") {
        const item = data.recurring.find((r) => r.id === id);
        return {
          key,
          override,
          name: item?.name ?? null,
          originalDate,
          source,
          orphaned: item === undefined,
        };
      }
      if (source === "oneoff") {
        const item = data.oneoffs.find((o) => o.id === id);
        return {
          key,
          override,
          name: item?.name ?? null,
          originalDate: item?.date ?? null,
          source,
          orphaned: item === undefined,
        };
      }
      return { key, override, name: null, originalDate: null, source, orphaned: true };
    })
    .sort((a, b) => (a.originalDate ?? "") < (b.originalDate ?? "") ? -1 : 1);
}

/** 「何をどう変えたか」の1行の説明。 */
export function describeOverride(entry: OverrideEntry): string {
  const { override, originalDate } = entry;
  if (override.skipped) return "今回は無し";

  const parts: string[] = [];
  if (override.date) {
    parts.push(originalDate ? `${originalDate} → ${override.date}` : `${override.date} へ`);
  }
  if (override.amount !== undefined) {
    parts.push(`金額を ${override.amount.toLocaleString("ja-JP")} 円に`);
  }
  return parts.length > 0 ? parts.join(" ／ ") : "メモのみ";
}
