/**
 * 明細の予定の行から、元の設定へ飛ぶ（FR-57・AC-63）
 *
 * 一次情報：docs/要件定義書.md AC-63、OI-23（2026-11-12 解決）
 *
 * **飛び先の id を作るのはここだけにする**（CLAUDE.md §2.8）。
 * リンクを作る側（入出金予定表）と、飛び先に id を付ける側（予定の設定）
 * が別々に文字列を組み立てると、**片方を変えたときに押しても何も起きない
 * リンクができる。** 押した結果が出ないので、画面を見ても気づけない。
 *
 * **「この回だけ」の変更には飛ばさない。** 明細で見つかる誤り ―― 振替先の
 * 未設定、費目の間違い ―― は**項目そのもの**の誤りであり、この回だけ直して
 * も次回また出る（OI-23）。繰延（`Override`）は別の操作で、やることの
 * ［払えなかった］から入る。
 */

import type { ForecastSource } from "@/core/types";

/**
 * 設定の表の行に付ける id。
 *
 * `src` を含めるのは、定期項目と単発予定で id の空間が別だからである
 * （どちらも UUID なので衝突はまず無いが、見て区別が付くほうがよい）。
 */
export function planAnchorId(src: ForecastSource, id: string): string {
  return `plan-${src}-${id}`;
}

/** 予定の設定へのリンク。`/settings` の中の当の行を指す */
export function planSettingsHref(src: ForecastSource, id: string): string {
  return `/settings#${planAnchorId(src, id)}`;
}
