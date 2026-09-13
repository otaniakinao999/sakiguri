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

/** 口座・カード（要件定義書 §3.2 Account） */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** 基準日時点の残高。card の場合は未払残高（正の値） */
  balance: Yen;
  /** 締日（1〜31。31は月末）。card のとき必須 */
  closingDay?: number;
  /** 締め月から何ヶ月後に支払うか（0=当月／1=翌月／2=翌々月）。card のとき必須 */
  payMonthOffset?: number;
  /** 支払日（1〜31。月末超過は月末に丸める）。card のとき必須 */
  payDay?: number;
  /** 引落元口座の id。card のとき必須 */
  settleAccountId?: string;
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
  /** expense のとき必須。それ以外は null */
  costType: CostType | null;
  /** 費目。transfer 以外は必須。マスタは要件定義書に定義がないため string */
  category: string | null;
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
  category: string | null;
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
