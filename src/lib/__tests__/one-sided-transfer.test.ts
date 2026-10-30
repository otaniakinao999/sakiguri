import { describe, expect, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildMonthlyCashflow } from "@/core/monthly";
import type { Account, Actual } from "@/core/types";
import { buildCashflowViewModel } from "@/components/cashflow/cashflow-view-model";
import { buildLedgerView } from "@/lib/ledger";

/**
 * 閉じない振替が、合計残高を動かさないこと（CL-3 手順6）
 *
 * **単体で0でも足りない。** `accountDelta` が0を返しても、系列・明細・
 * 画面のどこかで別の足し方をしていれば合計はずれる。ここは経路を通す。
 *
 * 元になった不具合：振替先が未設定の実績が14件（¥2,389,980）入っていて、
 * 出ていく側だけが効いて合計が減っていた。**画面上は普通の振替に見える**
 * ので、1か月半のあいだ目視では見つからなかった。
 *
 * 入力側は塞いだが、定期項目・単発項目は即時保存で止める場所が無く、
 * CSV取込や過去データからも同じ状態が入りうる。**最後に受けるのがここ。**
 */

const accounts: Account[] = [
  { id: "bank", name: "銀行", kind: "bank", balance: 1_000_000 },
  { id: "cash", name: "現金", kind: "cash", balance: 100_000 },
  {
    id: "card",
    name: "カード",
    kind: "card",
    balance: 50_000,
    unbilledBalance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 27,
    settleAccountId: "bank",
  },
];

const transfer = (over: Partial<Actual>): Actual => ({
  id: "t1",
  date: "2026-10-05",
  name: "ＡＴＭ",
  amount: 30_000,
  type: "transfer",
  costType: null,
  categoryCode: "TRF-01",
  accountId: "bank",
  key: null,
  unplanned: false,
  bizRatio: 0,
  ...over,
});

function run(actuals: Actual[]) {
  const series = buildBalanceSeries(
    { accounts, asOf: "2026-10-01", forecast: [], actuals },
    "2026-10-31",
    "2026-10-31",
  );
  const row = series.rows.find((r) => r.date === "2026-10-10")!;
  const monthly = buildMonthlyCashflow(series, 0);
  const view = buildLedgerView({
    series,
    monthly,
    from: "2026-10",
    to: "2026-10",
    kind: "all",
    status: "all",
    today: "2026-10-31",
  });
  const model = buildCashflowViewModel({
    series,
    monthly,
    view,
    from: "2026-10-01",
    to: "2026-10-31",
    today: "2026-10-31",
    reserveLine: 0,
    stats: [],
  });
  const entries = view.groups.flatMap((g) => g.entries);
  return {
    total: row.proj,
    byAccount: { ...row.byAccount },
    entry: entries.find((e) => e.name === "ＡＴＭ"),
    ledgerRow: model.ledger.find((r) => r.title === "ＡＴＭ"),
  };
}

const baseline = run([]);

describe("閉じない振替は合計残高を動かさない", () => {
  it("振替先が未設定。口座別も動かない", () => {
    const broken = run([transfer({ toAccountId: undefined })]);
    expect(broken.total).toBe(baseline.total);
    expect(broken.byAccount).toEqual(baseline.byAccount);
  });

  it("振替先がカード（カードは合計に入らない）", () => {
    expect(run([transfer({ toAccountId: "card" })]).total).toBe(baseline.total);
  });

  it("出金元がカード。合計が増えるほうも塞ぐ", () => {
    expect(run([transfer({ accountId: "card", toAccountId: "bank" })]).total).toBe(
      baseline.total,
    );
  });

  /** **効きすぎていないこと。** 正しい振替まで止めたら、留め具ではなく不具合 */
  it("閉じる振替は、合計は動かず口座は動く", () => {
    const ok = run([transfer({ toAccountId: "cash" })]);
    expect(ok.total).toBe(baseline.total);
    expect(ok.byAccount.bank).toBe(baseline.byAccount.bank - 30_000);
    expect(ok.byAccount.cash).toBe(baseline.byAccount.cash + 30_000);
  });
});

describe("反映していないことが画面に出る", () => {
  /* 黙って効かないのが一番危ない。金額のある行で残高が動かない理由を出す */
  /**
   * **理由ごとに文を変える。** 以前は1文しか無く、振替先がカードの行にも
   * 「振替先が未設定です」と出ていた（設定されているのに）。直す場所が
   * 違うのに同じ文だと、どこを直せばいいか分からない。
   */
  it.each([
    ["振替先が未設定", { toAccountId: undefined }, "noDestination",
      "振替先が未設定です（残高に反映していません）"],
    ["振替先がカード", { toAccountId: "card" }, "destinationOutside",
      "振替先がカードです（残高に反映していません）"],
    ["出金元がカード", { accountId: "card", toAccountId: "bank" }, "sourceOutside",
      "出金元がカードです（残高に反映していません）"],
  ])("%s：理由と文が一致する", (_label, over, reason, note) => {
    const broken = run([transfer(over as Partial<Actual>)]);
    expect(broken.entry?.oneSided).toBe(reason);
    expect(broken.ledgerRow?.note).toBe(note);
  });

  it("金額は消さない", () => {
    const broken = run([transfer({ toAccountId: undefined })]);
    expect(broken.ledgerRow?.amount).toBe(30_000);
  });

  it("閉じる振替は従来の注記のまま", () => {
    const ok = run([transfer({ toAccountId: "cash" })]);
    expect(ok.entry?.oneSided).toBeNull();
    expect(ok.ledgerRow?.note).toBe("合計残高は増減なし");
  });
});
