/**
 * FR-63 資金移動の向き（移動元 → 移動先）
 *
 * 一次情報：docs/要件定義書.md FR-63・AC-70・制約11
 *
 * **向きが画面から読めないと、逆に入れた行を見つけられない。**
 * 2026-11-12、利用者の現金残高が出納帳と 46,000円 ずれた。原因は1行で、
 * 2026-10-23 の「ＡＴＭ　ローソン」23,000円 が**銀行→現金**として
 * 入っていた（実際は現金→銀行の預け入れ）。向きが逆だと差は額の2倍に
 * なるので 46,000円 である。同じ期間の資金移動18件のうち17件は本当に
 * 銀行→現金の引出しで、名前も同じ「ＡＴＭ　…」で並んでいた。
 *
 * **符号では足りない**（AC-70）。口座を絞れば符号は出るが、合計で見て
 * いるときは閉じる振替の delta が0なので符号が付かない（AC-58b。これ
 * 自体は正しい）。利用者が見ていたのは合計の側である。
 */

import { transferEnds, type Account } from "./types";

/** 振替先が設定されていない行の、移動先の表示。 */
export const NO_DESTINATION = "未設定";

/**
 * 口座が見つからないときの表示。
 *
 * 消した口座を参照している行で起きる（読み取り側で落とさない ――
 * 落とすと「向きの出ない振替」ができて、AC-70 が守りたかったものが
 * 消える）。
 */
export const UNKNOWN_ACCOUNT = "不明な口座";

/** id → 口座名。`formatTransferDirection` に渡す。 */
export function accountNames(
  accounts: readonly Account[],
): ReadonlyMap<string, string> {
  return new Map(accounts.map((a) => [a.id, a.name]));
}

/**
 * 「現金 → ○○銀行」。**向きを持たない行では null。**
 *
 * 向きが出るのは `type = transfer` の行だけである（`transferEnds`）。
 * **両側記録の行**（`type` が income / expense で費目が TRF。適用規則5a）
 * には出ない ―― あの行は `toAccountId` を持たず、口座を1つしか動かさない
 * ので、**合計の範囲でも符号が付く**（AC-58b）。AC-70 が埋めるのは
 * 「符号が付かないのに向きも読めない」行だけで、そこは `transfer` に
 * 限られる。したがって**向きが出る行と出ない行は混ざる**（AC-70）。
 */
export function formatTransferDirection(
  row: { type: string; accountId: string; toAccountId?: string },
  names: ReadonlyMap<string, string>,
): string | null {
  const ends = transferEnds(row);
  if (!ends) return null;
  const from = names.get(ends.fromId) ?? UNKNOWN_ACCOUNT;
  const to =
    ends.toId === null ? NO_DESTINATION : (names.get(ends.toId) ?? UNKNOWN_ACCOUNT);
  return `${from} → ${to}`;
}
