"use client";

import * as React from "react";

import { MonthTab } from "@/components/sakiguri/MonthTab";

export interface MonthJumpItem {
  /** 飛び先の要素の id。明細の月区切り行と同じもの */
  id: string;
  label: string;
}

/**
 * 明細の月へ飛ぶ見出し（要望9）
 *
 * **別部品にしてある。** いま見ている月を光らせるにはスクロール位置の
 * 追跡（hooks）が要るが、`CashflowView` は `/dev/screens/cashflow`
 * （サーバ部品）からも描かれるので、あちらに hooks は置けない。
 *
 * 飛び先の id は view-model が明細と同じループで作っている。ここで
 * 組み立て直さないこと。押しても飛ばない見出しができる。
 *
 * **自分で追従しない**（FR-56・AC-62）。以前は `sticky top-0 z-30` を
 * 自分で持っていて、狭い幅では残高ヘッダーを**覆っていた**（z が上）。
 * 追従する領域は画面に1つだけ置き、この見出しはその中に入る。
 * 追従する要素を2つ重ねると、上の要素の高さを定数で書くしかなくなり、
 * 折り返す幅で必ずずれる。
 */
export function MonthJumpNav({ months }: { months: readonly MonthJumpItem[] }) {
  const [active, setActive] = React.useState<string | null>(null);
  /* 配列は毎回新しく来るので、中身で依存を取る */
  const key = months.map((m) => m.id).join("|");

  React.useEffect(() => {
    const ids = key.split("|").filter(Boolean);
    if (ids.length < 2) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      /* **見出しの帯のすぐ下を「現在地」とする。** 帯は 48px で、
         飛んだ先の行は 64px に着く（scroll-mt-64）。その少し下を
         基準にすると、飛んだ直後にその月が選ばれる */
      const line = 72;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
      }
      /**
       * **末尾まで来たら最後の月。**
       *
       * ページの終わりでは、残りの月が同時に画面に収まっていて、もう
       * せり上がれない。そのまま「線を最後に通り過ぎた月」を使うと、
       * 最下部で 12月・1月・2月 を見ているのに「11月」と出る。
       *
       * 実測（6ヶ月・画面900px）：最大スクロール 1864px の時点で
       * 11月 top −115 / 12月 +117 / 1月 +388 / 2月 +620。
       *
       * **短い一覧では、末尾の途中の月は選ばれない。** 全部が同時に
       * 見えている以上「どの月を見ているか」に一意の答えが無いためで、
       * 不具合ではない。12ヶ月ぶんあればページが長くなり、末尾の
       * 1〜2ヶ月を除いてすべて選ばれる。**ここを憶測で埋めないこと。**
       */
      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) {
        setActive(ids[ids.length - 1]);
        return;
      }

      /* どれも通り過ぎていない＝まだ最初の月より上。先頭を選ぶ */
      setActive(current ?? ids[0]);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);

  if (months.length < 2) return null;

  return (
    <nav
      aria-label="月へ移動"
      className="flex shrink-0 items-center gap-8"
    >
      {months.map((m) => (
        <a key={m.id} href={`#${m.id}`}>
          <MonthTab state={m.id === active ? "active" : "inactive"}>{m.label}</MonthTab>
        </a>
      ))}
    </nav>
  );
}
