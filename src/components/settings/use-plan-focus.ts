"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 明細から飛んできた予定を、画面に送って色で示す（FR-57・AC-63）
 *
 * 返すのは**飛び先の行の id**。表はそれと自分の行を突き合わせて色を付ける。
 *
 * **ブラウザ任せにできない理由が2つある。**
 *
 * 1. **アンカーの自動スクロールが空振りする。** 飛んだ時点では設定の表が
 *    まだ描かれていない ―― データは Supabase から読み終わってから入る。
 *    対象が無いので何も起きず、**飛んだ先は一覧の先頭のまま**になる。
 *    AC-63 が禁じている形である
 * 2. **`:target` が当たらない。** 画面内の遷移は履歴の書き換えなので、
 *    `:target` が付け直されない（実機で背景が `rgba(0,0,0,0)` のまま
 *    だった）。CSS だけでは示せない
 *
 * **時間で待たない。** データが入るたびに呼び直し、見つかった一度だけ
 * 送る。10万件の利用者では読み込みに秒単位かかるので、フレーム数で
 * 打ち切ると静かに外れる。
 */
export function usePlanFocus(data: unknown): string | null {
  /* ハッシュはマウント後に読む。サーバー側では `window` が無く、
     静的生成とハイドレーションがずれる */
  const [focus, setFocus] = useState<string | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    setFocus(id || null);
  }, []);

  useEffect(() => {
    if (!focus || scrolled.current) return;
    const el = document.getElementById(focus);
    if (!el) return;

    scrolled.current = true;
    /* jsdom には実装が無い。レイアウトは測れない（§2.7）ので、
       測るのは「当の行を相手に呼んだか」である */
    el.scrollIntoView?.({ block: "center" });
  }, [focus, data]);

  return focus;
}
