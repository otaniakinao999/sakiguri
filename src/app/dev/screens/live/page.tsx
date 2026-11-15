"use client";

/**
 * 取込と実績一覧を同じ記憶の上に並べた検証用ページ
 *
 * **画面のあいだを移動せずに、取込 → 登録 → 表示名を直す → 読み直す
 * が1ページで踏める。** dev-shell が差している AppDataContext を両方が
 * 共有するので、取り込んだ行がそのまま一覧に出る。
 *
 * Supabase にも本番にも触れない。
 */

import { ActualsScreen } from "@/components/entry/ActualsScreen";
import { ImportScreen } from "@/components/import/ImportScreen";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function DevLivePage() {
  return (
    <>
      <ImportScreen />
      <div className="border-t-border-base-low border-t" />
      <ActualsScreen />
      <div className="border-t-border-base-low border-t" />
      <SettingsScreen />
    </>
  );
}
