/**
 * 費目マスタ
 *
 * 一次情報：docs/要件定義書.md §3.1.2
 *
 * **この表が唯一の定義である。** 費目はコードで保持し、集計もコードで行う。
 * 表示名は将来変更されうるため、名称で突き合わせない。
 *
 * 注意（§3.1.2 グループ構成）：
 *   グループ TRF（資金移動）は**損益に計上しない**。CL-5 は group = TRF を
 *   除外する。CL-3 の現金計算には含める。
 *   これは借入金の元金返済（TRF-06）を損益に出さないために必要な区別であり、
 *   「収入／固定費／変動費」の3分類では表現できなかったもの。
 *
 * 注意（§3.1.2 適用規則1）：
 *   **費目と固定／変動は独立した属性である。** `recommendedCostType` は
 *   新規登録時の初期値にすぎない。同一の費目が固定費と変動費の両方に
 *   出現しうる（AC-18）。費目から固定／変動を決めてはならない。
 *
 * 注意（§3.1.2 適用規則7）：
 *   **このマスタは事業割合（bizRatio）を持たない。全費目の初期値は 0。**
 *   固定／変動には推奨値があるのに事業割合には無いのは、非対称だが意図的
 *   である。固定／変動は費目の性質でほぼ決まる（食費は変動、家賃は固定）
 *   のに対し、事業割合を決めているのは費目ではなく**利用者の事業形態**
 *   だからである。同じ通信費でも専業なら80%、副業なら20%になる。
 *   マスタに持たせると全員に同じ値を押し付けることになる。
 *   **揃えるために bizRatio を足さないこと。**
 *   費目ごとの推奨値をオンボーディングで当てる案は v1.5 の検討事項（OI-14）。
 */

import type { CostType } from "./types";

/** 費目のグループ。TRF は損益に計上しない。 */
export type CategoryGroup = "INC" | "EXP" | "TRF";

export interface Category {
  code: string;
  name: string;
  group: CategoryGroup;
  /**
   * 新規登録時の固定／変動の初期値（EXP のみ）。
   * **利用者が変更できる。費目が固定／変動を決めるのではない。**
   */
  recommendedCostType?: CostType;
  /** 青色申告決算書の科目。対応がないものは undefined */
  taxFormAccount?: string;
  /** システムが生成する費目。利用者は作成・編集できない */
  generated?: true;
}

/**
 * 費目マスタ。**掲載順が表示順**（§3.1.2 適用規則2・3）。
 * 金額の大小で並べ替えない。
 */
export const CATEGORIES: readonly Category[] = [
  /* ---------- 収入（INC） ---------- */
  { code: "INC-01", name: "事業売上", group: "INC", taxFormAccount: "売上（収入）金額" },
  { code: "INC-02", name: "雑収入", group: "INC", taxFormAccount: "雑収入" },
  { code: "INC-03", name: "給与・報酬", group: "INC" },
  { code: "INC-04", name: "年金", group: "INC" },
  { code: "INC-05", name: "配当・利息", group: "INC" },
  { code: "INC-06", name: "補助金・助成金", group: "INC", taxFormAccount: "雑収入" },
  { code: "INC-07", name: "その他収入", group: "INC" },

  /* ---------- 費用（EXP） ----------
     EXP-01〜EXP-20 は青色申告決算書の科目に対応する。
     EXP-21 以降は家計固有で、通常は事業経費にならない。
     EXP-14 租税公課（印紙税・固定資産税など）と
     EXP-28 税金（所得税・住民税）は別物。後者は経費にならない。 */
  { code: "EXP-01", name: "地代家賃・住居費", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "地代家賃" },
  { code: "EXP-02", name: "水道光熱費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "水道光熱費" },
  { code: "EXP-03", name: "通信費", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "通信費" },
  { code: "EXP-04", name: "旅費交通費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "旅費交通費" },
  { code: "EXP-05", name: "接待交際費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "接待交際費" },
  { code: "EXP-06", name: "広告宣伝費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "広告宣伝費" },
  { code: "EXP-07", name: "消耗品費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "消耗品費" },
  { code: "EXP-08", name: "事務用品費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "消耗品費" },
  { code: "EXP-09", name: "外注工賃", group: "EXP", recommendedCostType: "variable", taxFormAccount: "外注工賃" },
  { code: "EXP-10", name: "給料賃金", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "給料賃金" },
  { code: "EXP-11", name: "福利厚生費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "福利厚生費" },
  { code: "EXP-12", name: "損害保険料", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "損害保険料" },
  { code: "EXP-13", name: "修繕費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "修繕費" },
  { code: "EXP-14", name: "租税公課", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "租税公課" },
  { code: "EXP-15", name: "支払利息", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "利子割引料" },
  { code: "EXP-16", name: "荷造運賃", group: "EXP", recommendedCostType: "variable", taxFormAccount: "荷造運賃" },
  { code: "EXP-17", name: "諸会費", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "雑費" },
  { code: "EXP-18", name: "研修・教育費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "雑費" },
  { code: "EXP-19", name: "サブスク・ツール", group: "EXP", recommendedCostType: "fixed", taxFormAccount: "通信費／消耗品費" },
  { code: "EXP-20", name: "雑費", group: "EXP", recommendedCostType: "variable", taxFormAccount: "雑費" },
  { code: "EXP-21", name: "食費", group: "EXP", recommendedCostType: "variable" },
  { code: "EXP-22", name: "日用品", group: "EXP", recommendedCostType: "variable" },
  { code: "EXP-23", name: "被服費", group: "EXP", recommendedCostType: "variable" },
  { code: "EXP-24", name: "医療費", group: "EXP", recommendedCostType: "variable" },
  { code: "EXP-25", name: "教育費", group: "EXP", recommendedCostType: "fixed" },
  { code: "EXP-26", name: "教養・娯楽費", group: "EXP", recommendedCostType: "variable" },
  { code: "EXP-27", name: "社会保険料", group: "EXP", recommendedCostType: "fixed" },
  { code: "EXP-28", name: "税金（所得税・住民税）", group: "EXP", recommendedCostType: "fixed" },
  { code: "EXP-29", name: "生命保険料", group: "EXP", recommendedCostType: "fixed" },
  { code: "EXP-30", name: "こづかい", group: "EXP", recommendedCostType: "fixed" },
  { code: "EXP-31", name: "仕送り・援助", group: "EXP", recommendedCostType: "fixed" },
  { code: "EXP-32", name: "特別費", group: "EXP", recommendedCostType: "variable" },

  /* ---------- 資金移動（TRF） ----------
     損益に計上しない。CL-5 の集計対象外（§3.1.2 適用規則5）。 */
  { code: "TRF-01", name: "口座間振替", group: "TRF" },
  { code: "TRF-02", name: "事業主貸", group: "TRF" },
  { code: "TRF-03", name: "事業主借", group: "TRF" },
  { code: "TRF-04", name: "カード引落", group: "TRF", generated: true },
  { code: "TRF-05", name: "借入実行", group: "TRF" },
  { code: "TRF-06", name: "借入返済（元金）", group: "TRF", generated: true },
  { code: "TRF-07", name: "消費税の納付積立", group: "TRF" },
];

/** CL-2 が生成するカード引落の費目コード。 */
export const CATEGORY_CARD_SETTLEMENT = "TRF-04";

/** CL-8 が生成する借入返済（元金）の費目コード。 */
export const CATEGORY_LOAN_PRINCIPAL = "TRF-06";

/** 借入返済の利息分の費目コード（CL-8 は元金と利息を2件に分解する）。 */
export const CATEGORY_LOAN_INTEREST = "EXP-15";

const BY_CODE = new Map(CATEGORIES.map((c) => [c.code, c]));
const ORDER = new Map(CATEGORIES.map((c, i) => [c.code, i]));

/**
 * 費目コードからマスタの1件を引く。
 *
 * マスタに無いコードは投げる。v1.0 では利用者が費目を追加できないため
 * （§3.1.2 適用規則4）、未知のコードは実装かデータの誤りである
 * （docs/adr/0007-coreは壊れた入力を投げて止める.md）。
 */
export function categoryOf(code: string): Category {
  const found = BY_CODE.get(code);
  if (!found) {
    throw new RangeError(`費目マスタに無いコードです: ${code}`);
  }
  return found;
}

/** 費目コードのグループ。 */
export function groupOfCategory(code: string): CategoryGroup {
  return categoryOf(code).group;
}

/**
 * 損益に計上する費目か。
 *
 * TRF（資金移動）だけが false。CL-5 はこれで絞り込む。
 */
export function affectsProfitLoss(code: string): boolean {
  return groupOfCategory(code) !== "TRF";
}

/** マスタの掲載順（表示順）。小さいほど先。 */
export function categoryOrder(code: string): number {
  const index = ORDER.get(code);
  if (index === undefined) {
    throw new RangeError(`費目マスタに無いコードです: ${code}`);
  }
  return index;
}

/** グループに属する費目を掲載順で返す。 */
export function categoriesInGroup(group: CategoryGroup): Category[] {
  return CATEGORIES.filter((c) => c.group === group);
}
