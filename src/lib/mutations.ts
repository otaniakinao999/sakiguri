/**
 * アプリの状態の更新
 *
 * 一次情報：docs/要件定義書.md §3.1 FR-02・FR-03・FR-05・FR-06・FR-07
 *
 * すべて純関数。`AppData` を受け取り、新しい `AppData` を返す。
 * 元のオブジェクトを書き換えない。
 */

import { categoriesInGroup } from "@/core/categories";
import { applyClassification } from "@/core/classification";
import type {
  Account,
  Actual,
  DateStr,
  ForecastInstance,
  OneoffItem,
  Override,
  RecurringItem,
  Yen,
} from "@/core/types";

import type { AppData } from "./app-data";

/** 新しい識別子。 */
export function newId(): string {
  return crypto.randomUUID();
}

/* ========================= 設定（SC-07） ========================= */

/**
 * 基準日を変える。
 *
 * 基準日を**後ろにずらす**操作の是非（要件定義書 §8 OI-6）は PoC の
 * 範囲外として保留にしてある。ここでは値を差し替えるだけで、
 * 締め処理は行わない。
 */
export function setAsOf(data: AppData, asOf: DateStr): AppData {
  return { ...data, asOf };
}

export function setReserveLine(data: AppData, reserveLine: Yen): AppData {
  return { ...data, reserveLine };
}

/**
 * 消し込み操作を行った日を記録する（FR-43、AC-29a）。
 *
 * 「利用者が消し込みに向き合った」ことを表す。成果の有無で区別しないため、
 * **照合が1件も成立しなかったCSV取込でも書き込む。**
 *
 * 書き込みは best-effort であり、これが失敗しても消し込みそのものを
 * 巻き戻さない。警告のための補助情報が、実際の記録より優先されてはならない。
 * 保存は差分保存（diff.ts）に乗るので、失敗しても次の変更で送り直される。
 */
export function markReconciled(data: AppData, on: DateStr): AppData {
  return { ...data, lastReconciledAt: on };
}

/* ========================= 口座・カード（FR-01） ========================= */

export function addAccount(data: AppData, account: Account): AppData {
  return { ...data, accounts: [...data.accounts, account] };
}

export function updateAccount(
  data: AppData,
  id: string,
  patch: Partial<Account>,
): AppData {
  return {
    ...data,
    accounts: data.accounts.map((a) =>
      a.id === id ? ({ ...a, ...patch } as Account) : a,
    ),
  };
}

/**
 * 口座を消す。
 *
 * その口座を指している予定・実績も一緒に消す。残しておくと、
 * CL-2 が「イベントの口座が見つかりません」で落ちるため。
 * カードを消すときは、そのカードを引落元にしている設定も外す。
 */
export function removeAccount(data: AppData, id: string): AppData {
  return {
    ...data,
    accounts: data.accounts
      .filter((a) => a.id !== id)
      .map((a) =>
        a.kind === "card" && a.settleAccountId === id
          ? { ...a, settleAccountId: "" }
          : a,
      ),
    recurring: data.recurring.filter(
      (r) => r.accountId !== id && r.toAccountId !== id,
    ),
    oneoffs: data.oneoffs.filter(
      (o) => o.accountId !== id && o.toAccountId !== id,
    ),
    actuals: data.actuals.filter(
      (a) => a.accountId !== id && a.toAccountId !== id,
    ),
  };
}

/* ========================= 定期項目（FR-02） ========================= */

export function addRecurring(data: AppData, item: RecurringItem): AppData {
  return { ...data, recurring: [...data.recurring, item] };
}

export function updateRecurring(
  data: AppData,
  id: string,
  patch: Partial<RecurringItem>,
): AppData {
  return {
    ...data,
    recurring: data.recurring.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
}

/** 停止と再開。定期項目そのものは残る（FR-02） */
export function toggleRecurringActive(data: AppData, id: string): AppData {
  return {
    ...data,
    recurring: data.recurring.map((r) =>
      r.id === id ? { ...r, active: !r.active } : r,
    ),
  };
}

export function removeRecurring(data: AppData, id: string): AppData {
  return {
    ...data,
    recurring: data.recurring.filter((r) => r.id !== id),
    /* その定期項目に紐づくオーバーライドも消す。残しても当たらない */
    overrides: Object.fromEntries(
      Object.entries(data.overrides).filter(
        ([key]) => !key.startsWith(`r:${id}:`),
      ),
    ),
  };
}

/* ========================= 単発予定（FR-03） ========================= */

export function addOneoff(data: AppData, item: OneoffItem): AppData {
  return { ...data, oneoffs: [...data.oneoffs, item] };
}

export function updateOneoff(
  data: AppData,
  id: string,
  patch: Partial<OneoffItem>,
): AppData {
  return {
    ...data,
    oneoffs: data.oneoffs.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  };
}

export function removeOneoff(data: AppData, id: string): AppData {
  const key = `o:${id}`;
  return {
    ...data,
    oneoffs: data.oneoffs.filter((o) => o.id !== id),
    overrides: Object.fromEntries(
      Object.entries(data.overrides).filter(([k]) => k !== key),
    ),
  };
}

/* ========================= 実績と消し込み（FR-05・FR-06） ========================= */

export function addActual(data: AppData, actual: Actual): AppData {
  return { ...data, actuals: [...data.actuals, actual] };
}

/** CSV取込のように、まとめて登録する（FR-16）。 */
export function addActuals(data: AppData, actuals: Actual[]): AppData {
  return { ...data, actuals: [...data.actuals, ...actuals] };
}

/**
 * 実績の編集で変えてよい項目（FR-41）。
 *
 * **`id` と `key` は含めない。** `key` は予定との紐づけで、CL-3 手順2 は
 * これだけを見て消し込みを判定する（日付にも金額にも依存しない）。
 * 編集で触れるようにすると、金額を直しただけで消し込みが外れる。
 */
export type ActualPatch = Partial<Omit<Actual, "id" | "key">>;

/**
 * 実績を編集する（FR-41、AC-24〜AC-26）。
 *
 * CSV取込で費目が誤って推測された場合、削除して入れ直すのは現実的では
 * ない。取込1回で数十件入るため。
 *
 * 型で `key` を弾いているが、実行時にも落とす。`patch as never` のような
 * 抜け道で紐づけが切れると、原因を追うのが難しいバグになる。
 */
export function updateActual(
  data: AppData,
  id: string,
  patch: ActualPatch,
): AppData {
  return {
    ...data,
    actuals: data.actuals.map((a) => {
      if (a.id !== id) return a;
      const next = { ...a, ...patch };
      /* 何を渡されても id と key は元のまま */
      return { ...next, id: a.id, key: a.key };
    }),
  };
}

/**
 * 既存の実績を予定に紐づける（FR-46、AC-30）。
 *
 * `key` を張る**唯一の**経路。`updateActual` は編集で `key` が壊れないよう
 * 型でも実行時でも弾いているので、二重計上の解消はここを通す。
 * 分けてあるのは、紐づけの変更が「編集」とは別の意味を持つ操作だからである。
 *
 * 利用者が候補を確認して確定したときだけ呼ぶ。金額と日付が近いという理由で
 * 自動的に呼んではいけない（FR-46）。
 */
export function linkActualToPlan(
  data: AppData,
  actualId: string,
  plan: ForecastInstance,
): AppData {
  return {
    ...data,
    actuals: data.actuals.map((a) =>
      a.id === actualId
        ? {
            /* 分類は予定から引き継ぐ（§3.3 前書き、AC-46）。
               金額・日付・口座は実績の値のまま */
            ...applyClassification(a, plan),
            key: plan.key,
            /* 紐づいた時点で「予定に対応しない」ではなくなる */
            unplanned: false,
          }
        : a,
    ),
  };
}

/**
 * 実績を「予定に対応しない突発の支出」と確定する／取り消す（FR-46、AC-38）。
 *
 * `key` が null である理由を記録するだけで、**残高の計算には影響しない。**
 * 候補の提示を止めるためのフラグである。取り消しは実績の編集から行える。
 */
export function setUnplanned(
  data: AppData,
  actualId: string,
  unplanned: boolean,
): AppData {
  return {
    ...data,
    actuals: data.actuals.map((a) =>
      a.id === actualId ? { ...a, unplanned } : a,
    ),
  };
}

export function removeActual(data: AppData, id: string): AppData {
  return { ...data, actuals: data.actuals.filter((a) => a.id !== id) };
}

/**
 * 予定インスタンスをそのまま実績にする（消し込み）。
 *
 * `key` に予定インスタンスキーを入れることで、CL-3 手順2 がその予定を
 * 予測から外す。年月別収支の予定側は変わらない（CL-5 手順2、AC-03）。
 */
export function settleAsPlanned(
  data: AppData,
  plan: {
    key: string;
    date: DateStr;
    name: string;
    type: Actual["type"];
    costType: Actual["costType"];
    categoryCode: string;
    amount: Yen;
    bizRatio: number;
    accountId: string;
    toAccountId?: string;
  },
  id: string,
): AppData {
  return addActual(data, { ...plan, id });
}

/* ========================= オーバーライド（FR-07） ========================= */

/**
 * この回だけの変更を足す。既にあるものには重ねる。
 *
 * `undefined` の項目は「変更しない」を意味するので書き込まない。
 * 書き込むと、変えていない金額まで固定してしまう。
 */
export function setOverride(
  data: AppData,
  key: string,
  patch: Override,
): AppData {
  const merged: Override = { ...data.overrides[key] };
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[field] = value;
    }
  }
  return { ...data, overrides: { ...data.overrides, [key]: merged } };
}

/** この回だけの変更を取り消す。 */
export function clearOverride(data: AppData, key: string): AppData {
  const next = { ...data.overrides };
  delete next[key];
  return { ...data, overrides: next };
}

/* ========================= 新規作成の初期値 ========================= */

/** 費目の既定値。足りないときの受け皿（要件定義書 §3.1.2 適用規則4）。 */
const DEFAULT_EXPENSE = "EXP-20";

/**
 * 新しい定期項目の初期値。
 *
 * 事業割合は0で始める。費目マスタは事業割合を持たない（適用規則7）。
 * 固定／変動は費目マスタの推奨値を初期値にする（適用規則1）。
 */
export function blankRecurring(id: string, accountId: string): RecurringItem {
  return {
    id,
    name: "新しい定期項目",
    type: "expense",
    costType:
      categoriesInGroup("EXP").find((c) => c.code === DEFAULT_EXPENSE)
        ?.recommendedCostType ?? "variable",
    categoryCode: DEFAULT_EXPENSE,
    amount: 0,
    bizRatio: 0,
    accountId,
    day: 25,
    months: null,
    active: true,
  };
}

export function blankOneoff(
  id: string,
  accountId: string,
  date: DateStr,
): OneoffItem {
  return {
    id,
    date,
    name: "新しい予定",
    type: "expense",
    costType:
      categoriesInGroup("EXP").find((c) => c.code === DEFAULT_EXPENSE)
        ?.recommendedCostType ?? "variable",
    categoryCode: DEFAULT_EXPENSE,
    amount: 0,
    bizRatio: 0,
    accountId,
  };
}

export function blankActual(
  id: string,
  accountId: string,
  date: DateStr,
): Actual {
  return {
    id,
    key: null,
    unplanned: false,
    date,
    name: "",
    type: "expense",
    costType: "variable",
    categoryCode: DEFAULT_EXPENSE,
    amount: 0,
    bizRatio: 0,
    accountId,
  };
}

export function blankBankAccount(id: string): Account {
  return { id, name: "新しい口座", kind: "bank", balance: 0 };
}

export function blankCardAccount(id: string, settleAccountId: string): Account {
  return {
    id,
    name: "新しいカード",
    kind: "card",
    balance: 0,
    unbilledBalance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 10,
    settleAccountId,
  };
}
