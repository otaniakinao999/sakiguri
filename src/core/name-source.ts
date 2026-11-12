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
  /** 絶対値 */
  amount: Yen;
  /** 店名。空のこともある（11月の実データで7件） */
  name: string;
}

/**
 * 日付のずれをどこまで許すか（AC-69）。
 *
 * 実データでは同日・同額が162件中145件、**±3日まで広げると157件**になった。
 * 残り5件は外貨取引で、金額が手数料ぶん違う（下）。
 */
export const NAME_SOURCE_DAYS = 3;

/**
 * 海外事務手数料ぶんの差をどこまで許すか（AC-69）。
 *
 * 実データ：FIGMA の利用が明細では 3,134円、銀行では 3,212円。差は78円で
 * **2.49%** である。
 *
 * **上限だけでなく下限も置く。** 上限だけだと、大きな金額では窓が広く
 * （200,000円なら1万円まで）、**無関係な額に当たりうる。** 手数料として
 * ありうる帯（0.5%〜5%）に収めると、たまたま当たる余地がほとんど無くなる。
 *
 * **この2つの数字は仕様に書かれていない。** 実データの2.49%が入る帯として
 * こちらで決めた値である。
 */
export const FEE_MIN_PERMILLE = 5; // 0.5%
export const FEE_MAX_PERCENT = 5;

/**
 * デビット明細を読む。**日付と金額と店名だけ。**
 *
 * 向きの列は読まない ―― デビット明細は利用（出金）の一覧なので、向きを
 * 読んでも常に同じになる。**当てる相手も出金の行に限る**（`applyNameSource`）。
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
  const out: NameSourceEntry[] = [];

  for (const cells of body) {
    const date = normalizeDate(cells[mapping.date] ?? "");
    if (!date) continue;

    const amount = readAmount(cells, mapping);
    if (amount === null || amount === 0) continue;

    out.push({
      date,
      amount: Math.abs(amount),
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

/** 当たりの厳しさ。前のほうが厳しい */
const TIERS = [
  { days: 0, fee: false },
  { days: NAME_SOURCE_DAYS, fee: false },
  { days: 0, fee: true },
  { days: NAME_SOURCE_DAYS, fee: true },
] as const;

/** 手数料ぶんの差として認められるか */
function feeFits(rowAmount: Yen, entryAmount: Yen): boolean {
  const fee = rowAmount - entryAmount;
  if (fee <= 0) return false;
  if (fee * 100 > entryAmount * FEE_MAX_PERCENT) return false;
  return fee * 1000 >= entryAmount * FEE_MIN_PERMILLE;
}

function hits(
  row: Pick<ImportRow, "date" | "amount">,
  entry: NameSourceEntry,
  tier: (typeof TIERS)[number],
): boolean {
  if (daysBetween(row.date, entry.date) > tier.days) return false;
  return tier.fee ? feeFits(row.amount, entry.amount) : row.amount === entry.amount;
}

/**
 * 銀行明細の摘要を、デビット明細の店名に差し替える（FR-62・AC-69）。
 *
 * **行数を変えない。** 返すのは渡された行と同じ並び・同じ件数である。
 *
 * **出金の行だけに当てる。** デビット明細は利用の一覧で、向きを持たない。
 * 入金の行にも当てると、同額の返金や振込に店名が付く。
 */
export function applyNameSource(
  rows: readonly ImportRow[],
  source: readonly NameSourceEntry[],
): ImportRow[] {
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

  return rows.map((row) => {
    const name = picked.get(row.rowIndex);
    if (name === undefined) return row;
    /* **原文は触らない**（FR-58）。書き換えると次回当たらなくなる */
    return { ...row, name, nameFrom: "source" as const };
  });
}
