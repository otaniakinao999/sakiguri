"use client";

/**
 * 分割取得と切り捨ての検知（FR-47）
 *
 * 一次情報：docs/要件定義書.md §5.1.2「データ取得の完全性」
 * 対応する受入基準：AC-34、AC-35
 *
 * PostgREST は1回の応答で返す行数に上限を持つ（Supabase の Max rows。既定
 * 1000）。`select("*")` はこの上限で**黙って打ち切られる**。エラーにならず、
 * 短い配列がそのまま返る。
 *
 * これを計算に渡すと、CL-3 が一部の実績しか知らないまま残高を出す。消し込み
 * 済みの予定が未消し込みとして復活し、残高と防衛ラインの警告が同時に狂う。
 * **エラーにならず、画面にも異常が出ず、利用者に気づく手段がない。**
 *
 * 上限値を上げて解決する方向には寄らない。設定を上げても別の上限に当たる
 * だけで構造は変わらない（supabase/supabase#33741、#4544）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 1回の取得件数。
 *
 * Max rows の既定値と同じにしてある。実際の上限がこれより小さくても
 * 動く（受け取った件数だけ進める）し、大きくても正しく全件を取る。
 */
export const PAGE_SIZE = 1000;

/**
 * 分割取得が終わらないときの打ち切り。
 *
 * 実績10万件（§5.1）なら100回で足りる。無限ループで画面が固まるより、
 * 例外にして読み込み失敗を伝えるほうがよい。
 */
const MAX_PAGES = 500;

/** 読み込みが不完全だったことを表す例外。 */
export class IncompleteLoadError extends Error {
  constructor(
    readonly table: string,
    readonly expected: number,
    readonly received: number,
  ) {
    super(
      `${table} の読み込みが不完全です（${expected}件のうち${received}件）`,
    );
    this.name = "IncompleteLoadError";
  }
}

export interface FetchAllOptions {
  /** この日以降の行だけを取る。日付を持つテーブルにだけ指定する */
  since?: { column: string; value: string };
  /**
   * 一意に並べ替えられる列。既定は `id`。
   *
   * `overrides` は主キーが `plan_key` で `id` 列を持たない。同順の行が
   * 出ないよう、テーブルごとに一意な列を指定する。
   */
  idColumn?: string;
}

/**
 * 1テーブルを全件取得する。
 *
 * **`order` を必ず指定する。** PostgreSQL は ORDER BY のないクエリの行順序を
 * 保証しないため、順序を固定せずに範囲で分割すると、ページの境界で同じ行が
 * 2回返り、別の行が1回も返らない状態になる。しかもその場合**件数は一致する**
 * ので、下の切り捨て検知をすり抜ける。順序の固定と件数の検知は、どちらか
 * 一方では足りない（§5.1.2）。
 *
 * 並びは `date` 昇順、同日は一意な列の昇順（AC-34）。日付を持たないテーブルは
 * その列だけで並べる。一意な列は既定で `id`、`overrides` は `plan_key`。
 */
export async function fetchAll<Row>(
  supabase: SupabaseClient,
  table: string,
  { since, idColumn = "id" }: FetchAllOptions = {},
): Promise<Row[]> {
  const rows: Row[] = [];
  let total: number | null = null;

  /**
   * 次に要求する開始位置。
   *
   * **受け取った件数ぶんだけ進める。** `PAGE_SIZE` ずつ進めると、サーバー側の
   * 上限がこれより小さい環境で行を飛ばす。要求 0〜999 に対して100件しか
   * 返らないとき、次を1000から取ると 100〜999 が永久に読まれない。
   */
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    let query = supabase
      .from(table)
      .select("*", { count: "exact" })
      .range(offset, offset + PAGE_SIZE - 1);

    if (since) query = query.gte(since.column, since.value);
    /* 順序の固定。分割取得の前提条件（§5.1.2） */
    if (since) query = query.order(since.column, { ascending: true });
    query = query.order(idColumn, { ascending: true });

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    if (count !== null) total = count;
    const got = (data ?? []) as Row[];
    rows.push(...got);
    offset += got.length;

    /* 空が返ったら、それ以上は無い */
    if (got.length === 0) break;
    if (total !== null && rows.length >= total) break;
  }

  /* 切り捨ての検知。合わなければ計算に進ませない（AC-35） */
  if (total !== null && rows.length !== total) {
    throw new IncompleteLoadError(table, total, rows.length);
  }

  return rows;
}
