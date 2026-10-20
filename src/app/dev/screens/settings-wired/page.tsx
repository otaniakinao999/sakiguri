/**
 * 予定の設定の確認（開発用）
 *
 * 固定値は親の DevShell が AppDataContext に流し込んでいる。
 * 保存はしない（setData は state に積むだけ）。
 * 基準日の［変更］から日付を変えると、確認ダイアログ（06b）が出る。
 */

import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function DevSettingsWiredPage() {
  return <SettingsScreen />;
}
