import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { buildMonthlyCashflow } from "@/core/monthly";
import type {
  CardAccount,
  DepositAccount,
  OneoffItem,
  RecurringItem,
} from "@/core/types";

import {
  buildLedgerView,
  matchesKind,
  type LedgerKind,
  type LedgerStatus,
} from "../ledger";
import {
  customRange,
  DEFAULT_PRESET,
  presetRange,
  selectableMonths,
} from "../period";

/* ========================= 素材 ========================= */

const ASOF = "2026-04-01";
const TODAY = "2026-04-01";
const TO = "2027-06-30";

const bank: DepositAccount = {
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

const card: CardAccount = {
  id: "c1",
  name: "メインカード",
  kind: "card",
  balance: 0,
  closingDay: 15,
  payMonthOffset: 1,
  payDay: 10,
  settleAccountId: "a1",
};

function recurring(
  over: Partial<RecurringItem> & Pick<RecurringItem, "id" | "day">,
): RecurringItem {
  return {
    name: "項目",
    type: "expense",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 10_000,
    bizRatio: 0,
    accountId: "a1",
    months: null,
    active: true,
    ...over,
  };
}

/** 毎月のひととおりの動き */
const RECURRING: RecurringItem[] = [
  recurring({
    id: "inc",
    day: 25,
    name: "A社 業務委託料",
    type: "income",
    costType: null,
    categoryCode: "INC-01",
    amount: 450_000,
    accountId: "a2",
  }),
  recurring({
    id: "rent",
    day: 27,
    name: "家賃",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 120_000,
  }),
  recurring({
    id: "sub",
    day: 10,
    name: "サブスク",
    costType: "fixed",
    categoryCode: "EXP-19",
    amount: 4_300,
  }),
  recurring({
    id: "food",
    day: 15,
    name: "食費",
    costType: "variable",
    categoryCode: "EXP-21",
    amount: 68_000,
    accountId: "c1",
  }),
  recurring({
    id: "tr",
    day: 26,
    name: "生活費振替",
    type: "transfer",
    costType: null,
    categoryCode: "TRF-02",
    amount: 380_000,
    accountId: "a2",
    toAccountId: "a1",
  }),
];

function build(
  kind: LedgerKind,
  status: LedgerStatus,
  from: string,
  to: string,
  extra: {
    oneoffs?: OneoffItem[];
    overrides?: Record<string, object>;
    actuals?: Parameters<typeof buildBalanceSeries>[0]["actuals"];
    today?: string;
  } = {},
) {
  const today = extra.today ?? TODAY;
  const forecast = buildForecast(
    {
      recurring: RECURRING,
      oneoffs: extra.oneoffs ?? [],
      overrides: extra.overrides as never,
    },
    ASOF,
    TO,
  );
  const series = buildBalanceSeries(
    {
      accounts: [bank, jigyou, card],
      asOf: ASOF,
      forecast,
      actuals: extra.actuals ?? [],
    },
    TO,
    today,
  );
  const monthly = buildMonthlyCashflow(series, 600_000);
  return buildLedgerView({ series, monthly, from, to, kind, status, today });
}

const names = (view: ReturnType<typeof build>) =>
  view.groups.flatMap((g) => g.entries.map((e) => e.name));

/* ========================= AC-08 ========================= */

describe("AC-08 6ヶ月・固定費のみ・予定のみ", () => {
  const range = presetRange(6, ASOF, TODAY);

  it("6ヶ月のプリセットが今月から6ヶ月ぶんになる", () => {
    expect(range).toEqual({ from: "2026-04", to: "2026-09" });
  });

  it("該当する明細だけが月グループで表示される", () => {
    const view = build("fixed", "plan", range.from, range.to);

    // 6ヶ月ぶんの月グループ
    expect(view.groups.map((g) => g.yearMonth)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);

    // 固定費だけ。収入・変動費・振替・カード引落は出ない
    expect(new Set(names(view))).toEqual(new Set(["家賃", "サブスク"]));
  });

  it("ヘッダの合計が絞り込み後の値になる", () => {
    const view = build("fixed", "plan", range.from, range.to);

    // 家賃120,000 + サブスク4,300 を6ヶ月ぶん
    expect(view.total.count).toBe(12);
    expect(view.total.outflow).toBe((120_000 + 4_300) * 6);
    // 固定費だけなので入金は0
    expect(view.total.inflow).toBe(0);
  });

  it("絞り込むと合計が変わる", () => {
    const all = build("all", "all", range.from, range.to);
    const fixed = build("fixed", "plan", range.from, range.to);

    expect(all.total.count).toBeGreaterThan(fixed.total.count);
    expect(all.total.inflow).toBeGreaterThan(0);
    expect(fixed.total.inflow).toBe(0);
  });

  it("月グループの見出しは絞り込み後の件数と合計を持つ", () => {
    const view = build("fixed", "plan", range.from, range.to);
    const april = view.groups[0];

    expect(april.count).toBe(2);
    expect(april.outflow).toBe(124_300);
    expect(april.inflow).toBe(0);
  });

  it("月末残高と月中最低は絞り込みに関わらず残高の事実を出す", () => {
    const fixed = build("fixed", "plan", range.from, range.to);
    const all = build("all", "all", range.from, range.to);

    expect(fixed.groups[0].closing).toBe(all.groups[0].closing);
    expect(fixed.groups[0].lowest).toBe(all.groups[0].lowest);
  });
});

/* ========================= 種別フィルタ ========================= */

describe("種別フィルタ（§4.2）", () => {
  const from = "2026-04";
  const to = "2026-04";

  it("すべて", () => {
    // カード引落は4月には無い。4/15 の食費は 15 <= 15 で4月締め、翌月払いで 5/10
    const view = build("all", "all", from, to);
    expect(new Set(names(view))).toEqual(
      new Set(["A社 業務委託料", "家賃", "サブスク", "生活費振替"]),
    );
  });

  it("入金", () => {
    expect(new Set(names(build("income", "all", from, to)))).toEqual(
      new Set(["A社 業務委託料"]),
    );
  });

  it("固定費", () => {
    expect(new Set(names(build("fixed", "all", from, to)))).toEqual(
      new Set(["家賃", "サブスク"]),
    );
  });

  it("変動費（カード払いの食費は明細に出ない）", () => {
    // 食費はカード払いなので、利用日ではなく引落として現れる
    expect(names(build("variable", "all", from, to))).toEqual([]);
  });

  it("カード引落", () => {
    // 4/15 の食費（4月締め）が 5/10 に引き落ちる
    expect(names(build("settle", "all", from, to))).toEqual([]);
    expect(new Set(names(build("settle", "all", "2026-05", "2026-05")))).toEqual(
      new Set(["メインカード 引落"]),
    );
  });

  it("振替", () => {
    expect(new Set(names(build("transfer", "all", from, to)))).toEqual(
      new Set(["生活費振替"]),
    );
  });

  it("借入返済の元金（TRF-06）は振替に入る", () => {
    // type = expense だが資金移動なので、振替フィルタで拾う
    const principal = {
      key: "l:1",
      date: "2026-04-27",
      name: "返済（元金）",
      type: "expense" as const,
      costType: null,
      categoryCode: "TRF-06",
      amount: 82_000,
      bizRatio: 0,
      accountId: "a1",
      src: "oneoff" as const,
    };

    expect(matchesKind(principal, "transfer")).toBe(true);
    expect(matchesKind(principal, "fixed")).toBe(false);
    expect(matchesKind(principal, "variable")).toBe(false);
    expect(matchesKind(principal, "settle")).toBe(false);
    expect(matchesKind(principal, "all")).toBe(true);
  });

  it("すべての行がいずれかのフィルタに掛かる", () => {
    const all = build("all", "all", "2026-04", "2026-09");
    const covered = new Set<string>();
    for (const kind of ["income", "fixed", "variable", "settle", "transfer"] as const) {
      for (const e of build(kind, "all", "2026-04", "2026-09").groups.flatMap(
        (g) => g.entries,
      )) {
        covered.add(`${e.key}@${e.date}`);
      }
    }
    const every = all.groups
      .flatMap((g) => g.entries)
      .map((e) => `${e.key}@${e.date}`);

    expect(every.filter((k) => !covered.has(k))).toEqual([]);
  });
});

/* ========================= 状態フィルタ ========================= */

describe("状態フィルタ（§4.2）", () => {
  const actual = {
    id: "act1",
    key: "r:rent:2026-04-27",
    date: "2026-04-27",
    name: "家賃",
    type: "expense" as const,
    costType: "fixed" as const,
    categoryCode: "EXP-01",
    amount: 118_000,
    bizRatio: 0,
    accountId: "a1",
  };

  function withActual(status: LedgerStatus) {
    const forecast = buildForecast(
      { recurring: RECURRING, oneoffs: [] },
      ASOF,
      TO,
    );
    const series = buildBalanceSeries(
      { accounts: [bank, jigyou, card], asOf: ASOF, forecast, actuals: [actual] },
      TO,
      TODAY,
    );
    const monthly = buildMonthlyCashflow(series, 600_000);
    return buildLedgerView({
      series,
      monthly,
      from: "2026-04",
      to: "2026-04",
      kind: "all",
      status,
      today: TODAY,
    });
  }

  it("予定+実績は両方出る", () => {
    const view = withActual("all");
    const rent = view.groups[0].entries.filter((e) => e.name === "家賃");

    expect(rent).toHaveLength(1);
    expect(rent[0].status).toBe("actual");
    expect(rent[0].amount).toBe(118_000);
  });

  it("実績のみは実績だけ", () => {
    const view = withActual("actual");

    expect(names(view)).toEqual(["家賃"]);
    expect(view.groups[0].entries[0].status).toBe("actual");
  });

  it("予定のみは実績を外す", () => {
    const view = withActual("plan");

    expect(names(view)).not.toContain("家賃");
    expect(
      view.groups[0].entries.every((e) => e.status === "plan"),
    ).toBe(true);
  });

  it("消し込み済みの予定は重複しない", () => {
    const view = withActual("all");
    const rent = view.groups[0].entries.filter((e) => e.name === "家賃");

    expect(rent).toHaveLength(1);
  });
});

/* ========================= 明細の中身 ========================= */

describe("明細の列（§4.2）", () => {
  it("その日の残高を持つ", () => {
    const view = build("all", "all", "2026-04", "2026-04");
    const sub = view.groups[0].entries.find((e) => e.name === "サブスク")!;

    // 4/10 の引落（未払0なので無し）と 4/10 のサブスク
    expect(sub.balance).toBe(1_500_000 - 4_300);
  });

  it("日付昇順に並ぶ", () => {
    const view = build("all", "all", "2026-04", "2026-05");
    const dates = view.groups.flatMap((g) => g.entries.map((e) => e.date));

    expect(dates).toEqual([...dates].sort());
  });

  it("カード引落は繰延できない", () => {
    const view = build("settle", "all", "2026-05", "2026-05");
    const settle = view.groups[0].entries[0];

    expect(settle.src).toBe("settle");
    expect(settle.editable).toBe(false);
  });

  it("予定は繰延できる", () => {
    const view = build("fixed", "plan", "2026-04", "2026-04");

    expect(view.groups[0].entries.every((e) => e.editable)).toBe(true);
  });
});

/* ========================= 繰延の表示 ========================= */

describe("繰延の表示（§4.2）", () => {
  it("繰延した行に元の日付が付く", () => {
    const view = build("fixed", "plan", "2026-04", "2026-05", {
      overrides: { "r:rent:2026-04-27": { date: "2026-05-08" } },
    });

    const moved = view.groups
      .flatMap((g) => g.entries)
      .find((e) => e.key === "r:rent:2026-04-27")!;

    expect(moved.date).toBe("2026-05-08");
    expect(moved.deferred).toBe(true);
    expect(moved.origDate).toBe("2026-04-27");
  });

  it("繰延していない行には印を付けない", () => {
    const view = build("fixed", "plan", "2026-04", "2026-04");

    expect(view.groups[0].entries.every((e) => !e.deferred)).toBe(true);
    expect(view.groups[0].entries.every((e) => e.origDate === undefined)).toBe(
      true,
    );
  });
});

/* ========================= 月グループの見出し ========================= */

describe("月グループの見出し（§4.2）", () => {
  it("警告のある月に注記が付く", () => {
    const forecast = buildForecast(
      {
        recurring: [
          recurring({ id: "big", day: 10, amount: 1_400_000, accountId: "a1" }),
        ],
        oneoffs: [],
      },
      ASOF,
      "2026-04-30",
    );
    const series = buildBalanceSeries(
      { accounts: [bank], asOf: ASOF, forecast, actuals: [] },
      "2026-04-30",
      TODAY,
    );
    const monthly = buildMonthlyCashflow(series, 600_000);
    const view = buildLedgerView({
      series,
      monthly,
      from: "2026-04",
      to: "2026-04",
      kind: "all",
      status: "all",
      today: TODAY,
    });

    expect(view.groups[0].warning).toEqual({
      kind: "shortfall",
      date: "2026-04-10",
      balance: -400_000,
    });
  });

  it("明細が無い月はグループを作らない", () => {
    const view = build("income", "all", "2026-04", "2026-06");

    // 収入は毎月あるので3グループ
    expect(view.groups).toHaveLength(3);
  });

  it("該当が無ければ空", () => {
    const view = build("variable", "all", "2026-04", "2026-04");

    expect(view.groups).toEqual([]);
    expect(view.total).toEqual({ count: 0, inflow: 0, outflow: 0 });
  });
});

/* ========================= 期間の指定 ========================= */

describe("期間の指定（§4.2）", () => {
  it("プリセットは今月起点", () => {
    expect(presetRange(1, ASOF, TODAY)).toEqual({ from: "2026-04", to: "2026-04" });
    expect(presetRange(3, ASOF, TODAY)).toEqual({ from: "2026-04", to: "2026-06" });
    expect(presetRange(6, ASOF, TODAY)).toEqual({ from: "2026-04", to: "2026-09" });
    expect(presetRange(12, ASOF, TODAY)).toEqual({ from: "2026-04", to: "2027-03" });
  });

  it("今日が基準日より後ならそこから始まる", () => {
    expect(presetRange(3, ASOF, "2026-07-15")).toEqual({
      from: "2026-07",
      to: "2026-09",
    });
  });

  it("予測の終端を超えない", () => {
    const months = selectableMonths(ASOF);
    const last = months.at(-1)!;

    expect(presetRange(12, ASOF, `${last}-01`).to).toBe(last);
  });

  it("任意指定は逆順でも受け付ける", () => {
    expect(customRange("2026-09", "2026-04")).toEqual({
      from: "2026-04",
      to: "2026-09",
    });
  });

  it("選べる月は基準日の月から予測の終端まで", () => {
    const months = selectableMonths(ASOF);

    expect(months[0]).toBe("2026-04");
    expect(months).toHaveLength(25);
    expect(months.at(-1)).toBe("2028-04");
  });
});

/* ========================= AC-22 既定期間 ========================= */

describe("AC-22 既定の表示範囲は「先月〜6ヶ月先」", () => {
  it("既定のプリセットは recent", () => {
    expect(DEFAULT_PRESET).toBe("recent");
  });

  it("先月から始まり、6ヶ月プリセットと同じ終端になる", () => {
    /* 基準日 2026-04-01、今日 2026-07-15。先月＝2026-06 */
    const got = presetRange("recent", ASOF, "2026-07-15");

    expect(got).toEqual({ from: "2026-06", to: "2026-12" });
    /* 先の広さは 6ヶ月プリセットと揃える。切り替えたときに
       何が変わったのか分かるようにするため */
    expect(got.to).toBe(presetRange(6, ASOF, "2026-07-15").to);
  });

  /**
   * 案A。基準日より前は残高が計算できないため、遡りは基準日の月で止める
   * （要件定義書 §4.2「基準日以降の任意の過去月」）。
   */
  it("先月が基準日より前なら、基準日の月に寄せる", () => {
    /* 基準日と今日が同じ月。先月は存在しない */
    expect(presetRange("recent", ASOF, TODAY)).toEqual({
      from: "2026-04",
      to: "2026-09",
    });
  });

  it("今日が基準日より後でも、遡りは基準日を割らない", () => {
    /* 今日が基準日の翌月。先月＝基準日の月ちょうど */
    expect(presetRange("recent", ASOF, "2026-05-10").from).toBe("2026-04");
  });

  it("予測の終端を超えない", () => {
    const last = selectableMonths(ASOF).at(-1)!;

    expect(presetRange("recent", ASOF, `${last}-01`).to).toBe(last);
  });

  it("数値のプリセットは今月起点のまま変わらない", () => {
    expect(presetRange(1, ASOF, "2026-07-15")).toEqual({
      from: "2026-07",
      to: "2026-07",
    });
    expect(presetRange(6, ASOF, "2026-07-15").from).toBe("2026-07");
  });
});

/* ========================= AC-23 未入力の強調 ========================= */

describe("AC-23 過去に残った未消込の予定", () => {
  /** 今日を 2026-06-20 にすると、4月・5月と6/10 までが過去になる */
  const NOW = "2026-06-20";

  it("今日より前の未消込の予定に印が付く", () => {
    const view = build("fixed", "all", "2026-04", "2026-06", { today: NOW });
    const overdue = view.groups
      .flatMap((g) => g.entries)
      .filter((e) => e.overdue);

    expect(overdue.length).toBeGreaterThan(0);
    for (const entry of overdue) {
      expect(entry.date < NOW).toBe(true);
      expect(entry.status).toBe("plan");
    }
  });

  it("今日以降の予定には印が付かない", () => {
    const view = build("all", "all", "2026-06", "2026-09", { today: NOW });
    const future = view.groups
      .flatMap((g) => g.entries)
      .filter((e) => e.date >= NOW);

    expect(future.every((e) => !e.overdue)).toBe(true);
  });

  it("消し込み済みなら印が付かない", () => {
    const settled = {
      id: "act1",
      key: "r:rent:2026-04-27",
      date: "2026-04-27",
      name: "家賃",
      type: "expense" as const,
      costType: "fixed" as const,
      categoryCode: "EXP-01",
      amount: 118_000,
      bizRatio: 0,
      accountId: "a1",
    };
    const view = build("fixed", "all", "2026-04", "2026-04", {
      today: NOW,
      actuals: [settled],
    });
    const rent = view.groups[0].entries.filter((e) => e.name === "家賃");

    expect(rent).toHaveLength(1);
    expect(rent[0].status).toBe("actual");
    expect(rent[0].overdue).toBe(false);
  });

  /**
   * カード引落は CL-2 の生成物で、ダッシュボードの「実績が未入力の予定」
   * （unmatchedForecast）にも含まれない。同じ画面で「未入力」の数え方が
   * 2通りあると照合できなくなるため、ここでも数えない。
   */
  it("カード引落は未入力に数えない", () => {
    const view = build("settle", "all", "2026-04", "2026-06", { today: NOW });
    const settles = view.groups.flatMap((g) => g.entries);

    expect(settles.length).toBeGreaterThan(0);
    expect(settles.every((e) => !e.overdue)).toBe(true);
  });

  it("月グループが過去かどうかと、実績・未入力の件数を持つ", () => {
    const view = build("fixed", "all", "2026-04", "2026-07", { today: NOW });
    const april = view.groups.find((g) => g.yearMonth === "2026-04")!;
    const july = view.groups.find((g) => g.yearMonth === "2026-07")!;

    expect(april.past).toBe(true);
    expect(april.overdueCount).toBe(april.entries.filter((e) => e.overdue).length);
    expect(april.overdueCount).toBeGreaterThan(0);

    expect(july.past).toBe(false);
    expect(july.overdueCount).toBe(0);
  });

  it("当月は過去月として扱わない", () => {
    const view = build("fixed", "all", "2026-06", "2026-06", { today: NOW });

    expect(view.groups[0].past).toBe(false);
  });
});
