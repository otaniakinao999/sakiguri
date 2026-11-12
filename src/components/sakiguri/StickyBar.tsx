import * as React from "react";

/**
 * 画面の上辺に追従するバー（FR-56・AC-62。ADR-0032）
 *
 * **口座の絞り込みと月の切り替えを両方持つ画面は、すべてこれを使う**
 * ―― 入出金予定表（SC-03）と実績一覧（SC-05b）。片方の画面にだけ置くと、
 * 同じ形の表で操作できたりできなかったりする（CLAUDE.md §2.8）。
 *
 * **画面の上辺に追従するのはこれ1つだけ。** 2つ置くと、下の要素の `top` に
 * 上の要素の高さを定数で書くしかなく、折り返す幅でずれる（残高ヘッダーは
 * `flex-wrap` なので高さが幅で変わる）。だから `BalanceHeader` も
 * `MonthJumpNav` も `sticky` を持たない。
 *
 * **1行に収める。** 折り返させると高さが変わり、明細の飛び先の
 * `scroll-mt-64` が足りなくなって行がバーの下に潜る。狭い幅では横に送る
 * （サイドバーのナビと同じ扱い）。
 *
 * 重なり順：表の固定セル 10 ＜ **このバー 20** ＜ 編集の覆い 40
 * ＜ `AlertDialog` 50（docs/design/screens.md §0）。
 */
export function StickyBar({
  lead,
  children,
}: {
  /**
   * 横に送っても左端に残すもの ―― 見ている口座。
   *
   * **バーは横に送る**ので、月のタブを押すと器がそちらへ寄って、
   * 口座の選択が左に隠れる（375px で実際にそうなった）。利用者の条件は
   * 「今どの口座を見ているか**常に**確認できること」なので、ここだけ
   * 左に留める。年月別収支の費目列と同じ `sticky left-0`。
   */
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-16 overflow-x-auto border-b border-border bg-card px-32 py-8">
      {lead ? (
        <div className="sticky left-0 z-10 flex shrink-0 items-center bg-card pr-8">
          {lead}
        </div>
      ) : null}
      {children}
    </div>
  );
}
