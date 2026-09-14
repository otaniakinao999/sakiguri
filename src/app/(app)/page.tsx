import { ScreenPlaceholder } from "@/components/app-shell/ScreenPlaceholder";

export default function DashboardPage() {
  return (
    <ScreenPlaceholder
      screenId="SC-02"
      title="ダッシュボード"
      summary="90日最低残高と警告、当月予実、口座・カード一覧、未入力の予定、直近の大きな入出金、繰延した予定。"
      task="フェーズ2・タスク#7 以降"
    />
  );
}
