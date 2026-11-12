/**
 * FR-64 口座ごとの日別の増減と残高
 *
 * 一次情報：docs/要件定義書.md FR-64・AC-71・制約11
 *
 * **出納帳と1日ずつ突き合わせるための表である。** 2026-11-12、利用者の
 * 現金残高が出納帳と 46,000円 ずれたとき、**どの日でずれたのかを画面から
 * 辿る手段が無かった。** 月次資金繰り表は月単位で、残高推移のグラフは
 * 合計である。
 *
 * ## 増減と残高を別々に出す（AC-71）
 *
 * **増減は行から足し、残高は系列から取る。** 残高の差から増減を引くと
 * （`balance[i] − balance[i-1]`）、**合計は必ず「期末 − 期首」に一致する**
 * ―― どの実装でも通る条項になる（CLAUDE.md §2.11 の4つ目の形）。
 * 別々に出すから、**どこかの行を二重に数えたか落としたときに割れる。**
 *
 * これは AC-68（取込の残高検算）と同じ考え方である ―― 判定を完璧にする
 * のではなく、独立した2つの値を突き合わせる。
 */

import { accountDelta, depositIdsOf, type BalanceSeries } from "./balance";
import { touchesAccount } from "./types";
import type { Account, DateStr, Yen } from "./types";

/** 1日ぶん。**その口座を動かした行が1件も無い日は作らない。** */
export interface AccountDailyRow {
  date: DateStr;
  /** その日の増減（符号付き）。**その日の行から足す** */
  delta: Yen;
  /** その日の終わりの残高。**系列から取る**（`byAccount`） */
  balance: Yen;
  /**
   * その日にこの口座に関わる行の件数。
   *
   * **増減が0でも出す。** 反映していない振替（振替先が未設定・カード）は
   * 明細に在るのに残高を動かさないので、件数が無いと「この日は何も無い」
   * と読まれる（`oneSidedReason`）。
   */
  count: number;
  /** そのうち、まだ実績が入っていない予定の件数 */
  planCount: number;
}

export interface AccountDaily {
  rows: AccountDailyRow[];
  /** 期首残高（`from` の前日の終値。`from` が基準日ならその口座の基準日残高） */
  opening: Yen;
  /** 期末残高（`to` の終値） */
  closing: Yen;
  /** 増減の合計。**行から足したもの**（残高の差ではない） */
  total: Yen;
  /**
   * AC-71 の留め具。`total − (closing − opening)`。
   *
   * **0 でなければ、どこかの行を二重に数えているか落としている。**
   * 画面に出す（黙って合わせない ―― 合わせると、ずれていることが
   * 分からなくなる）。
   */
  gap: Yen;
}

export interface AccountDailyInput {
  /** CL-3 の出力。**予測系列を使う**（AC-49a） */
  series: BalanceSeries;
  /** 基準日残高を引くために要る（`from` が基準日のとき） */
  accounts: readonly Account[];
  accountId: string;
  /** 両端を含む */
  from: DateStr;
  to: DateStr;
}

/**
 * 口座1つぶんの日別。
 *
 * **予測系列から作る**（AC-49a）。実績系列で作ると、同じ日について画面に
 * 2つの残高が出る。まだ実績が入っていない予定は `planCount` で数えて
 * 分かるようにする ―― 出納帳には無い行なので、そこが差の理由になる。
 */
export function buildAccountDaily({
  series,
  accounts,
  accountId,
  from,
  to,
}: AccountDailyInput): AccountDaily {
  /* 振替が閉じるかの判定に使う集合。**系列が合計に使ったものと同じ**
     ものを使う（`lib/ledger` と同じ理由）*/
  const deposits = new Set(depositIdsOf(series));

  const inRange = series.rows.filter((row) => row.date >= from && row.date <= to);
  const first = inRange[0];
  const last = inRange.at(-1);
  if (!first || !last) {
    const flat = balanceAt(series, accountId, from) ?? 0;
    return { rows: [], opening: flat, closing: flat, total: 0, gap: 0 };
  }

  /* 期首残高。**前日の終値。** 前日が系列に無い（`from` が基準日）なら、
     その口座の基準日残高 ―― CL-3 手順1 の入力値そのもので、
     **増減からは作らない。** 増減から作ると、下の `gap` が常に0になる */
  const before = series.rows.filter((row) => row.date < from).at(-1);
  const opening =
    before?.byAccount[accountId] ??
    accounts.find((a) => a.id === accountId)?.balance ??
    0;
  const closing = last.byAccount[accountId] ?? 0;

  /* 日ごとにまとめる。**その口座に関わる行だけ**（`touchesAccount`） */
  const byDate = new Map<DateStr, { delta: Yen; count: number; planCount: number }>();
  for (const event of series.projectedCash) {
    /* **期間で絞らない。** 下の行の組み立てが `inRange`（系列の行）を
       回すので、範囲の外の日はそもそも読まれない。ここにも書くと
       **死んだ番人**になる ―― 外しても何も落ちない条件を「守っている」
       と読まれる（`detectColumns` で一度やった。§2.11） */
    if (!touchesAccount(event, accountId)) continue;
    let day = byDate.get(event.date);
    if (!day) {
      day = { delta: 0, count: 0, planCount: 0 };
      byDate.set(event.date, day);
    }
    day.delta += accountDelta(event, accountId, deposits);
    day.count++;
    if (event.src !== "actual") day.planCount++;
  }

  const rows: AccountDailyRow[] = [];
  let total = 0;
  for (const row of inRange) {
    const day = byDate.get(row.date);
    if (!day) continue;
    total += day.delta;
    rows.push({
      date: row.date,
      delta: day.delta,
      balance: row.byAccount[accountId] ?? 0,
      count: day.count,
      planCount: day.planCount,
    });
  }

  return { rows, opening, closing, total, gap: total - (closing - opening) };
}

/** その日の終値。無ければ null */
function balanceAt(
  series: BalanceSeries,
  accountId: string,
  date: DateStr,
): Yen | null {
  const row = series.rows.find((r) => r.date === date);
  return row ? (row.byAccount[accountId] ?? 0) : null;
}
