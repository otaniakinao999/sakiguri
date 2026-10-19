"use client";

/* onClick を持つので境界をここに引く。サーバー側のページ
   （/dev/screens/dashboard-wired）からも描けるようにするため */

import Link from "next/link";

import type { Yen } from "@/core/types";
import { Callout } from "@/components/sakiguri/Callout";
import { Button } from "@/components/ui/v06/button";
import type { DashboardWarning } from "@/lib/dashboard";
import { formatMonthDayJa, formatYen } from "@/lib/format";
import { STRANDED_DAYS, type ReconcileWarnings } from "@/lib/reconcile-warnings";

/**
 * ダッシュボードの警告（SC-02）
 *
 * **v0.6.0 のデザインには無い。** Figma の Hero はグラフ下の1行しか
 * 警告の置き場を持っていないが、v1.0 には残高の警告と消し込みの警告が
 * あり、どちらも要件か受入基準に紐づく（FR-43・AC-29c・指標
 * shortfall_acted）。落とさずに Callout で作り直した。経緯は ADR-0014。
 *
 * **文言はここにしか書かない。** 本番の画面（DashboardScreen）と
 * 配線確認用のページ（/dev/screens/dashboard-wired）が同じものを使う。
 * 画面ごとに書くと片方だけ言い回しが変わる（CLAUDE.md §2.8）。
 */

export function ShortfallNotice({
  warning,
  reserveLine,
  onAct,
}: {
  warning: DashboardWarning;
  reserveLine: Yen;
  /** 指標「残高警告からの操作率」の分子。渡さなければ記録しない */
  onAct?: (toEntry: boolean) => void;
}) {
  return (
    <Callout tone={warning.kind === "shortfall" ? "error" : "caution"}>
      <span className="flex flex-wrap items-center gap-12">
        <span>
          {warning.kind === "shortfall"
            ? "支払時期の調整か資金手当てを検討してください。"
            : `生活防衛ライン（${formatYen(reserveLine)}）を下回る予測です。`}
        </span>
        <span className="flex flex-wrap items-center gap-8">
          <Link href="/entry" onClick={() => onAct?.(true)}>
            <Button size="sm">支払日をずらす・実績を入れる</Button>
          </Link>
          <Link href="/cashflow" onClick={() => onAct?.(false)}>
            <Button variant="outline" size="sm">
              資金繰りを見る
            </Button>
          </Link>
        </span>
      </span>
    </Callout>
  );
}

export function ReconcileNotices({ warnings }: { warnings: ReconcileWarnings }) {
  const { stalled, stranded } = warnings;
  if (!stalled && !stranded) return null;

  return (
    <div className="flex flex-col gap-8">
      {stalled && (
        <Callout tone="caution">
          <span className="flex flex-wrap items-center gap-12">
            {/* 一度も消し込んでいない利用者に「○日止まっています」と出すのは
                誤り。止まっているのではなく、まだ始まっていない（AC-29c）。
                設定だけして放置した新規利用者がこの状態 */}
            <span>
              {stalled.neverReconciled
                ? `まだ一度も消し込みが行われていません（基準日から${stalled.sinceDays}日）。予測はすべて予定額のままです。`
                : `消し込みが${stalled.sinceDays}日止まっています。残高が実態とずれている可能性があります。`}
            </span>
            <Link href="/import">
              <Button variant="outline" size="sm">
                CSVを取り込む
              </Button>
            </Link>
          </span>
        </Callout>
      )}
      {stranded && (
        <Callout tone="caution">
          <span className="flex flex-wrap items-center gap-12">
            <span>
              {STRANDED_DAYS}日以上前の予定が{stranded.count}件、消し込まれずに
              残っています。最も古いものは{formatMonthDayJa(stranded.oldest)}です。
            </span>
            <Link href="/entry">
              <Button variant="outline" size="sm">
                要対応を見る
              </Button>
            </Link>
          </span>
        </Callout>
      )}
    </div>
  );
}
