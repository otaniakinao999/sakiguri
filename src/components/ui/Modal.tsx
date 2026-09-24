"use client";

/**
 * モーダル
 *
 * designsystem.md にモーダルの定義は無い。新しい見た目を作らないよう、
 * §4 Card と同じ面（surface-base-primary、rounded-base、border-base-low）を
 * 使い、背後を覆うだけにしてある。色は §1.2 セマンティックのみ
 * （CLAUDE.md §2.6）。
 *
 * 実績の手入力は例外処理なので、操作を1つ挟んだ先に置く（§4.1.1）。
 * 常時表示すると、主であるはずの要対応リストと同じ重みで並んでしまう。
 */

import { useEffect, useId, useRef } from "react";

import { Button } from "./Button";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  /* Esc で閉じる。開いているあいだ背後をスクロールさせない */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  /* 開いたら中へフォーカスを移す。背後のボタンに残ったままにしない */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="bg-object-base-high/40 fixed inset-0 z-30 flex items-start justify-center overflow-auto p-12 wide:p-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-surface-base-primary border-border-base-low rounded-base my-24 w-full max-w-[640px] border p-16 shadow-lg wide:p-24"
      >
        <div className="mb-16 flex items-start justify-between gap-16">
          <h2
            id={titleId}
            className="text-object-base-high text-body-lg font-semibold"
          >
            {title}
          </h2>
          <Button size="sm" onClick={onClose}>
            閉じる
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
