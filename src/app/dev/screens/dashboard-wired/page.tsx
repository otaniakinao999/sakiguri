/**
 * ダッシュボードの**配線**の確認（開発用）
 *
 * /dev/screens/dashboard が Figma と見比べるためのページで、こちらは
 * **実データの経路を通したときにどう出るか**を見るためのページ。
 * buildForecast から buildDashboardViewModel まで本番と同じ関数を通す。
 * フィクスチャは dashboard-fixture.ts。
 *
 * **認証の外に置いてある。** Supabase に到達できない環境でも開ける。
 *
 * 期間タブは操作できない（このページは状態を持たない）。切り替えの
 * 確認は本番の画面でする。
 */

import { DashboardView } from "@/components/dashboard/DashboardView";
import {
  ReconcileNotices,
  ShortfallNotice,
} from "@/components/dashboard/DashboardNotices";
import {
  buildFixtureModel,
  FIXTURE_RESERVE_LINE,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import { buildDashboardViewModel } from "@/components/dashboard/dashboard-view-model";
import { Button } from "@/components/ui/v06/button";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

export default function DevDashboardWiredPage() {
  const { series, dashboard, reconcile } = buildFixtureModel();
  const view = buildDashboardViewModel({
    series,
    dashboard,
    today: FIXTURE_TODAY,
    reserveLine: FIXTURE_RESERVE_LINE,
    range: "90",
  });

  return (
        <DashboardView
          {...view}
          heroActions={
            <Button>
              <ArrowUpTrayIcon />
              CSVを取り込む
            </Button>
          }
          heroNotice={
            dashboard.warning && (
              <ShortfallNotice
                warning={dashboard.warning}
                reserveLine={FIXTURE_RESERVE_LINE}
              />
            )
          }
          notices={<ReconcileNotices warnings={reconcile} />}
          todoAction={
            view.todoCount > 0 ? (
              <Button variant="outline" size="sm">
                消し込む
              </Button>
            ) : undefined
          }
          footer={
            <p className="t-body-sm text-muted-foreground">
              借入の返済を定期項目1件として登録している場合、元金と利息が分かれない
              ため、年月別収支の費用が実際より大きく出ます（資金繰りの予測は実態と
              一致します）。元金と利息の自動分離は v2.0 で対応します。
            </p>
          }
        />
  );
}
