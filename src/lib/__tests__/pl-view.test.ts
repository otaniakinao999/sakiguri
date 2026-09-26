import { describe, expect, it } from "vitest";

import { buildPLMatrix } from "@/core/pl";
import type { LedgerEvent } from "@/core/types";

import { buildPLDisplay, diffTone, selectableYears } from "../pl-view";

/* ========================= 素材 ========================= */

const NOW = "2026-06-30"; // 本日。1〜6月が過去、7〜12月が未来

function ev(
  over: Partial<LedgerEvent> & Pick<LedgerEvent, "date" | "categoryCode">,
): LedgerEvent {
  return {
    key: `k:${over.date}:${over.categoryCode}`,
    name: "項目",
    type: "expense",
    costType: "fixed",
    amount: 100_000,
    bizRatio: 0,
    accountId: "a1",
    src: "recurring",
    ...over,
  };
}

/** 4月：予定120,000／実績118,000の家賃。収入は予定450,000／実績470,000 */
const FORECAST: LedgerEvent[] = [
  ev({ key: "p1", date: "2026-04-27", categoryCode: "EXP-01", amount: 120_000 }),
  ev({
    key: "p2",
    date: "2026-04-25",
    categoryCode: "INC-01",
    type: "income",
    costType: null,
    amount: 450_000,
  }),
  ev({ key: "p3", date: "2026-09-27", categoryCode: "EXP-01", amount: 120_000 }),
];

const ACTUALS: LedgerEvent[] = [
  ev({
    key: "p1",
    date: "2026-04-27",
    categoryCode: "EXP-01",
    amount: 118_000,
    src: "actual",
  }),
  ev({
    key: "p2",
    date: "2026-04-25",
    categoryCode: "INC-01",
    type: "income",
    costType: null,
    amount: 470_000,
    src: "actual",
  }),
];

function display(mode: "mixed" | "plan" | "actual" | "diff") {
  const matrix = buildPLMatrix({
    forecast: FORECAST,
    actuals: ACTUALS,
    year: 2026,
    scope: "all",
    today: NOW,
  });
  return buildPLDisplay(matrix, mode, NOW);
}

const row = (d: ReturnType<typeof display>, key: string) =>
  d.rows.find((r) => r.key === key)!;

/** 1始まりの月 */
const m = (n: number) => n - 1;

/* ========================= 4つの表示モード（CL-5 手順6） ========================= */

describe("表示モード：予定", () => {
  it("消し込み済みかどうかに関わらず予定額を出す", () => {
    const d = display("plan");
    const rent = row(d, "category:fixed:EXP-01");

    expect(rent.monthly[m(4)]).toBe(120_000);
    expect(rent.monthly[m(9)]).toBe(120_000);
    expect(rent.yearTotal).toBe(240_000);
  });

  it("未来月も出す", () => {
    const d = display("plan");
    expect(row(d, "category:fixed:EXP-01").monthly[m(9)]).toBe(120_000);
  });
});

describe("表示モード：実績", () => {
  it("過去月は実績を出す", () => {
    const d = display("actual");
    expect(row(d, "category:fixed:EXP-01").monthly[m(4)]).toBe(118_000);
  });

  it("未来月に実績が無ければ0を出す", () => {
    const d = display("actual");
    expect(row(d, "category:fixed:EXP-01").monthly[m(9)]).toBe(0);
  });

  /**
   * 手順3 は期間で絞らない。未来日の実績を隠すと、残高だけが合わない状態に
   * なって原因が追えなくなる。最も多いのは日付の打ち間違いである。
   */
  it("未来月の実績を隠さない", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: [
        ...ACTUALS,
        ev({
          key: "p3",
          date: "2026-09-27",
          categoryCode: "EXP-01",
          amount: 125_000,
          src: "actual",
        }),
      ],
      year: 2026,
      scope: "all",
      today: NOW,
    });
    const rent = buildPLDisplay(matrix, "actual", NOW).rows.find(
      (r) => r.key === "category:fixed:EXP-01",
    )!;

    expect(rent.monthly[m(9)]).toBe(125_000);
    expect(rent.yearTotal).toBe(243_000);
  });

  it("年計は見えている値だけを足す", () => {
    const d = display("actual");
    // 9月の予定120,000は入らない
    expect(row(d, "category:fixed:EXP-01").yearTotal).toBe(118_000);
  });
});

describe("表示モード：実績+予定", () => {
  it("過去月は実績、未来月は予定", () => {
    const d = display("mixed");
    const rent = row(d, "category:fixed:EXP-01");

    expect(rent.monthly[m(4)]).toBe(118_000);
    expect(rent.monthly[m(9)]).toBe(120_000);
    expect(rent.yearTotal).toBe(238_000);
  });

  /**
   * AC-44。各セルは「発生日が本日以前の実績 ＋ 未消し込みの予定」。
   *
   * 過去の未消し込みの予定を予定額のまま残すのは CL-3 と同じ扱いで、
   * 残高予測と年月別収支が「見込み」について同じことを言うようになる。
   */
  describe("AC-44 見込み = 本日までの実績 ＋ 未消し込みの予定", () => {
    /** 本日 6/30。6/15 の予定と 6/28 の予定、6/20 の実績 */
    const june = (actuals: LedgerEvent[]) =>
      buildPLDisplay(
        buildPLMatrix({
          forecast: [
            ev({ key: "p1", date: "2026-06-15", categoryCode: "EXP-01", amount: 100_000 }),
            ev({ key: "p2", date: "2026-06-28", categoryCode: "EXP-01", amount: 30_000 }),
          ],
          actuals,
          year: 2026,
          scope: "all",
          today: NOW,
        }),
        "mixed",
        NOW,
      );

    const rent = (d: ReturnType<typeof june>) =>
      row(d, "category:fixed:EXP-01").monthly[m(6)];

    it("過去月に未消し込みの予定があれば、その予定額が入る", () => {
      /* どちらも未消し込み。CL-3 の予測系列と同じく予定額のまま残る */
      expect(rent(june([]))).toBe(130_000);
    });

    it("消し込んだぶんは実績に置き換わる", () => {
      const d = june([
        ev({ key: "p1", date: "2026-06-20", categoryCode: "EXP-01", amount: 120_000, src: "actual" }),
      ]);

      /* 実績120,000 ＋ 未消し込みの予定30,000 */
      expect(rent(d)).toBe(150_000);
    });

    it("予定にない支出は上乗せされる", () => {
      const d = june([
        ev({ key: null, date: "2026-06-22", categoryCode: "EXP-01", amount: 5_000, src: "actual" }),
      ]);

      expect(rent(d)).toBe(135_000);
    });

    it("本日より後の実績は入らない", () => {
      const d = june([
        ev({ key: null, date: "2026-07-05", categoryCode: "EXP-01", amount: 9_000, src: "actual" }),
      ]);

      expect(rent(d)).toBe(130_000);
    });
  });

  it("当初予算を添える", () => {
    const d = display("mixed");
    expect(row(d, "category:fixed:EXP-01").planMonthly?.[m(4)]).toBe(120_000);
  });

  it("他のモードでは予定額を添えない", () => {
    for (const mode of ["plan", "actual", "diff"] as const) {
      expect(row(display(mode), "category:fixed:EXP-01").planMonthly).toBeUndefined();
    }
  });
});

describe("表示モード：差異", () => {
  it("収入は 実績 − 予定", () => {
    const d = display("diff");
    // 470,000 − 450,000 = +20,000（予定より多い＝良い）
    expect(row(d, "category:income:INC-01").monthly[m(4)]).toBe(20_000);
  });

  it("費用は 予定 − 実績", () => {
    const d = display("diff");
    // 120,000 − 118,000 = +2,000（予定より少ない＝良い）
    expect(row(d, "category:fixed:EXP-01").monthly[m(4)]).toBe(2_000);
  });

  it("正の値が良い方向になる", () => {
    const d = display("diff");
    expect(diffTone(row(d, "category:income:INC-01").monthly[m(4)])).toBe("good");
    expect(diffTone(row(d, "category:fixed:EXP-01").monthly[m(4)])).toBe("good");
  });

  it("費用が予定より多ければ悪い方向", () => {
    const matrix = buildPLMatrix({
      forecast: [ev({ key: "p", date: "2026-04-27", categoryCode: "EXP-01", amount: 100_000 })],
      actuals: [
        ev({ key: "p", date: "2026-04-27", categoryCode: "EXP-01", amount: 130_000, src: "actual" }),
      ],
      year: 2026,
      scope: "all",
      today: NOW,
    });
    const d = buildPLDisplay(matrix, "diff", NOW);

    expect(row(d, "category:fixed:EXP-01").monthly[m(4)]).toBe(-30_000);
    expect(diffTone(-30_000)).toBe("bad");
  });

  /**
   * AC-42。未来月が空になるのは期間で切っているからではなく、
   * 比べる予定（予定日が本日以前のもの）が無いからである。
   */
  it("未来月は比べる予定が無いので0になる", () => {
    const d = display("diff");
    /* 9月に予定120,000があるが、予定日 9/27 は本日 6/30 より後 */
    expect(row(d, "category:fixed:EXP-01").monthly[m(9)]).toBe(0);
  });

  it("当月に未到来の予定があっても差異に入らない", () => {
    /* 本日 6/30。6/15 の予定は到来済み、6/28 に実績、6/30 の予定は未到来 */
    const matrix = buildPLMatrix({
      forecast: [
        ev({ key: "p1", date: "2026-06-15", categoryCode: "EXP-01", amount: 100_000 }),
        ev({ key: "p2", date: "2026-07-01", categoryCode: "EXP-14", amount: 30_000 }),
      ],
      actuals: [
        ev({ key: "p1", date: "2026-06-28", categoryCode: "EXP-01", amount: 120_000, src: "actual" }),
      ],
      year: 2026,
      scope: "all",
      today: NOW,
    });
    const d = buildPLDisplay(matrix, "diff", NOW);

    /* 予算超過なので負。未到来の 30,000 が乗って +10,000 になってはならない */
    expect(row(d, "group:fixed").monthly[m(6)]).toBe(-20_000);
  });

  /**
   * AC-42 の差し替え分。予定側だけを本日で切ると
   * 「本日までの予定 対 月全体の実績」になり、向きが逆なだけで
   * 両辺の期間が揃っていない点は元の欠陥と同じになる。
   */
  it("未来日の実績は未来月の差異に現れない", () => {
    const matrix = buildPLMatrix({
      forecast: [ev({ key: "p", date: "2026-10-20", categoryCode: "EXP-01", amount: 100_000 })],
      actuals: [
        ev({ key: null, date: "2026-10-20", categoryCode: "EXP-01", amount: 125_000, src: "actual" }),
      ],
      year: 2026,
      scope: "all",
      today: NOW,
    });
    const d = buildPLDisplay(matrix, "diff", NOW);

    /* 両辺とも空。−125,000 の予算超過として出してはならない */
    expect(row(d, "category:fixed:EXP-01").monthly[m(10)]).toBe(0);
    expect(row(d, "net").monthly[m(10)]).toBe(0);
  });

  it("当月は両辺とも本日まで。実績側だけ月全体にしない", () => {
    /* 本日 6/30。6/20 の実績と 7/2 の実績（＝翌月・本日より後） */
    const matrix = buildPLMatrix({
      forecast: [ev({ key: "p1", date: "2026-06-15", categoryCode: "EXP-01", amount: 100_000 })],
      actuals: [
        ev({ key: "p1", date: "2026-06-20", categoryCode: "EXP-01", amount: 120_000, src: "actual" }),
      ],
      year: 2026,
      scope: "all",
      today: "2026-06-19",
    });
    const d = buildPLDisplay(matrix, "diff", "2026-06-19");

    /* 6/19 時点では実績がまだ無い。予定100,000 のみが立っている */
    expect(row(d, "category:fixed:EXP-01").monthly[m(6)]).toBe(100_000);
  });

  it("差が無い月は良し悪しを付けない", () => {
    expect(diffTone(0)).toBeNull();
    expect(diffTone(null)).toBeNull();
  });
});

/* ========================= 当月の注記（AC-43） ========================= */

describe("AC-43 当月の差異に基準日の注記を出す", () => {
  it("差異モードでは当月の列に注記が付く", () => {
    const d = display("diff");

    expect(d.asOfNote).toEqual({ monthIndex: m(6), label: "6/30 時点" });
  });

  it("ほかのモードでは出さない", () => {
    for (const mode of ["mixed", "plan", "actual"] as const) {
      expect(display(mode).asOfNote).toBeNull();
    }
  });

  it("当月がその年に無ければ出さない", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: ACTUALS,
      year: 2027,
      scope: "all",
      today: NOW,
    });

    expect(buildPLDisplay(matrix, "diff", NOW).asOfNote).toBeNull();
  });

  it("日付はゼロ埋めしない", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: ACTUALS,
      year: 2026,
      scope: "all",
      today: "2026-03-05",
    });

    expect(buildPLDisplay(matrix, "diff", "2026-03-05").asOfNote?.label).toBe("3/5 時点");
  });
});

/* ========================= 行の並び ========================= */

describe("行の並び（CL-5 手順5）", () => {
  it("グループ計のすぐ下にその費目が並ぶ", () => {
    const d = display("plan");

    expect(d.rows.map((r) => r.key)).toEqual([
      "group:income",
      "category:income:INC-01",
      "group:fixed",
      "category:fixed:EXP-01",
      "group:variable",
      "net",
    ]);
  });

  it("グループ計は費目の合計になる", () => {
    const d = display("plan");

    expect(row(d, "group:fixed").monthly[m(4)]).toBe(120_000);
    expect(row(d, "group:income").monthly[m(4)]).toBe(450_000);
  });

  it("費目の無いグループも行として残る", () => {
    const d = display("plan");
    const variable = row(d, "group:variable");

    expect(variable.yearTotal).toBe(0);
  });

  it("収支 = 収入 − 固定費 − 変動費", () => {
    const d = display("plan");
    expect(row(d, "net").monthly[m(4)]).toBe(450_000 - 120_000);
  });

  it("事業ビューでは収支の行が事業所得になる", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: ACTUALS,
      year: 2026,
      scope: "business",
      today: NOW,
    });
    const d = buildPLDisplay(matrix, "plan", NOW);

    expect(d.netLabel).toBe("事業所得");
    expect(row(d, "net").label).toBe("事業所得");
  });

  it("合算・家計では収支のまま", () => {
    for (const scope of ["all", "household"] as const) {
      const matrix = buildPLMatrix({ forecast: FORECAST, actuals: ACTUALS, year: 2026, scope, today: NOW });
      expect(buildPLDisplay(matrix, "plan", NOW).netLabel).toBe("収支");
    }
  });
});

/* ========================= 列 ========================= */

describe("列（CL-5 手順5）", () => {
  it("1月から12月まで", () => {
    const d = display("plan");

    expect(d.months).toHaveLength(12);
    expect(d.months[0]).toBe("2026-01");
    expect(d.months[11]).toBe("2026-12");
  });

  /**
   * 過去月・未来月という区別を表示モデルが持たない。どのモードも
   * 「どの面を見るか」だけで決まる（ADR-0019）。
   */
  it("月を過去と未来に分ける情報を持たない", () => {
    expect(display("plan")).not.toHaveProperty("isPast");
  });

  it("すべての行が12ヶ月ぶんの値を持つ", () => {
    const d = display("mixed");
    for (const r of d.rows) {
      expect(r.monthly).toHaveLength(12);
    }
  });
});

/* ========================= 年の選択 ========================= */

describe("selectableYears", () => {
  it("日付に現れる年と今年を返す", () => {
    expect(selectableYears(["2026-04-01", "2027-03-31"], 2026)).toEqual([2026, 2027]);
  });

  it("重複を除いて昇順にする", () => {
    expect(
      selectableYears(["2027-01-01", "2026-12-31", "2026-01-01"], 2026),
    ).toEqual([2026, 2027]);
  });

  it("何も無ければ今年だけ", () => {
    expect(selectableYears([], 2026)).toEqual([2026]);
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ出力を返す", () => {
    expect(display("mixed")).toEqual(display("mixed"));
  });

  it("入力を書き換えない", () => {
    const matrix = buildPLMatrix({
      forecast: FORECAST,
      actuals: ACTUALS,
      year: 2026,
      scope: "all",
      today: NOW,
    });
    const snapshot = structuredClone(matrix);

    buildPLDisplay(matrix, "mixed", NOW);

    expect(matrix).toEqual(snapshot);
  });
});
