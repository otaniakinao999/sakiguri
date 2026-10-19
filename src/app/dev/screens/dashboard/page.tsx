/**
 * ダッシュボードの見た目の確認（開発用）
 *
 * Figma 2029:87（Main、1200×1024）と並べるためのページ。
 * **認証の外に置いてある。** AuthGate も AppDataProvider も通らないので、
 * Supabase に到達できない環境でも開ける。
 *
 * 値は docs/design/screens.md の表そのまま。1/17 の大口出金は
 * decisions.md 未決1（1/16 ¥1,905,200 と 1/18 ¥1,382,500 の辻褄）に従って置いた。
 *
 * **ここは Figma との見比べ専用。** 本番の DashboardScreen は同じ
 * DashboardView に実データを渡すが、差し込み口（警告・合計・注記）も
 * 埋めるので見た目は一致しない。差は ADR-0014 にまとめてある。
 *
 * **計算はしていない。**
 */

import type { DateStr, Yen } from "@/core/types";
import { DashboardView, type DashboardTodo } from "@/components/dashboard/DashboardView";
import type { ForecastPoint } from "@/components/sakiguri/ForecastChart";
import { Button } from "@/components/ui/v06/button";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

const TODAY: DateStr = "2026-10-18";
const DEFENSE_LINE: Yen = 1_500_000;

const ms = (d: DateStr) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).getTime();
};

/** 折れ線の節。間は日割りで補間する。 */
const ANCHORS: Array<[DateStr, Yen]> = [
  ["2026-09-18", 2_980_000],
  ["2026-09-24", 2_962_000],
  ["2026-09-25", 3_292_000],
  ["2026-09-27", 3_197_000],
  ["2026-10-02", 3_120_000],
  ["2026-10-10", 2_933_800],
  ["2026-10-14", 2_880_000],
  [TODAY, 2_847_300],
  ["2026-11-17", 2_412_800],
  ["2026-12-12", 2_160_000],
  ["2026-12-25", 1_988_000],
  ["2027-01-16", 1_905_200],
  /* 1/17 に税金の納付 ¥522,700。1/18 の残高に出る（decisions.md 未決1） */
  ["2027-01-17", 1_905_200],
  ["2027-01-18", 1_382_500],
  ["2027-02-15", 1_612_000],
];

const DAY = 86_400_000;

function buildPoints(): ForecastPoint[] {
  const todayT = ms(TODAY);
  const out: ForecastPoint[] = [];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [fromDate, fromValue] = ANCHORS[i];
    const [toDate, toValue] = ANCHORS[i + 1];
    const fromT = ms(fromDate);
    const steps = Math.round((ms(toDate) - fromT) / DAY);
    for (let s = 0; s < steps; s++) {
      const t = fromT + s * DAY;
      const value = Math.round(fromValue + ((toValue - fromValue) * s) / steps);
      out.push({
        t,
        actual: t <= todayT ? value : null,
        forecast: t >= todayT ? value : null,
      });
    }
  }
  const [lastDate, lastValue] = ANCHORS[ANCHORS.length - 1];
  out.push({ t: ms(lastDate), actual: null, forecast: lastValue });
  return out;
}

const TODOS: DashboardTodo[] = [
  { id: "1", date: "9/25", title: "○○商会 売上入金", amount: 330_000, amountType: "income", category: "収入" },
  { id: "2", date: "9/27", title: "事務所家賃", amount: 95_000, amountType: "expense", category: "固定費" },
  { id: "3", date: "10/1", title: "通信費", amount: 9_800, amountType: "expense", category: "固定費" },
  { id: "4", date: "10/5", title: "外注費", amount: 140_000, amountType: "expense", category: "変動費" },
];

export default function DevDashboardPage() {
  return (
    <div className="min-h-screen bg-muted">
      {/* Figma の Main は 1200px。SideNav（240px の列）はこのページには出さない。 */}
      <div className="mx-auto flex min-h-screen w-full max-w-content flex-col">
        <DashboardView
          today={TODAY}
          balance={2_847_300}
          unrecorded={186_400}
          chart={{
            points: buildPoints(),
            todayT: ms(TODAY),
            defenseLine: DEFENSE_LINE,
            markers: [
              { t: ms(TODAY), label: "今日", value: 2_847_300, side: "right" },
              { t: ms("2026-11-17"), label: "30日後（11月17日）", value: 2_412_800, side: "right" },
              { t: ms("2027-01-16"), label: "90日後（1月16日）", value: 1_905_200, side: "left" },
            ],
          }}
          lowPoint={{ date: "2027-01-18", value: 1_382_500 }}
          annotation={{
            tone: "warning",
            prefix: "1月18日に ",
            amount: 1_382_500,
            suffix: "。生活防衛ラインを割る見込みです",
          }}
          todos={TODOS}
          todoCount={TODOS.length}
          accounts={[
            { label: "現金", value: 52_000 },
            { label: "○○銀行 普通", value: 2_145_300 },
            { label: "△△信金 普通", value: 650_000 },
          ]}
          cards={[
            { label: "××カード 確定金額", value: 186_200 },
            { label: "××カード 未確定分", value: 62_400 },
          ]}
          heroActions={
            <Button>
              <ArrowUpTrayIcon />
              CSVを取り込む
            </Button>
          }
          /* Figma の行には「予定どおり」が付いている。本番は消し込みの
             処理がこの画面に無いので渡していない（ADR-0014） */
          rowAction={() => (
            <Button variant="outline" size="sm">
              予定どおり
            </Button>
          )}
        />
      </div>
    </div>
  );
}
