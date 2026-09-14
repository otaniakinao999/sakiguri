"use client";

/**
 * 保存の状態
 *
 * 一次情報：docs/要件定義書.md §5.2
 *   保存は変更から400msのデバウンス後に自動実行し、**失敗時は画面上に
 *   明示する。** 保存失敗時もセッション中のデータは失わないこと。
 */

import { useAppData } from "./AppDataProvider";

export function SaveIndicator() {
  const { saveState, session } = useAppData();
  if (!session) return null;

  if (saveState.status === "error") {
    return (
      <span
        role="alert"
        className="text-object-error-dim border-border-error-high bg-surface-error-subtle rounded-base border px-8 py-4 text-body-xxs"
        title={saveState.message}
      >
        保存できませんでした（入力はこの画面に残っています）
      </span>
    );
  }

  const label =
    saveState.status === "saving"
      ? "保存中…"
      : saveState.status === "saved"
        ? "保存しました"
        : null;

  if (!label) return null;
  return (
    <span className="text-object-base-mid text-body-xxs">{label}</span>
  );
}
