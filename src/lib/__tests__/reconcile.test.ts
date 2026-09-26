import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { classificationChanges } from "@/core/classification";
import { buildForecast } from "@/core/forecast";
import type { Actual, DepositAccount, RecurringItem } from "@/core/types";

import { emptyAppData, type AppData } from "../app-data";
import { describeInheritance } from "../classification-notice";
import { linkActualToPlan, setUnplanned, settleAsPlanned } from "../mutations";
import { findCandidates, isCandidate } from "../reconcile";

/**
 * FR-46 / AC-30。
 *
 * `key` を持たない実績は CL-3 の消し込み（手順2）に掛からないため、同じ取引が
 * 予定と実績の両方で残高に乗る。残高が低く出ると防衛ラインの警告が誤って鳴り、
 * PoC の指標「残高警告からの操作率」が測れなくなる。
 */

/* ========================= 素材 ========================= */

const ASOF = "2026-04-01";
const TODAY = "2026-04-20";
const TO = "2026-04-30";

const seikatsu: DepositAccount = {
  id: "a1",
  name: "生活口座",
  kind: "bank",
  balance: 1_000_000,
};

const jigyou: DepositAccount = {
  id: "a2",
  name: "事業口座",
  kind: "bank",
  balance: 500_000,
};

const rent: RecurringItem = {
  id: "rent",
  name: "家賃",
  type: "expense",
  costType: "fixed",
  categoryCode: "EXP-01",
  amount: 120_000,
  bizRatio: 0,
  accountId: "a1",
  day: 5,
  months: null,
  active: true,
};

function actual(over: Partial<Actual> & Pick<Actual, "id">): Actual {
  return {
    key: null,
    date: "2026-04-05",
    name: "家賃",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
    bizRatio: 0,
    accountId: "a1",
    ...over,
  };
}

function base(actuals: Actual[], recurring: RecurringItem[] = [rent]): AppData {
  return {
    ...emptyAppData(ASOF),
    accounts: [seikatsu, jigyou],
    recurring,
    actuals,
  };
}

function series(data: AppData) {
  const forecast = buildForecast(
    { recurring: data.recurring, oneoffs: data.oneoffs, overrides: data.overrides },
    ASOF,
    TO,
  );
  return buildBalanceSeries(
    { accounts: data.accounts, asOf: ASOF, forecast, actuals: data.actuals },
    TO,
    TODAY,
  );
}

/** 開始残高。生活口座 1,000,000 ＋ 事業口座 500,000 */
const OPENING = 1_500_000;

const closing = (data: AppData) => series(data).rows.at(-1)!.proj;

const found = (data: AppData) =>
  findCandidates({
    actuals: data.actuals,
    unmatchedForecast: series(data).unmatchedForecast,
  });

/** 予定インスタンスをキーで引く。`linkActualToPlan` に渡す */
const planOf = (data: AppData, key: string) =>
  series(data).unmatchedForecast.find((p) => p.key === key)!;

/* ========================= 二重計上そのもの ========================= */

describe("AC-30 二重計上が起きること自体", () => {
  it("key が無いと予定と実績の両方が残高に乗る", () => {
    const data = base([actual({ id: "x1", amount: 118_000 })]);

    /* 開始 1,500,000 − 120,000（予定）− 118,000（実績）= 1,262,000 */
    expect(closing(data)).toBe(OPENING - 120_000 - 118_000);
  });

  it("key があれば実績だけが乗る", () => {
    const data = base([
      actual({ id: "x1", amount: 118_000, key: "r:rent:2026-04-05" }),
    ]);

    /* 予定は消え、実績だけが乗る */
    expect(closing(data)).toBe(OPENING - 118_000);
  });
});

/* ========================= 候補の抽出 ========================= */

describe("AC-30 候補の抽出", () => {
  it("金額・向き・口座が一致し、日付が12日以内なら候補になる", () => {
    const got = found(base([actual({ id: "x1", date: "2026-04-10" })]));

    expect(got).toHaveLength(1);
    expect(got[0].actual.id).toBe("x1");
    expect(got[0].plans).toHaveLength(1);
    expect(got[0].plans[0].plan.key).toBe("r:rent:2026-04-05");
    expect(got[0].plans[0].dayGap).toBe(5);
  });

  it("日付がちょうど12日差なら候補になる", () => {
    expect(found(base([actual({ id: "x1", date: "2026-04-17" })]))).toHaveLength(1);
  });

  it("13日差なら候補にしない", () => {
    expect(found(base([actual({ id: "x1", date: "2026-04-18" })]))).toHaveLength(0);
  });

  it("金額が1円でも違えば候補にしない", () => {
    /* 金額の近さで当てると、利用者が気づけない誤りが残高に混ざる */
    expect(found(base([actual({ id: "x1", amount: 119_999 })]))).toHaveLength(0);
  });

  it("口座が違えば候補にしない", () => {
    /* CL-7 には無い条件。同額の取引が別口座で入れ替わって当たるのを防ぐ */
    expect(found(base([actual({ id: "x1", accountId: "a2" })]))).toHaveLength(0);
  });

  it("収支の向きが違えば候補にしない", () => {
    const got = found(
      base([actual({ id: "x1", type: "income", categoryCode: "INC-01", costType: null })]),
    );

    expect(got).toHaveLength(0);
  });

  it("既に key を持つ実績は対象にしない", () => {
    const got = found(base([actual({ id: "x1", key: "r:rent:2026-04-05" })]));

    expect(got).toHaveLength(0);
  });

  /**
   * 1つの予定が複数の実績の候補になってよい。
   *
   * どれか1つを確定すればその予定は消し込まれ、次の計算で他方の候補から
   * 消える。先に取ったもの勝ちにする必要はない。
   */
  it("同じ予定が複数の実績の候補になる", () => {
    const got = found(
      base([
        actual({ id: "x1", date: "2026-04-05" }),
        actual({ id: "x2", date: "2026-04-06" }),
      ]),
    );

    expect(got).toHaveLength(2);
    expect(got.every((g) => g.plans.length === 1)).toBe(true);
  });

  it("候補が無ければ空", () => {
    expect(found(base([], []))).toEqual([]);
    expect(found(base([actual({ id: "x1", amount: 3_000 })]))).toEqual([]);
  });
});

/* ========================= 自動では消し込まない ========================= */

describe("AC-30 自動では消し込まない", () => {
  it("候補を見つけても残高は変わらない", () => {
    const data = base([actual({ id: "x1", amount: 120_000 })]);

    expect(found(data)).toHaveLength(1);
    /* 候補があっても二重計上のまま。確定するまで勝手に消さない */
    expect(closing(data)).toBe(OPENING - 120_000 - 120_000);
  });

  it("確定すると二重計上が解消する", () => {
    const before = base([actual({ id: "x1", amount: 120_000 })]);
    const [candidate] = found(before);

    const after = linkActualToPlan(
      before,
      candidate.actual.id,
      candidate.plans[0].plan,
    );

    expect(after.actuals[0].key).toBe("r:rent:2026-04-05");
    expect(closing(after)).toBe(OPENING - 120_000);
    expect(found(after)).toEqual([]);
  });

  it("確定しても日付・金額・口座・名称は変わらない", () => {
    const before = base([actual({ id: "x1", amount: 120_000, name: "四月家賃" })]);
    const after = linkActualToPlan(before, "x1", planOf(before, "r:rent:2026-04-05"));

    /* 分類は予定から引き継ぐが、事実は実績のまま（§3.3 前書き） */
    expect(after.actuals[0]).toEqual({
      ...before.actuals[0],
      key: "r:rent:2026-04-05",
      unplanned: false,
    });
  });

  it("他の実績には触らない", () => {
    const before = base([
      actual({ id: "x1", amount: 120_000 }),
      actual({ id: "x2", amount: 3_000, date: "2026-04-11", name: "スーパー" }),
    ]);
    const after = linkActualToPlan(before, "x1", planOf(before, "r:rent:2026-04-05"));

    expect(after.actuals[1]).toEqual(before.actuals[1]);
  });

  it("元のデータを書き換えない", () => {
    const data = base([actual({ id: "x1" })]);
    const snapshot = structuredClone(data);

    linkActualToPlan(data, "x1", planOf(data, "r:rent:2026-04-05"));

    expect(data).toEqual(snapshot);
  });
});

/* ============ 分類は予定が持つ（AC-46） ============ */

describe("AC-46 候補の確定で分類を予定から引き継ぐ", () => {
  /** 予定は 地代家賃・固定費・事業0%。実績は別の分類で入力してある */
  const misfiled = actual({
    id: "x1",
    amount: 120_000,
    name: "ﾌﾘｺﾐ ｼﾞﾑｼｮﾔﾁﾝ",
    categoryCode: "EXP-20", // 雑費
    costType: "variable",
    bizRatio: 0,
  });

  const link = (a: Actual) => {
    const before = base([a]);
    return linkActualToPlan(before, a.id, planOf(before, "r:rent:2026-04-05"))
      .actuals[0];
  };

  it("手入力で別の費目を選んでいても引き継ぐ", () => {
    expect(link(misfiled)).toMatchObject({
      categoryCode: "EXP-01",
      costType: "fixed",
      bizRatio: 0,
    });
  });

  it("事業割合も引き継ぐ", () => {
    /* 予定は事業0%。実績に80%が入っていても予定に合わせる */
    expect(link({ ...misfiled, bizRatio: 80 }).bizRatio).toBe(0);
  });

  it("金額・日付・口座は実績の値を保つ", () => {
    const got = link({ ...misfiled, amount: 118_000, date: "2026-04-11" });

    expect(got).toMatchObject({
      amount: 118_000,
      date: "2026-04-11",
      accountId: "a1",
      name: "ﾌﾘｺﾐ ｼﾞﾑｼｮﾔﾁﾝ",
    });
  });

  it("「予定どおり」と同じ分類になる。経路で結果が変わらない", () => {
    const plan = planOf(base([misfiled]), "r:rent:2026-04-05");
    const viaLink = link(misfiled);
    const viaSettle = settleAsPlanned(base([]), plan, "y1").actuals[0];

    expect({
      categoryCode: viaLink.categoryCode,
      costType: viaLink.costType,
      bizRatio: viaLink.bizRatio,
    }).toEqual({
      categoryCode: viaSettle.categoryCode,
      costType: viaSettle.costType,
      bizRatio: viaSettle.bizRatio,
    });
  });

  /* ---------- 変わったことを画面に出す ---------- */

  it("変わった項目だけを文にする", () => {
    const plan = planOf(base([misfiled]), "r:rent:2026-04-05");

    expect(
      describeInheritance(plan.name, plan, classificationChanges(misfiled, plan)),
    ).toBe(
      "「家賃」に合わせて、費目を「地代家賃・住居費」、固定/変動を「固定費」に変えました。実績の編集から直せます。",
    );
  });

  it("何も変わらなければ知らせない", () => {
    const plan = planOf(base([misfiled]), "r:rent:2026-04-05");
    const same = actual({ id: "x2", categoryCode: "EXP-01", costType: "fixed", bizRatio: 0 });

    expect(classificationChanges(same, plan)).toEqual([]);
    expect(describeInheritance(plan.name, plan, [])).toBeNull();
  });

  it("事業割合だけが変わったときは事業割合だけを言う", () => {
    const plan = planOf(base([misfiled]), "r:rent:2026-04-05");
    const only = actual({ id: "x3", categoryCode: "EXP-01", costType: "fixed", bizRatio: 60 });

    expect(
      describeInheritance(plan.name, plan, classificationChanges(only, plan)),
    ).toBe("「家賃」に合わせて、事業割合を 0%に変えました。実績の編集から直せます。");
  });
});

/* ========================= 純関数であること ========================= */

describe("純関数であること", () => {
  it("同じ入力なら同じ順序で返る", () => {
    const data = base([
      actual({ id: "x2", date: "2026-04-06" }),
      actual({ id: "x1", date: "2026-04-05", amount: 3_000 }),
    ]);

    expect(found(data)).toEqual(found(data));
  });

  it("述語は単体でも使える", () => {
    const plan = series(base([])).unmatchedForecast[0];

    expect(isCandidate(actual({ id: "x1" }), plan)).toBe(true);
    expect(isCandidate(actual({ id: "x1", key: "k" }), plan)).toBe(false);
    expect(isCandidate(actual({ id: "x1", unplanned: true }), plan)).toBe(false);
  });
});

/* ========================= 候補は全件（AC-39） ========================= */

describe("AC-39 候補を全件提示する", () => {
  /**
   * CL-7 の「最初の1件」は自動確定のための規則であり、利用者に選ばせる
   * 場面では全件を並べるのが正しい。1件に絞ると、本当の相手が2件目だった
   * ときに選べない。
   */
  it("条件を満たす予定が2件あれば2件とも返す", () => {
    /* 同額・同口座の単発予定を2件、実績の前後に置く */
    const oneoffs = [
      {
        id: "o1",
        date: "2026-04-08",
        name: "電気代A",
        type: "expense" as const,
        costType: "variable" as const,
        categoryCode: "EXP-02",
        amount: 9_800,
        bizRatio: 0,
        accountId: "a1",
      },
      {
        id: "o2",
        date: "2026-04-12",
        name: "電気代B",
        type: "expense" as const,
        costType: "variable" as const,
        categoryCode: "EXP-02",
        amount: 9_800,
        bizRatio: 0,
        accountId: "a1",
      },
    ];
    const data = {
      ...base([actual({ id: "x1", date: "2026-04-10", amount: 9_800 })], []),
      oneoffs,
    };

    const got = found(data);

    expect(got).toHaveLength(1);
    expect(got[0].plans.map((c) => c.plan.key)).toEqual(["o:o1", "o:o2"]);
  });

  it("候補は日付の近い順に並ぶ", () => {
    const oneoffs = [
      {
        id: "far",
        date: "2026-04-01",
        name: "遠い",
        type: "expense" as const,
        costType: "variable" as const,
        categoryCode: "EXP-02",
        amount: 9_800,
        bizRatio: 0,
        accountId: "a1",
      },
      {
        id: "near",
        date: "2026-04-09",
        name: "近い",
        type: "expense" as const,
        costType: "variable" as const,
        categoryCode: "EXP-02",
        amount: 9_800,
        bizRatio: 0,
        accountId: "a1",
      },
    ];
    const data = {
      ...base([actual({ id: "x1", date: "2026-04-10", amount: 9_800 })], []),
      oneoffs,
    };

    expect(found(data)[0].plans.map((c) => c.dayGap)).toEqual([1, 9]);
  });
});

/* ========================= 予定にない支出（AC-38） ========================= */

describe("AC-38 予定にない支出", () => {
  it("unplanned を立てると候補が出なくなる", () => {
    const before = base([actual({ id: "x1" })]);
    expect(found(before)).toHaveLength(1);

    const after = setUnplanned(before, "x1", true);

    expect(found(after)).toEqual([]);
  });

  it("残高は変わらない。計算に影響しないフラグである", () => {
    const before = base([actual({ id: "x1", amount: 120_000 })]);
    const after = setUnplanned(before, "x1", true);

    /* 二重計上のままである。候補の提示を止めるだけで消し込みはしない */
    expect(closing(after)).toBe(closing(before));
  });

  it("取り消すと候補が戻る", () => {
    const data = setUnplanned(base([actual({ id: "x1" })]), "x1", true);

    expect(found(setUnplanned(data, "x1", false))).toHaveLength(1);
  });

  it("紐づけると unplanned は下りる", () => {
    const data = setUnplanned(base([actual({ id: "x1" })]), "x1", true);
    const after = linkActualToPlan(data, "x1", planOf(base([actual({ id: "x1" })]), "r:rent:2026-04-05"));

    expect(after.actuals[0].unplanned).toBe(false);
    expect(after.actuals[0].key).toBe("r:rent:2026-04-05");
  });

  it("他の実績には触らない", () => {
    const before = base([
      actual({ id: "x1" }),
      actual({ id: "x2", amount: 3_000, name: "スーパー" }),
    ]);
    const after = setUnplanned(before, "x1", true);

    expect(after.actuals[1]).toEqual(before.actuals[1]);
  });

  it("元のデータを書き換えない", () => {
    const data = base([actual({ id: "x1" })]);
    const snapshot = structuredClone(data);

    setUnplanned(data, "x1", true);

    expect(data).toEqual(snapshot);
  });
});
