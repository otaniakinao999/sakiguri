/**
 * 未実装の画面の置き場所。
 *
 * アプリシェル（PoC開発計画 フェーズ2・タスク#7）の時点では、
 * どのタブも遷移できることだけを確かめられればよい。
 * 中身はそれぞれのタスクで差し替える。
 */

import { Card } from "@/components/ui/Card";

export function ScreenPlaceholder({
  screenId,
  title,
  summary,
  task,
}: {
  /** 要件定義書 §4.1 の画面ID */
  screenId: string;
  title: string;
  /** その画面が持つ主な内容（要件定義書 §4.1） */
  summary: string;
  /** どのタスクで作るか */
  task: string;
}) {
  return (
    <Card title={`${screenId} ${title}`}>
      <p className="text-object-base-high text-body-sm leading-normal">
        {summary}
      </p>
      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        この画面は {task} で作ります。いまはアプリシェル（左ナビと残高ヘッダー）
        だけが動いています。
      </p>
    </Card>
  );
}
