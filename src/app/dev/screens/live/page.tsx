"use client";

/**
 * 取込・実績一覧・予定の設定を同じ記憶の上に並べた検証用ページ
 *
 * **画面のあいだを移動せずに、取込 → 登録 → 表示名を直す → 読み直す
 * が1ページで踏める。** dev-shell が差している AppDataContext を3つが
 * 共有するので、取り込んだ行がそのまま一覧に出る。
 *
 * Supabase にも本番にも触れない。
 *
 * ## このページで「実機確認」と書ける範囲（2026-11-15）
 *
 * **保存は記憶上の `setData` である。** `diffAppData` → `saveDiff` は
 * 通らないので、**「保存される」「残る」を条項に含む AC は、ここで
 * 踏んでも満たせない。** 画面には同じ値が出るので、見ているだけでは
 * 区別が付かない ―― だから下に文字で出してある（CLAUDE.md §2.11、
 * §3.1「満たしていない番号を掲げない」）。
 */

import { ActualsScreen } from "@/components/entry/ActualsScreen";
import { ImportScreen } from "@/components/import/ImportScreen";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function DevLivePage() {
  return (
    <>
      <p className="bg-surface-base-secondary text-object-base-mid px-16 py-12 text-body-sm wide:px-32">
        <strong className="text-object-base-high">
          記憶上のデータです。Supabase には書き込みません。
        </strong>{" "}
        取込・登録・編集は setData までで、saveDiff は通りません ――
        <strong className="text-object-base-high">
          「保存される」「次に開いても残る」を条項に含む受入基準は、ここで踏んでも
          実機確認になりません。
        </strong>
      </p>
      <ImportScreen />
      <div className="border-t-border-base-low border-t" />
      <ActualsScreen />
      <div className="border-t-border-base-low border-t" />
      <SettingsScreen />
    </>
  );
}
