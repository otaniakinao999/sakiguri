/**
 * 別の明細を摘要の出どころとして読む（FR-62・AC-69）
 *
 * 一次情報：docs/要件定義書.md FR-62・AC-69・§5 制約10
 *
 * ## なぜ要るか
 *
 * **同じ取引が2つの明細に出る口座がある。** ドコモSMTBネット銀行では、普通
 * 預金の明細にデビット利用が「デビット　４１２６６９」という**取引ごとに違う
 * 番号**で出る。店名は別のデビット明細にある。
 *
 * 2026年10月の実データで、銀行明細232行のうち**162行がこの形**だった。
 * 番号は毎回違うので、**費目の推定も仕分けルールも当たらない**（当てる文字列が
 * 無い）。
 *
 * ## 行を増やさない
 *
 * **両方のCSVを行として取り込むと、同じ取引が二重に入る**（AC-69）。だから
 * デビット明細は**行ではなく摘要の出どころ**として扱う。`applyNameSource` は
 * 行数を変えない ―― 渡された行をそのまま返し、`name` だけを差し替える。
 *
 * ## 当たらなかった行は触らない
 *
 * **勝手に近いものへ当てない**（AC-69）。当たりの条件を厳しい順に試し、
 * 1件ずつ使い切る。同じ厳しさで**違う店名の候補が2つ以上あるときは当てない**
 * ―― どちらか選ぶと、間違えたほうが黙って入る。
 *
 * ## 原文は触らない
 *
 * 差し替えるのは表示名（`name`）だけで、**原文（`sourceName`）はCSVから読んだ
 * ままにする**（FR-58）。書き換えると、次に同じ銀行明細を読んだときに重複
 * 判定が当たらなくなる。
 *
 * ## 仕分けルールの置き換えとぶつかったら、どちらも入れない
 *
 * 摘要を書き換える機構は2つある ―― この店名の差し替え（FR-62）と、仕分け
 * ルールの置き換え（FR-59）である。**同じ行に両方が当たって違う名前を
 * 言っているとき、どちらも入れない。** 表示名は原文のままにして、確認画面に
 * 両方を出し、利用者が選ぶ（CLAUDE.md §2.9・2026-11-12 の決定）。
 *
 * **機械が選ぶと、間違えたほうが黙って入る。** どちらが正しいかは取引ごとに
 * 違うので、優先順位を決めても半分は外れる。
 *
 * 同じ名前を言っているときはぶつかりではない（どちらを採っても同じ）。
 */

import {
  normalizeAmount,
  normalizeDate,
  type ColumnMapping,
  type ImportRow,
} from "./csv";
import { daysBetween } from "./date";
import type { DateStr, Yen } from "./types";

/** デビット明細の1行。**向きは持たない**（利用＝出金として扱う） */
export interface NameSourceEntry {
  date: DateStr;
  /**
   * **銀行の明細に出る額**（AC-69）。絶対値。
   *
   * お取引金額に、**明細が持っている手数料の列を足したもの**である ――
   * 事務手数料・ATM手数料・海外事務手数料。外貨の利用は、銀行側に
   * 手数料込みの額で出る。
   *
   * **割合で推測しない。** 足す数字は明細に書かれている。実データ：
   *
   * ```
   * +435円   17,421 → 17,856   ANTHROPIC* CLAUDE SUB
   * + 78円    3,134 →  3,212   FIGMA
   * + 87円    3,486 →  3,573   OPENAI *CHATGPT SUBSCR
   * + 63円    2,531 →  2,594   MONTHLY
   * ```
   */
  amount: Yen;
  /** 店名。空のこともある（11月の実データで7件） */
  name: string;
}

/**
 * 日付のずれをどこまで許すか（AC-69）。
 *
 * 実データでは同日・同額が161件中145件、**±3日まで広げると157件**になった。
 */
export const NAME_SOURCE_DAYS = 3;

/**
 * 手数料の列（AC-69）。**見出しに「手数料」が入っている列を全部足す。**
 *
 * 実データの列は `事務手数料`・`ATM手数料`・`海外事務手数料` の3つだが、
 * **名前を3つ並べない。** 並べると、別の明細に4つめがあったときに漏れる
 * （CLAUDE.md §2.8 の列挙）。「手数料」を含む列、という規則にしておけば
 * 増えても拾える。
 */
const FEE_HEADER = /手数料/;

/**
 * 手数料の列を探す（AC-69）。
 *
 * **ほかの役に割り当たっている列は外す。** 「ご利用金額（手数料込）」の
 * ような見出しがあると、**金額の列を自分自身に足してしまう。**
 *
 * **見出しが無い明細では見つけられない**（`hasHeader` が false）。その場合は
 * 手数料を足さない ―― 列の意味が分からないまま数を足すほうが危ない。
 */
function feeColumns(head: readonly string[], mapping: ColumnMapping): number[] {
  if (!mapping.hasHeader) return [];
  const taken = new Set(
    [
      mapping.date,
      mapping.name,
      mapping.amount,
      mapping.inflow,
      mapping.outflow,
      mapping.balance,
    ].filter((i) => i >= 0),
  );
  return head
    .map((cell, i) => (!taken.has(i) && FEE_HEADER.test(String(cell)) ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * デビット明細を読む。**日付と金額と店名だけ。**
 *
 * 向きの列は読まない ―― デビット明細は利用（出金）の一覧なので、向きを
 * 読んでも常に同じになる。**当てる相手も出金の行に限る**（`applyNameSource`）。
 *
 * **金額には手数料の列を足す**（AC-69）。外貨の利用は、銀行側に手数料込みの
 * 額で出る。**割合で推測しない** ―― 足す数字は明細に書かれている。
 *
 * **店名が空の行も残す。** 落とすと、その取引に当たるはずだった銀行の行が
 * **別の店名に当たりうる。** 残しておけば枠を使って止められる。当たった
 * 相手の店名が空なら、摘要は差し替えない（AC-69）。
 */
export function buildNameSource(
  rows: readonly string[][],
  mapping: ColumnMapping,
): NameSourceEntry[] {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const fees = feeColumns(rows[0] ?? [], mapping);
  const out: NameSourceEntry[] = [];

  for (const cells of body) {
    const date = normalizeDate(cells[mapping.date] ?? "");
    if (!date) continue;

    const amount = readAmount(cells, mapping);
    if (amount === null || amount === 0) continue;

    /* **手数料は足す側。** 符号の書き方は明細によるので絶対値で足す */
    const fee = fees.reduce(
      (sum, column) => sum + Math.abs(normalizeAmount(cells[column] ?? "") ?? 0),
      0,
    );

    out.push({
      date,
      amount: Math.abs(amount) + fee,
      name: mapping.name >= 0 ? String(cells[mapping.name] ?? "").trim() : "",
    });
  }

  return out;
}

/** 入金・出金・1列のどれでも、絶対値として読む */
function readAmount(cells: readonly string[], mapping: ColumnMapping): Yen | null {
  for (const column of [mapping.amount, mapping.outflow, mapping.inflow]) {
    if (column < 0) continue;
    const value = normalizeAmount(cells[column] ?? "");
    if (value !== null && value !== 0) return value;
  }
  return null;
}

/**
 * 当たりの厳しさ。前のほうが厳しい。
 *
 * **金額は常に完全一致。** 手数料は明細の列から足してあるので（`amount`）、
 * **割合の帯は置かない** ―― 0.5%〜5% のような帯を置くと、200,000円の行に
 * 1万円ずれた相手が当たる（AC-69）。
 */
const TIERS = [{ days: 0 }, { days: NAME_SOURCE_DAYS }] as const;

function hits(
  row: Pick<ImportRow, "date" | "amount">,
  entry: NameSourceEntry,
  tier: (typeof TIERS)[number],
): boolean {
  if (daysBetween(row.date, entry.date) > tier.days) return false;
  return row.amount === entry.amount;
}

/**
 * `applyNameSource` の結果（AC-69）。
 *
 * **件数を2つ返す。** 画面に1つの数字しか出せないと、どちらに寄せても
 * 嘘になる（§2.12）。
 *
 * | 出す数 | 起きること |
 * |---|---|
 * | 当たった件数（61） | **画面で変わった行は54なので、数字と画面が合わない** |
 * | 置き換えた件数（54） | **当たっている7行が、当たらなかったように見える** |
 *
 * 記帳代行では、「当たらなかった」は**別のところを探せ**、「当たったが
 * 明細に名前が無い」は**探しても無い**である。区別が無いと、毎月その
 * 件数ぶん無駄に探すことになる。
 */
export interface NameSourceResult {
  /** 差し替えたあとの行。**件数も並びも渡したときのまま** */
  rows: ImportRow[];
  /** 摘要を店名に置き換えた行の数 */
  replaced: number;
  /**
   * **相手は決まったが、明細に店名が無かった行の数。**
   *
   * その行は番号のまま残る。「当たらなかった」とは別物である ――
   * 探しても店名は無い。
   */
  noName: number;
}

/**
 * 銀行明細の摘要を、デビット明細の店名に差し替える（FR-62・AC-69）。
 *
 * **行数を変えない。** 返すのは渡された行と同じ並び・同じ件数である。
 *
 * **出金の行だけに当てる。** デビット明細は利用の一覧で、向きを持たない。
 * 入金の行にも当てると、同額の返金や振込に店名が付く。
 *
 * **件数を2つ返す**（`NameSourceResult`）。数えるのは**この1回の
 * 突き合わせそのもの**である ―― あとから結果の行を数え直すと、「当たった
 * が店名が空だった行」は触っていない行と見分けが付かない（§2.8）。
 */
export function applyNameSource(
  rows: readonly ImportRow[],
  source: readonly NameSourceEntry[],
): NameSourceResult {
  /** まだ使っていない出どころ */
  const left = source.map((entry) => ({ entry, used: false }));
  /** 行番号 → 差し替える店名 */
  const picked = new Map<number, string>();
  /**
   * 相手が決まった行。
   *
   * **`picked` とは別に持つ。** 店名が空の相手に当たった行は `picked` に
   * 入らないが、**相手は決まっている。** `picked` だけで見ていると、
   * 次の（ゆるい）段でもう一度相手を探し、**別の店名に当たってしまう。**
   */
  const settled = new Set<number>();

  for (const tier of TIERS) {
    for (const row of rows) {
      if (settled.has(row.rowIndex)) continue;
      if (row.type !== "expense") continue;

      const candidates = left.filter((c) => !c.used && hits(row, c.entry, tier));
      if (candidates.length === 0) continue;

      /* **違う店名の候補が2つ以上あるときは当てない**（AC-69）。
         同じ店名が並ぶのは入れ替えても同じなので当ててよい */
      const names = new Set(candidates.map((c) => c.entry.name));
      if (names.size > 1) continue;

      const chosen = candidates[0];
      chosen.used = true;
      settled.add(row.rowIndex);
      /* **空欄の店名で上書きしない**（AC-69）。枠は使う ―― この取引の
         相手はこれだと分かっているので、ほかの店名に当てさせない */
      if (chosen.entry.name !== "") picked.set(row.rowIndex, chosen.entry.name);
    }
  }

  const out = rows.map((row) => {
    const name = picked.get(row.rowIndex);
    if (name === undefined) return row;

    /* **仕分けルールの置き換えとぶつかったら、どちらも入れない**（§2.9）。
       表示名を原文に戻し、両方を確認画面に出す */
    if (row.nameFrom === "rule" && row.name !== name) {
      return {
        ...row,
        name: row.sourceName,
        nameFrom: null,
        nameConflict: { rule: row.name, source: name },
      };
    }

    /* **原文は触らない**（FR-58）。書き換えると次回当たらなくなる */
    return { ...row, name, nameFrom: "source" as const };
  });

  return {
    rows: out,
    /* **結果の行から数える。** ルールの置き換えとぶつかった行は
       差し替えていないので、`picked` の数ではなく出来上がりを見る */
    replaced: out.filter((row) => row.nameFrom === "source").length,
    /* 相手は決まったが店名が空だった行。`settled` と `picked` の差 */
    noName: [...settled].filter((rowIndex) => !picked.has(rowIndex)).length,
  };
}
