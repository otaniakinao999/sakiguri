/**
 * 共有の型と、画面に出す形（FR-23・FR-31・FR-67）
 *
 * 一次情報：docs/要件定義書.md FR-23・FR-31・FR-67、AC-76〜AC-84
 *
 * **純関数だけ。** Supabase に触るのは `lib/supabase/sharing.ts`。
 */

/** 権限の段。**2段だけ**（AC-77）。3段目を作らない */
export type GrantLevel = "view" | "edit";

export const LEVEL_LABEL: Record<GrantLevel, string> = {
  view: "閲覧",
  edit: "編集",
};

/** その段でできることの1行説明。招待の画面で、渡す前に読ませる */
export const LEVEL_NOTE: Record<GrantLevel, string> = {
  view: "全画面を読めます。書き込みはすべてできません。",
  edit: "CSV取込・実績の入力と修正・消し込みができます。権限の付与と失効はできません。",
};

/**
 * いま見られる帳。
 *
 * **自分の帳が必ず1つ目にある。** 付与が0件なら長さ1で、画面は
 * いまと同じに見える（AC-84）。
 */
export interface Book {
  ownerId: string;
  /** 画面に出す名前。自分の帳は null（**何も出さない**。AC-84） */
  label: string | null;
  /** 自分の帳か */
  own: boolean;
  /** 他人の帳のときの段。自分の帳では null */
  level: GrantLevel | null;
}

/** 持ち主が出した招待の1行（AC-83） */
export interface InviteRow {
  id: string;
  email: string;
  level: GrantLevel;
  /** null なら未受諾 */
  acceptedAt: string | null;
  /**
   * 受諾した相手。未受諾なら null。
   *
   * **失効に要る。** `grants` の主キーは（持ち主, 相手）で、一覧は
   * アドレスで並ぶので、ここで結んでおかないと消す相手が特定できない。
   */
  granteeId: string | null;
}

/**
 * 自分の帳だけの一覧。
 *
 * **付与が0件でもこれが返る。** 画面は長さ1かどうかで出し分ける。
 */
export function ownBookOnly(userId: string): Book[] {
  return [{ ownerId: userId, label: null, own: true, level: null }];
}

/**
 * いま見ている帳。
 *
 * **見つからなければ自分の帳に戻す。** 付与を失効されたあと、
 * 画面がその帳を指したままになると、読めない帳を見続けることになる
 * （AC-82 の「失効したら見えなくなる」）。
 */
export function activeBook(books: Book[], activeOwnerId: string): Book {
  return books.find((b) => b.ownerId === activeOwnerId) ?? books[0];
}

/**
 * 他人の帳にいるときだけ出す文言（AC-84）。
 *
 * **自分の帳では null。** 共有を使わない人に語を増やさない。
 */
export function bookBadge(book: Book): string | null {
  if (book.own || !book.label) return null;
  return book.label;
}

/** 招待の状態の表示（AC-83）。未受諾が分かることが肝 */
export function inviteStatus(invite: InviteRow): "未受諾" | "受諾済み" {
  return invite.acceptedAt === null ? "未受諾" : "受諾済み";
}

/**
 * アドレスの形だけを見る。
 *
 * **登録されているかは見ない**（AC-79）。見られる手段が無いし、
 * 作ってもいけない ―― あれば誰でもアドレスの存在を試せる。
 */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
