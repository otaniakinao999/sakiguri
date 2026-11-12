/**
 * キャッシュフローの数字を CashflowView の props に移す（SC-03）
 *
 * 一次情報：docs/要件定義書.md §4.1 SC-03・§4.2、docs/design/screens.md 02
 *
 * **純関数にしてある。** 本番の画面は Supabase に繋がないと開けないので、
 * ここに出していないと配線を目視でしか確かめられない。ダッシュボードと
 * 同じ形（dashboard-view-model.ts）。React を import しない。
 */

import { buildAccountDaily } from "@/core/account-daily";
import type { BalanceSeries, OneSidedReason } from "@/core/balance";
import type { MonthlyCashflowRow } from "@/core/monthly";
import {
  accountNames,
  formatTransferDirection,
} from "@/core/transfer-direction";
import type { Account, DateStr, Yen } from "@/core/types";
import { amountView } from "@/components/sakiguri/amount-view";
import { categoryTagFor, type Category } from "@/components/sakiguri/CategoryTag";
import type { MonthlyBalancePoint } from "@/components/sakiguri/MonthlyBalanceChart";
import type { PageHeaderStat } from "@/components/sakiguri/PageHeader";
import { buildForecastPoints, msOf } from "@/lib/forecast-points";
import {
  formatMonthDay,
  formatYearMonthLabel,
  formatYen,
} from "@/lib/format";
import type { LedgerEntry, LedgerView } from "@/lib/ledger";
import { planSettingsHref } from "@/lib/plan-anchor";

import type {
  CashflowDaily,
  CashflowLedgerEntry,
  CashflowMonthRow,
} from "./CashflowView";

export interface CashflowViewModel {
  stats: PageHeaderStat[];
  chart: {
    points: ReturnType<typeof buildForecastPoints>;
    todayT: number;
    /** 口座別に見ているときは null */
    defenseLine: Yen | null;
  };
  months: CashflowMonthRow[];
  monthsNote: string;
  /** 残高推移の「月次」。日次とは出すものが違う（棒と月中の最低を重ねる） */
  monthlyChart: MonthlyBalancePoint[];
  /** 口座を選んでいるときの日別（FR-64・AC-71）。合計のときは null */
  accountDaily: CashflowDaily | null;
  ledger: CashflowLedgerEntry[];
  /**
   * 明細の月へ飛ぶための見出し（要望9）。
   *
   * **`ledger` と同じループで作る。** 別に組み立てると、片方の月だけ
   * 増えたり id がずれたりして「押しても飛ばない見出し」ができる。
   * ここの `id` は必ず `ledger` の区切り行の `id` と一致する。
   */
  ledgerMonths: Array<{ id: string; label: string }>;
  /** 見出しに出す絞り込み後の合計（要件定義書 §4.2 集計） */
  total: { count: number; inflow: Yen; outflow: Yen };
}

export interface CashflowViewModelInput {
  series: BalanceSeries;
  monthly: readonly MonthlyCashflowRow[];
  /** 資金移動の向きに出す口座名（FR-63・AC-70）。日別の期首残高にも使う */
  accounts: readonly Account[];
  /**
   * 見ている口座（FR-64）。合計を見ているときは null。
   *
   * **`scope` とは別に受け取る。** あちらは集合で、日別は1口座ぶんしか
   * 出さない（2口座を足した「日ごとの残高」は出納帳と突き合わない）。
   */
  accountId: string | null;
  /** 期間で絞ったあとの明細（lib/ledger の出力） */
  view: LedgerView;
  /** 表示する期間。グラフの横幅もこれに従う */
  from: DateStr;
  to: DateStr;
  today: DateStr;
  /** 生活防衛ライン。**口座別に見ているときは null**（合計に対する額なので） */
  reserveLine: Yen | null;
  /** PageHeader の残高サマリー。buildHeaderStats が作る */
  stats: PageHeaderStat[];
}

/**
 * 明細1行の区分。
 *
 * **カード引落は `src` で決める。** CL-2 の生成物で、元の費目は
 * 引落にまとめられた個々の利用のものだから、費目から引くと
 * 「固定費」などになってしまう。Figma 2030:471 は実際にそうなっていて、
 * その区分だとフィルターの「カード引落」が1件も拾わない（ADR-0023）。
 */
function categoryOfEntry(entry: LedgerEntry): Category | null {
  if (entry.src === "settle") return "カード引落";
  return categoryTagFor(entry.categoryCode, entry.costType);
}

/**
 * 備考（screens.md 02「備考欄の例」）。
 *
 * **1行に1つだけ出す。** 重なることがあるので、利用者が次に何をするかに
 * 効く順に優先する：直せない行であること → 日付が動いていること →
 * 残高が動かないこと。
 *
 * `overdue` は screens.md に載っていないが、要件定義書 §4.2「過去月の表示」
 * が求めている状態で、落とすと「予定のまま残っている」ことが画面から
 * 消える。語はダッシュボードの「実績が未入力の予定」に合わせた（§2.12）。
 */
/**
 * 閉じない振替の注記。**理由ごとに違う文を出す。**
 *
 * 以前は1文（「振替先が未設定です」）しか無く、**振替先がカードの行にも
 * それが出ていた**（設定されているのに未設定と書かれる）。直すべき場所が
 * 違うのに同じ文だと、どこを直せばいいか分からない。
 */
const ONE_SIDED_NOTE: Record<OneSidedReason, string> = {
  noDestination: "振替先が未設定です（残高に反映していません）",
  destinationOutside: "振替先がカードです（残高に反映していません）",
  sourceOutside: "出金元がカードです（残高に反映していません）",
};

function noteOf(entry: LedgerEntry): string | undefined {
  /* **`editable` で判定しない。** あれは「繰延できるか」で、実績も
     false になる（実績は済んだ事実なので日付をずらせない）。それで
     判定すると、CSV から入った実績に「自動で作られる行」と出る。
     生成行かどうかは `src` が持っている */
  if (entry.src === "settle") return "自動で作られる行（編集できません）";
  if (entry.deferred && entry.origDate) {
    return `繰延（元の日付 ${formatMonthDay(entry.origDate)}）`;
  }
  if (entry.overdue) return "実績が未入力";
  /* **「増減なし」より先に出す。** 閉じない振替は合計を動かさないが、
     それは「振替だから」ではなく「反映できていないから」である。
     同じ文言にすると、直すべき行が正常な行に紛れる。
     **理由ごとに書き分ける。** 直す場所が違うため（§4.1 の考え方と同じ）。 */
  if (entry.oneSided) return ONE_SIDED_NOTE[entry.oneSided];
  if (entry.type === "transfer") return "合計残高は増減なし";
  return undefined;
}

export function buildCashflowViewModel({
  series,
  monthly,
  accounts,
  accountId,
  view,
  from,
  to,
  today,
  reserveLine,
  stats,
}: CashflowViewModelInput): CashflowViewModel {
  const months: CashflowMonthRow[] = monthly.map((m) => ({
    label: formatYearMonthLabel(m.yearMonth),
    income: m.inflow,
    expense: m.outflow,
    endBalance: m.closing,
    lowest: m.lowest,
    /* 月末がプラスでも月中に割る月がある。だから closing ではなく warning */
    highlight: m.warning !== null,
  }));

  /* 月次のグラフ。実績はその月の**最後に実績がある日**の残高を取る。
     **月の最終日を見ない。** 今月は月末がまだ来ていないので act が
     null になり、実績の線が1点だけになって描かれない（旧 BalanceChart が
     そうなっていた）。実績が尽きた月から先は null で線が切れる */
  const monthlyChart: MonthlyBalancePoint[] = monthly.map((m) => ({
    label: formatYearMonthLabel(m.yearMonth),
    closing: m.closing,
    actual:
      series.rows
        .filter((row) => row.date.startsWith(m.yearMonth) && row.act !== null)
        .at(-1)?.act ?? null,
    inflow: m.inflow,
    outflow: m.outflow,
    lowest: m.lowest,
  }));

  const breached = months.filter((m) => m.highlight).map((m) => m.label);
  const monthsNote =
    breached.length === 0
      ? reserveLine === null
        ? "口座を選んでいるあいだ、生活防衛ラインは出しません。現預金の合計に対して決めた額なので、1口座の残高と比べても意味を持たないためです。"
        : "月末がプラスでも、月中に生活防衛ラインを割る月は色が変わります。"
      : `月末がプラスでも、月中に生活防衛ラインを割る月は色が変わります（${breached.join("・")}）。`;

  /* 月グループは畳んで1枚の表にする。月の区切りは行で入れる（下の
     groupLabel）。Figma 2030:348 は9月と10月が区切り無しで続いているが、
     要件定義書 §4.2 は月ごとのまとまりを求めている */
  /**
   * 向きの表示（FR-63・AC-70）。
   *
   * **この画面がいちばん要る。** 合計で見ているときは閉じる振替の
   * delta が0なので符号が付かず（AC-58b。それ自体は正しい）、
   * 向きが出ていないと引出しと預け入れの区別が付かない。
   * 2026-11-12 に 46,000円 ずれたのはこの状態だった（制約11）。
   *
   * **備考の列には入れない。** あちらは1行に1つしか出せず、繰延や
   * 未入力が先に取る（`noteOf`）。向きは落ちてはいけない。
   */
  const names = accountNames(accounts);

  const ledger: CashflowLedgerEntry[] = [];
  const ledgerMonths: CashflowViewModel["ledgerMonths"] = [];
  for (const group of view.groups) {
    const groupId = `group-${group.yearMonth}`;
    ledgerMonths.push({ id: groupId, label: formatYearMonthLabel(group.yearMonth) });
    ledger.push({
      id: groupId,
      groupLabel: formatYearMonthLabel(group.yearMonth),
      closing: group.closing,
      lowest: group.lowest,
      date: "",
      title: "",
      amount: 0,
      display: { value: 0, signed: false, type: "neutral" },
      category: null,
      status: "予定",
    });
    group.entries.forEach((entry, i) => {
      const category = categoryOfEntry(entry);
      /* **符号は残高の動きから、色は費目から**（AC-58b）。判定は
         `amountView` の1箇所 ―― もとはここに「振替なら符号なし」を
         書いていて、片側だけ記録した振替で破れていた */
      ledger.push({
        id: `${group.yearMonth}-${i}-${entry.key ?? entry.srcId ?? entry.src}`,
        date: formatMonthDay(entry.date),
        title: entry.name,
        amount: entry.amount,
        display: amountView({ amount: entry.amount, delta: entry.delta, category }),
        direction: formatTransferDirection(entry, names) ?? undefined,
        category,
        balance: entry.balance,
        status: entry.status === "actual" ? "実績" : "予定",
        note: noteOf(entry),
        actualId: entry.status === "actual" ? entry.srcId : undefined,
        /* 予定の行は、元の定期項目・単発予定の設定へ飛ばす（FR-57・AC-63）。
           カード引落（`settle`）は CL-2 の生成物で元の設定が無いので飛ばさない */
        planHref:
          entry.status === "plan" &&
          (entry.src === "recurring" || entry.src === "oneoff") &&
          entry.srcId
            ? planSettingsHref(entry.src, entry.srcId)
            : undefined,
      });
    });
  }

  /**
   * 口座の日ごとの増減と残高（FR-64・AC-71）。
   *
   * **明細の絞り込み（`view`）を通さない。** 種別や状態で絞ると増減の
   * 合計が「期末 − 期首」と合わなくなり、留め具が意味を失う。
   * 期間はグラフと同じ `from` / `to` に揃える。
   */
  const accountDaily = buildDaily(series, accounts, accountId, from, to);

  return {
    stats,
    accountDaily,
    chart: {
      points: buildForecastPoints(series.rows, series.actualEnd, from, to),
      todayT: msOf(today),
      defenseLine: reserveLine,
    },
    months,
    monthsNote,
    monthlyChart,
    ledger,
    ledgerMonths,
    total: view.total,
  };
}

/**
 * 日別の表（FR-64）。口座を選んでいなければ null。
 *
 * **件数を出す。** 増減が0の日があるため ―― 残高に反映していない振替
 * （振替先が未設定・カード）は明細に在るのに残高を動かさない。件数が
 * 無いと「この日は何も無い」と読まれる。
 *
 * **予定の件数を併記する。** 残高は予測系列から取る（AC-49a）ので、
 * 未記録の予定がある日から先は出納帳と食い違う。その理由が読めるように
 * しておく。
 */
function buildDaily(
  series: BalanceSeries,
  accounts: readonly Account[],
  accountId: string | null,
  from: DateStr,
  to: DateStr,
): CashflowDaily | null {
  if (accountId === null) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  const daily = buildAccountDaily({ series, accounts, accountId, from, to });
  return {
    accountName: account.name,
    opening: daily.opening,
    closing: daily.closing,
    total: daily.total,
    gap: daily.gap,
    rows: daily.rows.map((row) => ({
      date: formatMonthDay(row.date),
      delta: row.delta,
      balance: row.balance,
      note:
        row.planCount === 0
          ? `${row.count}件`
          : `${row.count}件（予定${row.planCount}件）`,
    })),
  };
}

/** 見出しに出す集計の文（要件定義書 §4.2）。 */
export function formatLedgerTotal(total: CashflowViewModel["total"]): string {
  return `${total.count}件 ／ 入金 ${formatYen(total.inflow)} ／ 出金 ${formatYen(-total.outflow)}`;
}
