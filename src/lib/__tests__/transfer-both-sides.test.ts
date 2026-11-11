import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { actualToEvent } from "@/core/cash";
import {
  CATEGORIES,
  categoryFitsType,
  categoryOptionsFor,
  costTypeApplies,
  fitCategory,
  fitToType,
  groupsForType,
} from "@/core/categories";
import { buildMonthlyCashflow } from "@/core/monthly";
import { buildPLMatrix, plGroupOf } from "@/core/pl";
import { touchesAccount } from "@/core/types";
import type { Account, Actual, EntryType } from "@/core/types";
import { amountView } from "@/components/sakiguri/amount-view";
import { categoryTagFor } from "@/components/sakiguri/CategoryTag";
import { ACCOUNT_LABEL, applyActualPatch } from "@/components/entry/ActualForm";
import {
  buildEntryActualRows,
  entryAmountScope,
} from "@/components/entry/entry-view-model";
import { buildLedgerView } from "@/lib/ledger";
import { emptyAppData } from "@/lib/app-data";
import { removeAccount } from "@/lib/mutations";

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
    /* 絞り込みなしの明細。AC-58b の符号をここから見る */
    viewAll: view("all"),
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

/* ===================== AC-58b 金額に付く符号 ===================== */

/**
 * 符号は**その行がいま見ている範囲で残高をどちら向きに動かすか**で決まる
 * （要件定義書 §3.3 全体に効く原則）。`type` では決めない。
 *
 * **退化に注意**（CLAUDE.md §2.11）。
 *
 * | 空振りする形 | ここで使う形 |
 * |---|---|
 * | 片側だけ置く | **両側記録の2行を同じ表に出す。** 片側だけだと、符号を常に付ける実装でも通る |
 * | 振替が全部片側記録 | **`type = transfer` の行も同じ表に置く。** 置かないと「全部に符号を付ける実装」と区別できない |
 * | 符号だけ見る | **色も見る。** 符号を付けたついでに費用の色にしていないか |
 */
describe("AC-58b 符号は残高の動きで決まる", () => {
  /** 合計の中で閉じる振替。両側が現預金なので残高を動かさない */
  const CLOSED = side({
    id: "closed",
    name: "ｼﾝｷﾝﾍ ｲﾄﾞｳ",
    type: "transfer",
    toAccountId: "shinkin",
  });
  /** 振替でない支出と収入。符号の基準として同じ表に置く */
  const RENT = side({
    id: "rent",
    name: "ﾔﾁﾝ",
    amount: 95_000,
    categoryCode: "EXP-01",
    costType: "fixed",
    bizRatio: 100,
  });
  const SALES = side({
    id: "sales",
    name: "ｳﾘｱｹﾞ",
    amount: 330_000,
    type: "income",
    categoryCode: "INC-01",
    bizRatio: 100,
  });

  const ROWS = [OUT, IN, CLOSED, RENT, SALES];

  /** 明細の行を `amountView` に通したもの（本番と同じ経路） */
  const shownInLedger = () => {
    const entries = run(ROWS)
      .viewAll.groups.flatMap((g) => g.entries);
    /* **鍵は実績の id。** 名前で引くと、両側記録の2行は摘要が同じ
       （`ﾌﾘｶｴ`）なので**1件に畳まれて、割れるところを見られない** */
    return new Map(
      entries.map((e) => [
        e.srcId,
        amountView({
          amount: e.amount,
          delta: e.delta,
          category: categoryTagFor(e.categoryCode, e.costType),
          type: e.type,
        }),
      ]),
    );
  };

  it("入出金予定表：出金に −、入金に +、閉じる振替は符号なし", () => {
    const shown = shownInLedger();
    /* 前提：5行とも同じ表に出ている。1行でも欠けると測れない */
    expect(shown.size).toBe(5);

    /* 両側記録 ―― **同じ表の中で向きが割れる** */
    expect(shown.get("out")).toMatchObject({ value: -100_000, signed: true });
    expect(shown.get("in")).toMatchObject({ value: 100_000, signed: true });

    /* 閉じる振替は動かさないので符号を付けない。金額はそのまま出す */
    expect(shown.get("closed")).toMatchObject({
      value: 100_000,
      signed: false,
    });

    /* 振替でない行も同じ規則で決まる */
    expect(shown.get("rent")).toMatchObject({ value: -95_000, signed: true });
    expect(shown.get("sales")).toMatchObject({ value: 330_000, signed: true });
  });

  it("符号を付けても費用の色にしない（色は費目が決める）", () => {
    const shown = shownInLedger();
    expect(shown.get("out")?.type).toBe("neutral");
    expect(shown.get("closed")?.type).toBe("neutral");
    expect(shown.get("rent")?.type).toBe("expense");
    expect(shown.get("sales")?.type).toBe("income");
  });

  it("実績の一覧で、出金の振替と入金の振替が見分けられる", () => {
    const rows = buildEntryActualRows(ROWS, entryAmountScope(accounts));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const out = byId.get("out")!.display;
    const into = byId.get("in")!.display;

    /* **同じ額・同じ色でも、符号で割れる。** ここが報告された欠陥
       （どちらも `¥100,000` と出て区別できなかった） */
    expect(out.type).toBe(into.type);
    expect(Math.abs(out.value)).toBe(Math.abs(into.value));
    expect(out.value).toBe(-100_000);
    expect(into.value).toBe(100_000);
    expect(out.signed && into.signed).toBe(true);

    /* 閉じる振替は符号なし。**これが無いと「全部に符号」でも通る** */
    expect(byId.get("closed")!.display).toMatchObject({ signed: false });
  });

  it("カードの利用は符号を失わない（引落日まで合計は動かない）", () => {
    /* **現預金だけで足すと0になる行。** 範囲にカードを入れていないと
       「符号なし」になり、カード払いの予定が向きを失う */
    const withCard: Account[] = [
      ...accounts,
      {
        id: "card",
        name: "××カード",
        kind: "card",
        balance: 0,
        closingDay: 15,
        payMonthOffset: 1,
        payDay: 10,
        settleAccountId: "bank",
      },
    ];
    const cardUse = side({
      id: "card-use",
      name: "ｻﾌﾞｽｸ",
      amount: 12_000,
      categoryCode: "EXP-03",
      costType: "fixed",
      accountId: "card",
    });
    const rows = buildEntryActualRows([cardUse], entryAmountScope(withCard));
    expect(rows[0].display).toMatchObject({ value: -12_000, signed: true });
  });
});

/* ============== AC-58c/d/e 収支を変えたあとの振替先 ============== */

/**
 * AC-58c / AC-58d / AC-58e 収入の行に振替先が残っていた
 *
 * **利用者の報告：** 入金先が銀行のはずなのに、現金で絞り込むと
 * その行が出る。
 *
 * 振替で入れて振替先に現金を選び、**そのあと収支を収入に変える。**
 * 振替先の欄は画面から消えるのに値が残り、`touchesAccount` が
 * 拾っていた。**残高は本当に正しかった**（`accountDelta` は振替以外で
 * `toAccountId` を見ない）ので、残高を測る AC-58 は通り続けた
 * （CLAUDE.md §2.11 の「経路が2つある」）。
 *
 * 直す場所は2つある。**どちらも要る。**
 *
 * | | |
 * |---|---|
 * | 書き込み（AC-58c） | `fitToType` が収支を変えたときに落とす。**新しく入らない** |
 * | 読み取り（AC-58d） | `touchesAccount` が振替以外で見ない。**既に入っている行が無害になる** |
 */
describe("AC-58c 収支を変えると振替先が落ちる", () => {
  /** 振替で入れて、振替先に現金を選んだ状態 */
  const asTransfer = (): Actual =>
    side({
      id: "t1",
      type: "transfer",
      categoryCode: "TRF-01",
      accountId: "bank",
      toAccountId: "shinkin",
    });

  /* **在ることを先に測る**（CLAUDE.md §2.11）。振替のままなら残る。
     これが無いと、常に落とす実装と区別がつかない */
  it("振替のままなら振替先は残る", () => {
    const next = applyActualPatch(asTransfer(), { amount: 50_000 });
    expect(next.toAccountId).toBe("shinkin");
  });

  it("実績編集で、収入に変えると落ちる", () => {
    expect(applyActualPatch(asTransfer(), { type: "income" }).toAccountId).toBeUndefined();
  });

  it("実績編集で、支出に変えると落ちる", () => {
    expect(applyActualPatch(asTransfer(), { type: "expense" }).toAccountId).toBeUndefined();
  });

  /**
   * **予定の設定と実績編集が同じ規則を通ること。** 以前は2箇所に
   * 同じ規則があり、実績編集の側だけ落としていなかった（§2.8）。
   * いまは `fitToType` の1本で、ここは両方がそれを通ることを見る。
   */
  it("予定の設定でも落ちる。両方が同じ1本を通る", () => {
    const planned = {
      type: "transfer" as EntryType,
      costType: null,
      categoryCode: "TRF-01",
      amount: 100_000,
      bizRatio: 0,
      accountId: "bank",
      toAccountId: "shinkin",
    };
    expect(fitToType(planned, "transfer").toAccountId).toBe("shinkin");
    expect(fitToType(planned, "income").toAccountId).toBeUndefined();

    /* 実績編集の側も、同じ入力に同じ答えを返す */
    const actual = asTransfer();
    for (const type of ["income", "expense", "transfer"] as EntryType[]) {
      expect(applyActualPatch(actual, { type }).toAccountId).toBe(
        fitToType(actual, type).toAccountId,
      );
    }
  });

  it("収支を変えても、費目と固定／変動の整えは変わらない（AC-58a）", () => {
    const next = applyActualPatch(asTransfer(), { type: "income" });
    /* 資金移動の費目は持ち越す（適用規則5a） */
    expect(next.categoryCode).toBe("TRF-01");
    /* 資金移動なので固定／変動は持たない（適用規則6） */
    expect(next.costType).toBeNull();
  });
});

describe("AC-58d 振替先が残っている行は、その口座に属さない", () => {
  /** 本番に入っていた形。収入なのに振替先が残っている */
  const leftover = side({
    id: "left",
    name: "ﾆﾕｳｷﾝ",
    type: "income",
    categoryCode: "TRF-08",
    costType: null,
    amount: 500_000,
    accountId: "bank",
    toAccountId: "shinkin",
  });

  /** 同じ組に、振替先がちゃんと効く行も入れる（§2.11「在ることも測る」） */
  const realTransfer = side({
    id: "real",
    name: "ｱﾂﾌﾟ",
    type: "transfer",
    categoryCode: "TRF-01",
    costType: null,
    amount: 30_000,
    accountId: "bank",
    toAccountId: "shinkin",
  });

  const rows = [leftover, realTransfer];
  const inAccount = (accountId: string) =>
    rows.filter((r) => touchesAccount(r, accountId)).map((r) => r.id);

  it("残高は振替先を動かさない（ここは前から正しかった）", () => {
    const one = run([leftover]);
    expect(one.byAccount.shinkin).toBe(empty.byAccount.shinkin);
    expect(one.byAccount.bank).toBe(empty.byAccount.bank + 500_000);
  });

  it("一覧の絞り込み：振替先の口座に出ない。振替の行は出る", () => {
    expect(inAccount("shinkin")).toEqual(["real"]);
    /* 自分の口座では両方出る */
    expect(inAccount("bank")).toEqual(["left", "real"]);
  });

  it("口座削除：振替先の口座を消しても道連れにならない。振替の行は消える", () => {
    const data = {
      ...emptyAppData("2026-10-01"),
      accounts,
      actuals: rows,
    };
    /* **消す前に2件あることを見る。** 0件なら、消す実装でも残す実装でも
       同じ結果になる（CLAUDE.md §2.11） */
    expect(data.actuals).toHaveLength(2);

    const after = removeAccount(data, "shinkin");
    expect(after.actuals.map((a) => a.id)).toEqual(["left"]);
  });
});

describe("AC-58e 口座の欄のラベルが収支で変わる（FR-52）", () => {
  it("支出は支払元、収入は入金先、振替は振替元", () => {
    expect(ACCOUNT_LABEL.expense).toBe("支払元");
    expect(ACCOUNT_LABEL.income).toBe("入金先");
    expect(ACCOUNT_LABEL.transfer).toBe("振替元");
  });

  /** **3つとも違う文字であること。** 同じにすると出し分けの意味が無い */
  it("3つが互いに違う", () => {
    expect(new Set(Object.values(ACCOUNT_LABEL)).size).toBe(3);
  });

  /**
   * **収支の全体と突き合わせる。** 収支が増えたときに落ちる
   * （CLAUDE.md §2.8）。`Record<EntryType, string>` なので型でも落ちるが、
   * ここは `EntryType` の値の集合そのものと突き合わせている。
   */
  it("収支の全部にラベルがある", () => {
    const types: EntryType[] = ["income", "expense", "transfer"];
    expect(Object.keys(ACCOUNT_LABEL).sort()).toEqual([...types].sort());
  });

  /** 振替のときは「振替元」で、下の欄の「振替先」と対になる */
  it("振替は「振替元」で、振替先と対になる", () => {
    expect(ACCOUNT_LABEL.transfer).toBe("振替元");
    expect(ACCOUNT_LABEL.transfer.endsWith("元")).toBe(true);
  });
});
