import { describe, expect, it } from "vitest";

import {
  affectsProfitLoss,
  CATEGORIES,
  CATEGORY_CARD_SETTLEMENT,
  CATEGORY_LOAN_INTEREST,
  CATEGORY_LOAN_PRINCIPAL,
  categoriesInGroup,
  categoryOf,
  categoryOrder,
  groupOfCategory,
} from "../categories";

/* マスタは要件定義書 §3.1.2 からの転記である。
   転記ミスを検出するための検査をここに置く。 */

describe("費目マスタの整合性", () => {
  it("件数が要件定義書と一致する（INC 7 / EXP 32 / TRF 7）", () => {
    expect(categoriesInGroup("INC")).toHaveLength(7);
    expect(categoriesInGroup("EXP")).toHaveLength(32);
    expect(categoriesInGroup("TRF")).toHaveLength(7);
    expect(CATEGORIES).toHaveLength(46);
  });

  it("コードが重複しない", () => {
    const codes = CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("コードの接頭辞がグループと一致する", () => {
    for (const c of CATEGORIES) {
      expect(c.code.slice(0, 3)).toBe(c.group);
    }
  });

  it("コードは各グループ内で 01 から連番になっている", () => {
    for (const group of ["INC", "EXP", "TRF"] as const) {
      const numbers = categoriesInGroup(group).map((c) => Number(c.code.slice(4)));
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it("グループ内はコードの昇順になっている（適用規則3）", () => {
    // グループ間の順序は 収入 → 費用 → 資金移動（要件定義書の掲載順）であり、
    // 文字コード順（EXP < INC < TRF）ではない。昇順なのはグループの中だけ。
    for (const group of ["INC", "EXP", "TRF"] as const) {
      const codes = categoriesInGroup(group).map((c) => c.code);
      expect(codes).toEqual([...codes].sort());
    }
  });

  it("グループは INC → EXP → TRF の順にまとまっている", () => {
    const groups = CATEGORIES.map((c) => c.group);
    expect(groups).toEqual([
      ...new Array(7).fill("INC"),
      ...new Array(32).fill("EXP"),
      ...new Array(7).fill("TRF"),
    ]);
  });

  it("名称が空でない", () => {
    for (const c of CATEGORIES) {
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("EXP だけが推奨の固定／変動を持つ（適用規則6）", () => {
    for (const c of CATEGORIES) {
      if (c.group === "EXP") {
        expect(c.recommendedCostType).toBeDefined();
      } else {
        expect(c.recommendedCostType).toBeUndefined();
      }
    }
  });

  it("マスタは事業割合を持たない（適用規則7）", () => {
    /* 固定／変動には推奨値があるのに事業割合には無いのは、非対称だが意図的。
       事業割合を決めているのは費目ではなく利用者の事業形態であり、
       マスタに持たせると全員に同じ値を押し付けることになる。
       全費目の初期値は 0。UI 側（タスク#10）で利用者が項目ごとに設定する。
       揃えるために bizRatio を足さないこと。 */
    for (const c of CATEGORIES) {
      expect(c).not.toHaveProperty("bizRatio");
      expect(c).not.toHaveProperty("defaultBizRatio");
    }
  });

  it("EXP-01〜EXP-20 は青色申告決算書の科目に対応する", () => {
    for (const c of categoriesInGroup("EXP")) {
      const n = Number(c.code.slice(4));
      if (n <= 20) expect(c.taxFormAccount).toBeDefined();
      else expect(c.taxFormAccount).toBeUndefined();
    }
  });

  it("自動生成の費目はカード引落と借入返済（元金）だけ", () => {
    expect(CATEGORIES.filter((c) => c.generated).map((c) => c.code)).toEqual([
      "TRF-04",
      "TRF-06",
    ]);
  });
});

describe("要件定義書が名指ししている費目", () => {
  it("EXP-14 租税公課 と EXP-28 税金 は別物", () => {
    expect(categoryOf("EXP-14").name).toBe("租税公課");
    expect(categoryOf("EXP-28").name).toBe("税金（所得税・住民税）");
    expect(categoryOf("EXP-14").taxFormAccount).toBe("租税公課");
    // 所得税・住民税は経費にならないので決算書の科目を持たない
    expect(categoryOf("EXP-28").taxFormAccount).toBeUndefined();
  });

  it("AC-18 が使う EXP-02 は水道光熱費", () => {
    expect(categoryOf("EXP-02").name).toBe("水道光熱費");
  });

  it("AC-19 が使う TRF-06 と EXP-15", () => {
    expect(categoryOf(CATEGORY_LOAN_PRINCIPAL).name).toBe("借入返済（元金）");
    expect(categoryOf(CATEGORY_LOAN_INTEREST).name).toBe("支払利息");
    expect(CATEGORY_LOAN_PRINCIPAL).toBe("TRF-06");
    expect(CATEGORY_LOAN_INTEREST).toBe("EXP-15");
  });

  it("CL-2 が生成するカード引落は TRF-04", () => {
    expect(CATEGORY_CARD_SETTLEMENT).toBe("TRF-04");
    expect(categoryOf("TRF-04").name).toBe("カード引落");
    expect(categoryOf("TRF-04").generated).toBe(true);
  });

  it("費目が足りないときの受け皿は EXP-20 と INC-07（適用規則4）", () => {
    expect(categoryOf("EXP-20").name).toBe("雑費");
    expect(categoryOf("INC-07").name).toBe("その他収入");
  });
});

describe("groupOfCategory / affectsProfitLoss", () => {
  it("グループを返す", () => {
    expect(groupOfCategory("INC-01")).toBe("INC");
    expect(groupOfCategory("EXP-01")).toBe("EXP");
    expect(groupOfCategory("TRF-01")).toBe("TRF");
  });

  it("TRF だけが損益に計上されない", () => {
    expect(affectsProfitLoss("INC-01")).toBe(true);
    expect(affectsProfitLoss("EXP-15")).toBe(true);
    expect(affectsProfitLoss("TRF-06")).toBe(false);
    expect(affectsProfitLoss("TRF-04")).toBe(false);
  });

  it("TRF の全費目が損益対象外", () => {
    for (const c of categoriesInGroup("TRF")) {
      expect(affectsProfitLoss(c.code)).toBe(false);
    }
  });
});

describe("categoryOrder", () => {
  it("掲載順のとおりに並ぶ", () => {
    expect(categoryOrder("INC-01")).toBe(0);
    expect(categoryOrder("EXP-01")).toBe(7);
    expect(categoryOrder("TRF-01")).toBe(39);
    expect(categoryOrder("EXP-02")).toBeGreaterThan(categoryOrder("EXP-01"));
  });
});

describe("マスタに無いコード", () => {
  it("投げる", () => {
    expect(() => categoryOf("EXP-99")).toThrow(RangeError);
    expect(() => groupOfCategory("XXX-01")).toThrow(RangeError);
    expect(() => categoryOrder("")).toThrow(RangeError);
    // 名称で引こうとしても通らない。コードで持つのが規約
    expect(() => categoryOf("水道光熱費")).toThrow(RangeError);
  });
});
