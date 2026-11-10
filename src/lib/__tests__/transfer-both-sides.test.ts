import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { actualToEvent } from "@/core/cash";
import {
  CATEGORIES,
  categoryFitsType,
  costTypeApplies,
  groupsForType,
} from "@/core/categories";
import { buildMonthlyCashflow } from "@/core/monthly";
import { buildPLMatrix, plGroupOf } from "@/core/pl";
import type { Account, Actual } from "@/core/types";
import { categoryOptionsFor, fitCategory } from "@/components/ui/inputs";
import { buildLedgerView } from "@/lib/ledger";

/**
 * AC-58 / AC-20d 振替を両側の明細から記録する（FR-51・ADR-0025）
 *
 * `type = expense` / `income` の行が資金移動（TRF）の費目を持てる。
 * ○○銀行の明細から出金1行、△△信金の明細から入金1行を作り、
 * **`toAccountId` は誰も設定しない。** ゆるい一致を1つも使わずに、
 * 合計・口座別・損益のすべてを正しく出すための形。
 *
 * **1層では足りない。** 残高と損益だけ見ると AC-20d が空振りする
 * （`buildMonthlyCashflow` は費目を一切見ないので、月次表だけ振る舞いが
 * 違う）。`one-sided-transfer.test.ts` と同じ理由で、ここは経路を通す。
 *
 * **退化に注意**（CLAUDE.md §2.11 の4つ目の形）。両側を記録すると入金と
 * 出金が同額になるため、**合計の増減が0であることだけを見ると、両方とも
 * 月次表に出ていない実装でも通る。** 入金と出金をそれぞれ個別に見る。
 */

const accounts: Account[] = [
  { id: "bank", name: "○○銀行", kind: "bank", balance: 1_000_000 },
  { id: "shinkin", name: "△△信金", kind: "bank", balance: 500_000 },
];

/** 片側ぶんの行。明細に出ているとおりの収支で、費目だけ資金移動にする */
const side = (over: Partial<Actual>): Actual => ({
  id: "x1",
  date: "2026-10-05",
  name: "ﾌﾘｶｴ",
  amount: 100_000,
  type: "expense",
  costType: null,
  categoryCode: "TRF-01",
  accountId: "bank",
  key: null,
  unplanned: true,
  bizRatio: 0,
  ...over,
});

const OUT = side({ id: "out" });
const IN = side({ id: "in", type: "income", accountId: "shinkin" });

function run(actuals: Actual[]) {
  const series = buildBalanceSeries(
    { accounts, asOf: "2026-10-01", forecast: [], actuals },
    "2026-10-31",
    "2026-10-31",
  );
  const row = series.rows.find((r) => r.date === "2026-10-31")!;
  const monthly = buildMonthlyCashflow(series, 0);
  const view = (kind: "all" | "transfer" | "variable" | "income") =>
    buildLedgerView({
      series,
      monthly,
      from: "2026-10",
      to: "2026-10",
      kind,
      status: "all",
      today: "2026-10-31",
    });
  const names = (kind: "all" | "transfer" | "variable" | "income") =>
    view(kind)
      .groups.flatMap((g) => g.entries)
      .map((e) => e.name);

  return {
    total: row.proj,
    byAccount: { ...row.byAccount },
    month: monthly.find((m) => m.yearMonth === "2026-10")!,
    names,
    /* **実績 → イベントの変換は本番のものを使う**（CLAUDE.md §2.8）。
       写し取ると、本番が変わってもここは古いまま通る */
    pl: buildPLMatrix({
      year: 2026,
      scope: "all",
      forecast: [],
      actuals: actuals.map(actualToEvent),
      today: "2026-12-31",
    }),
  };
}

const empty = run([]);

/* ========================= AC-58 片側ぶんの1行 ========================= */

describe("AC-58 支出の行が資金移動の費目を持てる", () => {
  const one = run([OUT]);

  it("年月別収支に現れない", () => {
    /* **費目で外れる。`type` で判定する実装だと "variable" が返る** */
    expect(plGroupOf(OUT)).toBeNull();

    const codes = one.pl.actual.groups.flatMap((g) =>
      g.rows.map((r) => r.categoryCode),
    );
    expect(codes).not.toContain("TRF-01");
    expect(one.pl.actual.netYearTotal).toBe(0);
  });

  it("残高はその口座だけが動き、振替先の口座は動かない", () => {
    expect(one.byAccount.bank).toBe(empty.byAccount.bank - 100_000);
    /* **`toAccountId` を持たないので相手は動かない。** 片側だけを
       取り込んだ時点では、相手の明細をまだ誰も見ていない */
    expect(one.byAccount.shinkin).toBe(empty.byAccount.shinkin);
    expect(one.total).toBe(empty.total - 100_000);
  });

  it("入出金予定表の「振替」フィルタに掛かり、変動費には出ない", () => {
    expect(one.names("transfer")).toContain("ﾌﾘｶｴ");
    expect(one.names("variable")).not.toContain("ﾌﾘｶｴ");
    expect(one.names("all")).toContain("ﾌﾘｶｴ");
  });

  it("固定／変動を持たない（適用規則6）", () => {
    expect(costTypeApplies("TRF-01")).toBe(false);
    expect(costTypeApplies("EXP-01")).toBe(true);
    expect(costTypeApplies("INC-01")).toBe(false);
  });
});

/* ========================= AC-20d 両側記録 ========================= */

describe("AC-20d 両側の明細から記録した振替", () => {
  const both = run([OUT, IN]);

  it("月次資金繰り表の入金と出金にそれぞれ含まれる（AC-20b と同じ扱い）", () => {
    /* **ここを net で見てはいけない。** 両側は同額なので、2行とも月次表に
       出ていない実装でも net は0になる（§2.11 の4つ目の形） */
    expect(both.month.outflow).toBe(empty.month.outflow + 100_000);
    expect(both.month.inflow).toBe(empty.month.inflow + 100_000);
  });

  it("合計残高の増減が0で、口座別は送金元マイナス・送金先プラス", () => {
    expect(both.total).toBe(empty.total);
    expect(both.byAccount.bank).toBe(empty.byAccount.bank - 100_000);
    expect(both.byAccount.shinkin).toBe(empty.byAccount.shinkin + 100_000);
  });

  it("年月別収支には現れない", () => {
    expect(plGroupOf(IN)).toBeNull();
    expect(both.pl.actual.netYearTotal).toBe(0);
  });

  it("どちらの行も「振替」フィルタに掛かり、収入フィルタには出ない", () => {
    expect(both.names("transfer")).toHaveLength(2);
    expect(both.names("income")).not.toContain("ﾌﾘｶｴ");
  });
});

/* ================== 適用規則5a 費目グループと type の対応 ================== */

describe("適用規則5a 費目グループと収支の対応", () => {
  it("資金移動はどちらの符号でも持て、逆向きの費目は持てない", () => {
    expect(categoryFitsType("TRF-01", "expense")).toBe(true);
    expect(categoryFitsType("TRF-01", "income")).toBe(true);
    expect(categoryFitsType("TRF-01", "transfer")).toBe(true);

    expect(categoryFitsType("EXP-01", "expense")).toBe(true);
    expect(categoryFitsType("EXP-01", "income")).toBe(false);
    expect(categoryFitsType("INC-01", "income")).toBe(true);
    expect(categoryFitsType("INC-01", "expense")).toBe(false);
    expect(categoryFitsType("EXP-01", "transfer")).toBe(false);
  });

  it("収支を切り替えても資金移動の費目は残る", () => {
    /* 寄せ直すと「振替にしたのに支出に戻る」 */
    expect(fitCategory("income", "TRF-01")).toBe("TRF-01");
    expect(fitCategory("expense", "TRF-01")).toBe("TRF-01");
    /* 合わない費目は先頭に寄せる（従来どおり） */
    expect(fitCategory("income", "EXP-01")).toBe("INC-01");
    expect(fitCategory("expense", "INC-01")).toBe("EXP-01");
  });

  it("選べる費目に、自動生成される費目が1つも出ない", () => {
    /* **列挙ではなくマスタ全体と突き合わせる**（CLAUDE.md §2.8）。
       生成される費目が増えたときに、ここが落ちる */
    const generated = CATEGORIES.filter((c) => c.generated).map((c) => c.code);
    expect(generated.length).toBeGreaterThan(0);

    for (const type of ["expense", "income", "transfer"] as const) {
      const offered = categoryOptionsFor(type).map((c) => c.code);
      for (const code of generated) {
        expect(offered).not.toContain(code);
      }
      /* 出す中身も確かめる（空なら上の not.toContain は必ず通る） */
      expect(offered.length).toBeGreaterThan(0);
      for (const group of groupsForType(type)) {
        expect(
          offered.some((code) => categoryFitsType(code, type) && code.startsWith(group)),
        ).toBe(true);
      }
    }
    expect(categoryOptionsFor("expense").map((c) => c.code)).toContain("TRF-01");
  });
});
