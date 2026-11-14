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
 *
 * ## 実績だけで見る（FR-66・AC-75）
 *
 * 既定は予測系列である（AC-49a）。**切り替えると、行は実績だけになり、
 * 累計も実績だけから積む。** 出納帳には予定の行が無いので、1行ずつ
 * 突き合わせるにはこちらが要る。
 *
 * **その累計を「残高」と呼ばない**（AC-75）。残高は予測系列から取ると
 * 決めてあり、実績系列から別の「残高」を出すと**同じ日について画面に
 * 2つの残高が出る**（AC-49c）。画面の語は `source` から引くこと。
 *
 * **そのとき `gap` は必ず0になる。** 累計を行から積んでいるので、
 * 「期末 − 期首」は増減の合計と一致するしかない（§2.11 の4つ目の形）。
 * **確かめになっていないので、画面にも出さない** ―― 出すと、必ず合う式を
 * 「合っている」と読むことになる。
 */

import { accountDelta, depositIdsOf, type BalanceSeries } from "./balance";
import { touchesAccount } from "./types";
import type { Account, DateStr, Yen } from "./types";

/** 1日ぶん。**その口座を動かした行が1件も無い日は作らない。** */
export interface AccountDailyRow {
  date: DateStr;
  /** その日の増減（符号付き）。**その日の行から足す** */
  delta: Yen;
  /**
   * その日の終わりの累計。
   *
   * | `source` | 中身 |
   * |---|---|
   * | `projected` | **その口座の残高。系列から取る**（`byAccount`） |
   * | `actual` | **実績だけの累計。** 残高ではない（AC-75） |
   *
   * **`balance` という名前にしない。** 実績だけのときは残高ではないので、
   * その名前で持つと、次に読む人が画面に「残高」と出す（§2.12）。
   * 画面の語は `AccountDaily.source` から引く。
   */
  running: Yen;
  /**
   * その日にこの口座に関わる行の件数。
   *
   * **増減が0でも出す。** 反映していない振替（振替先が未設定・カード）は
   * 明細に在るのに残高を動かさないので、件数が無いと「この日は何も無い」
   * と読まれる（`oneSidedReason`）。
   */
  count: number;
  /** そのうち、まだ実績が入っていない予定の件数。実績だけのときは常に0 */
  planCount: number;
}

export interface AccountDaily {
  rows: AccountDailyRow[];
  /** どの系列から作ったか。**画面の語はここから引く**（AC-75） */
  source: AccountDailySource;
  /**
   * 期首の値（`from` の前日の終値。`from` が基準日ならその口座の基準日残高）。
   *
   * 実績だけのときは**実績だけの累計**である（残高ではない）。
   */
  opening: Yen;
  /** 期末の値（`to` の終値）。実績だけのときは実績だけの累計 */
  closing: Yen;
  /** 増減の合計。**行から足したもの**（残高の差ではない） */
  total: Yen;
  /**
   * AC-71 の留め具。`total − (closing − opening)`。
   *
   * **0 でなければ、どこかの行を二重に数えているか落としている。**
   * 画面に出す（黙って合わせない ―― 合わせると、ずれていることが
   * 分からなくなる）。
   *
   * **実績だけのときは必ず0である**（累計を行から積んでいるため）。
   * 留め具になっていないので、画面にも出さない（AC-75）。
   */
  gap: Yen;
}

/** どの系列から作るか（FR-66・AC-75）。既定は予測（AC-49a） */
export type AccountDailySource = "projected" | "actual";

export interface AccountDailyInput {
  /** CL-3 の出力。**予測系列を使う**（AC-49a） */
  series: BalanceSeries;
  /** 基準日残高を引くために要る（`from` が基準日のとき） */
  accounts: readonly Account[];
  accountId: string;
  /** 両端を含む */
  from: DateStr;
  to: DateStr;
  /**
   * **既定は予測系列**（AC-75：既定はこの切り替えが入っていない状態）。
   *
   * 既定を変えると、ダッシュボードの残高とこの表が既定どうしで食い違う。
   */
  source?: AccountDailySource;
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
  source = "projected",
}: AccountDailyInput): AccountDaily {
  const actualOnly = source === "actual";
  /* 振替が閉じるかの判定に使う集合。**系列が合計に使ったものと同じ**
     ものを使う（`lib/ledger` と同じ理由）*/
  const deposits = new Set(depositIdsOf(series));

  const inRange = series.rows.filter((row) => row.date >= from && row.date <= to);
  const first = inRange[0];
  const last = inRange.at(-1);
  if (!first || !last) {
    const flat = actualOnly
      ? (accounts.find((a) => a.id === accountId)?.balance ?? 0)
      : (balanceAt(series, accountId, from) ?? 0);
    return { rows: [], source, opening: flat, closing: flat, total: 0, gap: 0 };
  }

  const baseBalance = accounts.find((a) => a.id === accountId)?.balance ?? 0;

  /* 日ごとにまとめる。**その口座に関わる行だけ**（`touchesAccount`） */
  const byDate = new Map<DateStr, { delta: Yen; count: number; planCount: number }>();
  for (const event of actualOnly ? series.actualCash : series.projectedCash) {
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
    /* **実績系列には予定が無い**（AC-75）。実績だけのときに `src` が
       `actual` でないのは**カードの引落**（CL-2 の生成物）だけで、
       あれは予定ではない ―― 基準日の未払や記録した利用が引き落とされる
       日である。「予定1件」と出すと、出納帳に在る行を「まだ記録して
       いない」と読ませる（2026-11-15 に実機で見つけた） */
    if (!actualOnly && event.src !== "actual") day.planCount++;
  }

  /* 期首の値。**前日の終値。** 前日が系列に無い（`from` が基準日）なら、
     その口座の基準日残高 ―― CL-3 手順1 の入力値そのもので、
     **増減からは作らない。** 増減から作ると、下の `gap` が常に0になる。

     **実績だけのときは積むしかない。** 系列は口座別の実績残高を持って
     いない（`byAccount` は予測系列。`act` は範囲の合計で、範囲が
     この口座と同じとは限らない）。**だから `gap` はそのとき必ず0に
     なる** ―― 画面にも出さない（AC-75） */
  const before = series.rows.filter((row) => row.date < from).at(-1);
  const opening = actualOnly
    ? baseBalance + sumBefore(byDate, series.rows[0]?.date ?? from, from)
    : (before?.byAccount[accountId] ?? baseBalance);

  const rows: AccountDailyRow[] = [];
  let total = 0;
  let running = opening;
  for (const row of inRange) {
    const day = byDate.get(row.date);
    if (!day) continue;
    total += day.delta;
    running += day.delta;
    rows.push({
      date: row.date,
      delta: day.delta,
      /* 予測は系列から取る（独立した2つの値を突き合わせるため。AC-71）。
         実績だけのときは積んだ値そのもの */
      running: actualOnly ? running : (row.byAccount[accountId] ?? 0),
      count: day.count,
      planCount: day.planCount,
    });
  }

  const closing = actualOnly ? opening + total : (last.byAccount[accountId] ?? 0);

  return {
    rows,
    source,
    opening,
    closing,
    total,
    gap: total - (closing - opening),
  };
}

/**
 * 系列の始まりから `from` の前日までの増減（実績だけのときの期首）。
 *
 * **系列より前の行は数えない。** CL-3 も基準日より前のイベントを
 * 落としている（行が基準日から始まるため）。ここで数えると、画面の
 * 期首が CL-3 の基準日残高と食い違う。
 */
function sumBefore(
  byDate: ReadonlyMap<DateStr, { delta: Yen }>,
  start: DateStr,
  from: DateStr,
): Yen {
  let sum = 0;
  for (const [date, day] of byDate) {
    if (date >= start && date < from) sum += day.delta;
  }
  return sum;
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
