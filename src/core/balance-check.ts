/**
 * 取込の結果を残高で検算する（FR-61・AC-68）
 *
 * 一次情報：docs/要件定義書.md FR-61・AC-68・§5 制約10
 *
 * **判定を完璧にするのではなく、結果を検算する。**
 *
 * 内容の突き合わせ（FR-50 の重複判定）は原理的に完全にできない。
 * 同じ日・同じ額・同じ摘要の行が実在するためである（2026年10月の実データで
 * 232行のうち18行、6組）。鍵に足せる項目はもう無い。4件のうち3件が登録済み
 * なら、次に読んだとき残るのは1件で、それが**正しい1件かどうかは判定では
 * 決められない。**
 *
 * 一方で、銀行の明細には**残高の列**がある。これは取引の列挙とは独立に
 * 「この時点でいくらだったか」を言っているので、**取り落としと二重計上を
 * 額で検出できる。** 実データでは残高の鎖が10月231/231・11月74/74で繋がって
 * いた。
 *
 * ## 何と何を比べるか
 *
 * **比べるのは、この明細の範囲の中だけで完結する2つの値である。**
 *
 *   CSV が言う期末残高                       … 末尾行の残高
 *   期首残高 ＋ こちらが記録している増減     … 先頭行の残高 − 先頭行の増減 ＋ Σ
 *
 * **アプリ側の「現在の残高」を持ち出さない。** 基準日残高（`account.balance`）
 * から足し上げた値と比べると、ずれたときに「取込が落ちた」のか「基準日残高が
 * 違う」のかが分からなくなる。さらに、同じ「残高」が画面の2箇所から別の計算で
 * 出ることになる（CLAUDE.md §2.12）。期首を明細の中から採れば、測っているのは
 * **「この明細に書かれた増減を、こちらが全部ちょうど1回ずつ記録できたか」**
 * だけになる。
 *
 * ## 純関数
 *
 * `core` の規約どおり、入力を渡すと同じ出力が返る（CLAUDE.md §2.3）。
 * 現在日時も DOM も見ない。
 */

import { accountDelta } from "./balance";
import { actualFromImportRow, type ImportRow } from "./csv";
import { compareDate } from "./date";
import type { DateStr, EntryType, Yen } from "./types";

/** 検算に要る、CSVの1行ぶん。`ImportRow` をそのまま渡せる。 */
export interface BalanceCheckRow {
  date: DateStr;
  /** 絶対値 */
  amount: Yen;
  type: EntryType;
  /** その行の時点の残高。列が無ければ null */
  balance: Yen | null;
}

/** 検算に要る、実績1件ぶん。`Actual` をそのまま渡せる。 */
export interface BalanceCheckActual {
  date: DateStr;
  amount: Yen;
  type: EntryType;
  accountId: string;
  toAccountId?: string;
}

export interface CheckBalanceInput {
  /**
   * **明細の全行。取込から外した行も含める。**
   *
   * 残高の鎖は明細そのものの性質で、こちらが取り込むかどうかとは関係が
   * ない。含めないと、外した行のぶんだけ鎖が切れて毎回 `broken` になる。
   */
  rows: readonly BalanceCheckRow[];
  /**
   * **取込後にその口座に在ることになる実績。**
   *
   * 確認画面では「保存済み ＋ これから入れるぶん」を渡す。登録したあとは
   * 保存済みがそれを含むので、同じ関数に同じ値が入り、**出る数字も同じに
   * なる**（画面に出す前と後で違う額が出ない）。
   *
   * 口座での絞り込みはここでやるので全件そのまま渡してよい。
   */
  actuals: readonly BalanceCheckActual[];
  /** 取り込む先の口座 */
  accountId: string;
  /**
   * 現預金の口座の集合。`accountDelta` が「振替が閉じるか」を見る。
   *
   * **残高の向きは `accountDelta` から引く**（CLAUDE.md §2.8）。閉じない
   * 振替（振替先が未設定・振替先がカード）は `accountDelta` が0にするので、
   * ここでも差として現れる。**出すのが正しい** ―― 明細は動いたと言っていて、
   * こちらの残高は動いていないのだから、残高は本当にずれている。
   */
  deposits: ReadonlySet<string>;
}

export type BalanceCheck =
  /** 残高の列が無い。**何も出さない**（AC-68） */
  | { status: "noColumn" }
  /**
   * 残高の鎖が繋がらない。
   *
   * 読み飛ばした行があるか（日付が読めない行）、列の割り当てが違うか、
   * 明細そのものが連続していない。**差額を出さない** ―― 繋がっていない
   * 残高から引いた差は、取込の良し悪しを表していない。
   */
  | { status: "broken" }
  | {
      /** 一致した */
      status: "ok";
      from: DateStr;
      to: DateStr;
      /** CSVが言う期末残高 */
      expected: Yen;
      /** 期首 ＋ こちらが記録している増減 */
      recorded: Yen;
    }
  | {
      /** 一致しない */
      status: "differs";
      from: DateStr;
      to: DateStr;
      expected: Yen;
      recorded: Yen;
      /**
       * `recorded − expected`。
       *
       * **正なら二重計上、負なら取り落とし。** 向きを逆にすると、
       * 画面の文言と符号が合わなくなる。
       */
      diff: Yen;
    };

/** 1行が残高を動かす額。入金が正。 */
function rowDelta(row: BalanceCheckRow): Yen {
  return row.type === "income" ? row.amount : -row.amount;
}

/**
 * 残高の鎖から期首と期末を採る。繋がっていなければ null。
 *
 * **並びの向きを決めつけない。** 実データ（ドコモSMTBネット銀行）は
 * **新しい行が先**で、「末尾の残高 ＋ 増減の合計 ＝ 先頭の残高」が成り立つ。
 * 古い行が先の明細もある。どちらで繋がるかを試して、繋がった側を採る。
 *
 * 1行しか無いときはどちらでも同じ（期首 = 残高 − 増減、期末 = 残高）。
 */
function chain(
  rows: readonly { balance: Yen; delta: Yen }[],
): { opening: Yen; closing: Yen } | null {
  const n = rows.length;
  if (n === 0) return null;

  /* 古い行が先：b[i] = b[i-1] + d[i] */
  let ascending = true;
  for (let i = 1; i < n; i += 1) {
    if (rows[i].balance - rows[i - 1].balance !== rows[i].delta) {
      ascending = false;
      break;
    }
  }
  if (ascending) {
    return { opening: rows[0].balance - rows[0].delta, closing: rows[n - 1].balance };
  }

  /* 新しい行が先：b[i-1] = b[i] + d[i-1] */
  for (let i = 1; i < n; i += 1) {
    if (rows[i - 1].balance - rows[i].balance !== rows[i - 1].delta) return null;
  }
  return { opening: rows[n - 1].balance - rows[n - 1].delta, closing: rows[0].balance };
}

/**
 * 取込の結果を残高で検算する（FR-61・AC-68）。
 *
 * **残高の列が無ければ `noColumn` を返し、画面は何も出さない。**
 * 鎖が繋がらなければ `broken`。どちらの場合も差額を作らない。
 */
export function checkBalance(input: CheckBalanceInput): BalanceCheck {
  const { rows, actuals, accountId, deposits } = input;

  if (rows.length === 0) return { status: "noColumn" };
  /* **1行でも残高が無ければ検算しない。** 欠けた行をまたいで鎖を繋ぐと、
     欠けた行ぶんの増減が「こちらの取り落とし」として出る */
  if (rows.some((row) => row.balance === null)) return { status: "noColumn" };

  const ends = chain(
    rows.map((row) => ({ balance: row.balance as Yen, delta: rowDelta(row) })),
  );
  if (!ends) return { status: "broken" };

  /* **範囲は明細の日付そのものから採る**（並びの向きに頼らない）。
     引き算の両辺を同じ範囲から取るため（CLAUDE.md §2.10） */
  const dates = rows.map((row) => row.date).sort(compareDate);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const movement = actuals.reduce((sum, actual) => {
    if (compareDate(actual.date, from) < 0) return sum;
    if (compareDate(actual.date, to) > 0) return sum;
    return sum + accountDelta(actual, accountId, deposits);
  }, 0);

  const recorded = ends.opening + movement;
  const expected = ends.closing;
  const diff = recorded - expected;

  return diff === 0
    ? { status: "ok", from, to, expected, recorded }
    : { status: "differs", from, to, expected, recorded, diff };
}

/**
 * 取込の確認画面から検算する（FR-61・AC-68）。
 *
 * **「取込後にこの口座に在ることになる実績」の組み立てはここだけが持つ**
 * （CLAUDE.md §2.8）。保存済みの全件と、取込のチェックが入っている行である。
 *
 * 本番の画面（`ImportScreen`）と開発用の画面（`dev/screens/import-wired`）の
 * 両方がこれを呼ぶ。**写し取ると、本番を直したときに開発用の画面が古いまま
 * 動き、本番と違うものを確かめることになる。**
 */
export function checkImportBalance(input: {
  /** 確認画面の全行（取込から外した行も含む） */
  rows: readonly ImportRow[];
  /** 既に保存されている実績。口座での絞り込みは中でやるので全件渡してよい */
  existing: readonly BalanceCheckActual[];
  accountId: string;
  deposits: ReadonlySet<string>;
}): BalanceCheck {
  return checkBalance({
    rows: input.rows,
    actuals: [
      ...input.existing,
      /* 取込行から実績への変換は `actualFromImportRow` が1箇所で持つ。
         `id` は検算では読まないので空で渡す */
      ...input.rows
        .filter((row) => row.include)
        .map((row) => actualFromImportRow(row, "")),
    ],
    accountId: input.accountId,
    deposits: input.deposits,
  });
}
