"use client";

/**
 * 保存の状態を出すトースト
 *
 * 一次情報：docs/要件定義書.md §5.2
 *   保存は変更から400msのデバウンス後に自動実行し、**失敗時は画面上に
 *   明示する。** 保存失敗時もセッション中のデータは失わないこと。
 *
 * designsystem.md にトーストの定義は無い。新しい見た目を作らないよう、
 * §4 Notification の語彙（左に4pxのバー、surface-*-subtle の背景）を
 * そのまま借りている。色は §1.2 セマンティックのみ（CLAUDE.md §2.6）。
 *
 * **1枚しか出さない。** 予定の設定画面は1画面に数十の入力欄があるインライン
 * 編集で、積み上げると編集そのものを覆う。枚数を増やさず、同じ1枚を
 * 書き換える。
 *
 * 「保存しました」は自動で消す。失敗は消さず、再試行ボタンを出す。
 * 消えない失敗と消える成功を分けているのは、利用者が対処すべきものだけを
 * 画面に残すため。
 */

import { useEffect, useState } from "react";

import { useAppData } from "./AppDataProvider";
import { Button } from "@/components/ui/Button";

/** 「保存しました」を出しておく時間。読めて、邪魔にならない長さ */
const SAVED_VISIBLE_MS = 2000;

export function SaveToast() {
  const { saveState, retrySave, session } = useAppData();
  const [visible, setVisible] = useState(false);

  const { status, seq } = saveState;

  useEffect(() => {
    if (status === "idle") {
      setVisible(false);
      return;
    }
    setVisible(true);

    /* 成功だけ引っ込める。保存中は結果が出るまで、失敗は対処するまで残す */
    if (status !== "saved") return;
    const timer = setTimeout(() => setVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
    /* seq を見ているのは、同じ status へ連続で入ったときに出し直すため */
  }, [status, seq]);

  if (!session || !visible || status === "idle") return null;

  const failed = status === "error";

  return (
    <div
      /* 画面の端に固定する。wide 未満では左右いっぱいに寝かせる */
      className="
        pointer-events-none fixed inset-x-12 bottom-12 z-20 flex justify-center
        wide:inset-x-auto wide:right-24 wide:bottom-24 wide:justify-end
      "
    >
      <div
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
        className={`
          pointer-events-auto border-border-base-low text-object-base-high
          rounded-base flex max-w-full items-center gap-12 border border-l-4 p-12
          text-body-xs leading-normal shadow-lg
          ${
            failed
              ? "border-l-object-error-dim bg-surface-error-subtle"
              : "border-l-object-accent-dim bg-surface-base-primary"
          }
        `}
      >
        {failed ? (
          <>
            <span>
              <strong className="text-object-error-dim font-semibold">
                保存できませんでした。
              </strong>
              <span className="text-object-base-mid block text-body-xxs">
                入力はこの画面に残っています。通信が戻ったら、もう一度お試し
                ください。
              </span>
            </span>
            <Button size="sm" color="black" onClick={retrySave}>
              再試行
            </Button>
          </>
        ) : (
          <span className="text-object-base-mid">
            {status === "saving" ? "保存中…" : "保存しました"}
          </span>
        )}
      </div>
    </div>
  );
}
