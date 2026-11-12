"use client";

/**
 * 取込先の口座を覚える（FR-60・AC-67）
 *
 * 一次情報：docs/要件定義書.md FR-60・AC-67
 *
 * **いちばん上の口座に戻らないこと。** 戻ると、気づかずに別の口座へ
 * 取り込む。そのとき重複判定の母数が違うので「登録済み」が出ず、同じ
 * 明細を何度でも入れられてしまう（AC-64）。利用者の報告「登録済みの数が
 * 毎回変わる」の一因である。
 *
 * ## どこに覚えるか
 *
 * **ブラウザの `localStorage`。** 取り込むファイルはその機械にあるので、
 * 「この機械で前回選んだ口座」が覚えるべき値である。`settings` の列に
 * すると機械をまたいで揃うが、**マイグレーションが要り、片方の機械で
 * 選び直すともう片方が変わる。** 取込は機械ごとの操作なので、合わない。
 *
 * **読めなくても壊れない。** プライベートウィンドウや、サイトデータを
 * 止めている環境では例外が飛ぶか空が返る。そのときは「覚えていない」と
 * 同じ扱いにする（CLAUDE.md の localStorage の規約と同じ）。
 */

const PREFIX = "sakiguri:import-account:";

/**
 * 鍵。**利用者ごとに分ける。**
 *
 * 1つの鍵にすると、同じブラウザで別の利用者がサインインしたときに
 * **前の利用者の口座 id がその画面に残る。** 選べはしない（その id は
 * 相手の口座一覧に無い）が、他人のデータの断片を持たせない。
 */
function keyOf(userId: string | null | undefined): string | null {
  return userId ? PREFIX + userId : null;
}

/** 前回選んだ口座。覚えていなければ null。 */
export function readImportAccount(userId: string | null | undefined): string | null {
  const key = keyOf(userId);
  if (!key || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 選んだ口座を覚える。保存できなくても黙って諦める。 */
export function writeImportAccount(
  userId: string | null | undefined,
  accountId: string,
): void {
  const key = keyOf(userId);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, accountId);
  } catch {
    /* 保存できないだけ。取込そのものは続けられる */
  }
}

/**
 * どの口座を開くか（AC-67）。**純関数。**
 *
 * 1. 画面で選び直した口座
 * 2. 前回覚えた口座（**いま在る口座のときだけ**）
 * 3. いちばん上の口座
 *
 * **2で「いま在る口座か」を確かめる。** 覚えたあとで口座を消していると、
 * 存在しない id が `<select>` の値になり、**どの選択肢も選ばれていない
 * 見た目**になる。そのまま読み取ると、どこにも属さない実績ができる。
 */
export function pickImportAccount(
  chosen: string,
  remembered: string | null,
  accounts: readonly { id: string }[],
): string {
  if (chosen) return chosen;
  if (remembered && accounts.some((a) => a.id === remembered)) return remembered;
  return accounts[0]?.id ?? "";
}
