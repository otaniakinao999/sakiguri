/**
 * データモデル
 *
 * 一次情報：docs/要件定義書.md §3.2
 *
 * v2.0 のエンティティ（Loan / Counterparty / Invoice）はここに含めない。
 * PoC の13タスク（docs/PoC開発計画.md §4）の範囲外であり、
 * 仕様も未確定（要件定義書 §3.1.1）のため。
 */

/**
 * 金額。**円単位の整数**。小数点以下を持たない。
 *
 * 按分・利息・端数は計算の各段で Math.round する。
 * 詳細は docs/adr/0001-金額を円単位の整数で扱う.md
 */
export type Yen = number;

/**
 * 日付。**'YYYY-MM-DD' 固定**の文字列。
 *
 * 辞書順が時系列順と一致するため、前後判定は文字列比較でよい。
 * UTC 変換を伴う API（toISOString など）を使わない。
 * 詳細は docs/adr/0002-日付を文字列で持つ.md
 */
export type DateStr = string;

/** 年月。'YYYY-MM' 固定。DateStr の先頭7文字と一致する。 */
export type YearMonth = string;

/** 口座の種類。card は残高が「未払残高（正の値）」を意味する。 */
export type AccountKind = "bank" | "cash" | "card";

/** 収支の向き。transfer は口座間の振替で、合計残高を動かさない。 */
export type EntryType = "income" | "expense" | "transfer";

/** 費用の区分。income と transfer では null。 */
export type CostType = "fixed" | "variable";

interface AccountBase {
  id: string;
  name: string;
  /** 基準日時点の残高 */
  balance: Yen;
}

/** 銀行口座・現金（要件定義書 §3.2 Account の kind = bank / cash） */
export interface DepositAccount extends AccountBase {
  kind: "bank" | "cash";
}

/**
 * クレジットカード（要件定義書 §3.2 Account の kind = card）
 *
 * 締日・支払月・支払日・引落元口座は要件定義書で「card時○」とされている。
 * 判別可能なユニオンにして、カードなら必ず揃っていることを型で保証する。
 * 揃っていないカードを実行時に検査する必要がなくなる。
 */
export interface CardAccount extends AccountBase {
  kind: "card";
  /** 未払残高（正の値） */
  balance: Yen;
  /** 締日（1〜31。31は月末） */
  closingDay: number;
  /** 締め月から何ヶ月後に支払うか（0=当月／1=翌月／2=翌々月） */
  payMonthOffset: number;
  /** 支払日（1〜31。月末超過は月末に丸める） */
  payDay: number;
  /** 引落元口座の id */
  settleAccountId: string;
}

/** 口座・カード（要件定義書 §3.2 Account） */
export type Account = DepositAccount | CardAccount;

/** カードかどうか。CL-2 はこの判定で残高を動かすかを分ける。 */
export function isCard(account: Account): account is CardAccount {
  return account.kind === "card";
}

/**
 * 入出金に共通する項目。
 * RecurringItem / OneoffItem / Actual が共有する。
 */
interface EntryBase {
  id: string;
  /** 内容 */
  name: string;
  type: EntryType;
  /** 費用のとき必須。それ以外は null（要件定義書 §3.1.2 適用規則6） */
  costType: CostType | null;
  /**
   * 費目コード（要件定義書 §3.1.2）。名称ではなくコードで保持する。
   * 表示名は将来変更されうるため、名称で突き合わせない。
   * 定義とグループ判定は categories.ts。
   */
  categoryCode: string;
  /** 金額（絶対値） */
  amount: Yen;
  /** 事業割合 0〜100。損益集計時のみ適用する（CL-4） */
  bizRatio: number;
  /** 支払・入金の口座 */
  accountId: string;
  /** 振替先口座。transfer のとき必須 */
  toAccountId?: string;
}

/** 定期項目（要件定義書 §3.2 RecurringItem） */
export interface RecurringItem extends EntryBase {
  /** 発生日（1〜31。31は月末） */
  day: number;
  /** 発生月の配列（1〜12）。null は毎月 */
  months: number[] | null;
  /** 停止フラグ。false の項目は展開しない */
  active: boolean;
}

/** 単発予定（要件定義書 §3.2 OneoffItem） */
export interface OneoffItem extends EntryBase {
  date: DateStr;
}

/** 実績（要件定義書 §3.2 Actual） */
export interface Actual extends EntryBase {
  date: DateStr;
  /** 紐づく予定インスタンスのキー。手入力の突発支出では null */
  key: string | null;
}

/** この回だけの変更（要件定義書 §3.2 Override） */
export interface Override {
  /** 変更後の日付 */
  date?: DateStr;
  /** 変更後の金額 */
  amount?: Yen;
  /** true なら当回を発生させない */
  skipped?: boolean;
  /** 変更理由のメモ */
  note?: string;
}

/** 予定インスタンスキーをキーとするマップ */
export type Overrides = Record<string, Override>;

/** 予定インスタンスの生成元 */
export type ForecastSource = "recurring" | "oneoff";

/**
 * 予定インスタンス（CL-1 の出力）
 *
 * キーの規約（要件定義書 §3.2）：
 *   定期項目 `r:{recurringId}:{元の発生日}`
 *   単発予定 `o:{oneoffId}`
 * キーは**オーバーライド適用前の日付**で生成する。
 * 日付をずらしても紐づけが切れないため。
 */
export interface ForecastInstance {
  key: string;
  /** オーバーライド適用後の日付 */
  date: DateStr;
  /**
   * オーバーライドで日付が動いた場合の、元の日付。
   * 動いていないときは undefined。UI で「◯/◯ ← ◯/◯」と表示する。
   */
  origDate?: DateStr;
  name: string;
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  /** オーバーライド適用後の金額 */
  amount: Yen;
  bizRatio: number;
  accountId: string;
  toAccountId?: string;
  src: ForecastSource;
  /** 生成元の RecurringItem / OneoffItem の id */
  srcId: string;
  /** 適用されたオーバーライド。無ければ undefined */
  override?: Override;
}

/**
 * イベントの出どころ。
 * `settle` は CL-2 が生成するカード引落で、元データには存在しない。
 */
export type EventSource = ForecastSource | "actual" | "settle";

/**
 * CL-2 の入力となる1件。予定インスタンスと実績の共通形。
 *
 * `ForecastInstance` はそのまま代入できる。`Actual` は `src: 'actual'` を
 * 付けて変換する（cash.ts の `actualToEvent`）。
 */
export interface LedgerEvent {
  /** 実績は紐づく予定が無ければ null */
  key: string | null;
  date: DateStr;
  name: string;
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  amount: Yen;
  bizRatio: number;
  accountId: string;
  toAccountId?: string;
  src: EventSource;
  /**
   * このイベントの元になったレコードの id。
   *
   * `src` が `recurring` / `oneoff` なら RecurringItem / OneoffItem の id、
   * `actual` なら Actual の id。`settle` は CL-2 の生成物で元レコードが
   * 無いため undefined。
   *
   * 入出金予定表から実績を編集するために要る（FR-41）。`key` は予定との
   * 紐づけであって実績の識別子ではなく、突発の実績では null になる。
   */
  srcId?: string;
}

/**
 * CL-2 の出力。**口座残高を動かす**イベント。
 *
 * カード利用は残高を動かさないためここには現れず、代わりに締め期間ごとに
 * 合算された `src: 'settle'` の引落イベントが現れる。
 */
export interface CashEvent extends LedgerEvent {
  /** `src === 'settle'` のとき、引落元のカード id */
  cardId?: string;
}
