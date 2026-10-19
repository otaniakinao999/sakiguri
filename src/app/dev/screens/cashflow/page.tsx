/**
 * キャッシュフローの見た目の確認（開発用）
 *
 * Figma 2030:97（1440×1605）と並べるためのページ。値は screens.md 02 と
 * Figma の描画そのまま。**認証の外に置いてある。**
 *
 * **計算はしていない。** 本番は CashflowScreen が同じ props を作って
 * 同じ CashflowView に渡す。
 */

import { CashflowView } from "@/components/cashflow/CashflowView";
import {
  buildSamplePoints,
  msOf,
  SAMPLE_DEFENSE_LINE,
  SAMPLE_TODAY,
} from "../../sample-series";

export default function DevCashflowPage() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex min-h-screen w-full max-w-main flex-col">
        <CashflowView
          stats={[
            { label: "今日の残高", value: 2_847_300 },
            { label: "30日後", value: 2_412_800 },
            { label: "90日後", value: 1_905_200 },
            { label: "カード未払", value: 248_600, tone: "expense" },
          ]}
          chart={{
            points: buildSamplePoints(),
            todayT: msOf(SAMPLE_TODAY),
            defenseLine: SAMPLE_DEFENSE_LINE,
          }}
          trend={{
            defaultValue: "daily",
            options: [
              { value: "daily", label: "日次" },
              { value: "monthly", label: "月次" },
            ],
          }}
          months={[
            { label: "2026年9月", income: 1_180_000, expense: 947_500, endBalance: 2_847_300, lowest: 2_580_000 },
            { label: "2026年10月", income: 860_000, expense: 1_294_500, endBalance: 2_412_800, lowest: 2_180_000 },
            { label: "2026年11月", income: 720_000, expense: 1_102_000, endBalance: 2_030_800, lowest: 1_880_000 },
            { label: "2026年12月", income: 540_000, expense: 1_188_300, endBalance: 1_382_500, lowest: 1_382_500, highlight: true },
            { label: "2027年1月", income: 980_000, expense: 842_300, endBalance: 1_520_200, lowest: 1_382_500 },
            { label: "2027年2月", income: 1_040_000, expense: 655_000, endBalance: 1_905_200, lowest: 1_790_000 },
          ]}
          monthsNote="月末がプラスでも、月中に生活防衛ラインを割る月は色が変わります（2026年12月）。"
          ledger={[
            { id: "1", date: "9/25", title: "○○商会 売上入金", amount: 330_000, amountType: "income", category: "収入", status: "予定" },
            { id: "2", date: "9/27", title: "事務所家賃", amount: 95_000, amountType: "expense", category: "固定費", status: "予定" },
            { id: "3", date: "9/30", title: "△△信金へ振替", amount: 200_000, amountType: "neutral", category: "振替", status: "実績", note: "合計残高は増減なし" },
            { id: "4", date: "10/1", title: "通信費", amount: 9_800, amountType: "expense", category: "固定費", status: "実績" },
            { id: "5", date: "10/5", title: "外注費", amount: 140_000, amountType: "expense", category: "変動費", status: "予定" },
            /* Figma の区分は「固定費」だが、カード引落の行に固定費を付けると
               「カード引落」フィルターが1件も拾わない。区分を直した（ADR-0014） */
            { id: "6", date: "10/10", title: "××カード 引落", amount: 186_200, amountType: "expense", category: "カード引落", status: "予定", note: "自動で作られる行（編集できません）" },
            { id: "7", date: "10/15", title: "水道光熱費", amount: 14_200, amountType: "expense", category: "変動費", status: "予定", note: "繰延（元の日付 10/8）" },
          ]}
          period={{
            defaultValue: "recent",
            options: [
              { value: "recent", label: "先月〜6ヶ月" },
              { value: "1", label: "今月" },
              { value: "3", label: "3ヶ月" },
              { value: "6", label: "6ヶ月" },
              { value: "12", label: "12ヶ月" },
              { value: "custom", label: "期間を指定" },
            ],
          }}
          categoryFilter={{
            defaultValue: "all",
            options: [
              { value: "all", label: "すべて" },
              { value: "income", label: "入金" },
              { value: "fixed", label: "固定費" },
              { value: "variable", label: "変動費" },
              { value: "card", label: "カード引落" },
              { value: "transfer", label: "振替" },
            ],
          }}
          kindFilter={{
            defaultValue: "both",
            options: [
              { value: "both", label: "予定+実績" },
              { value: "plan", label: "予定のみ" },
              { value: "actual", label: "実績のみ" },
            ],
          }}
        />
      </div>
    </div>
  );
}
