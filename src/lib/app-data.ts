/**
 * アプリが保持するデータ
 *
 * 一次情報：docs/要件定義書.md §3.2 データモデル
 *
 * **いまはメモリ上だけに持つ。** 画面を閉じると消える。
 * 保存とクラウド同期は PoC開発計画 フェーズ3・タスク#12（Supabase）で
 * 入れる。AC-10（ブラウザを閉じて再度開いてもデータが保持される）は
 * そこで満たす。
 *
 * このファイルは React に依存しない。状態の持ち回りは
 * `src/components/app-shell/AppDataProvider.tsx` が受け持つ。
 */

import type {
  Account,
  Actual,
  DateStr,
  ImportRule,
  OneoffItem,
  Overrides,
  RecurringItem,
  Yen,
} from "@/core/types";

export interface AppData {
  /** 基準日。この日の口座残高を入力値として与える（要件定義書 §1.3） */
  asOf: DateStr;
  /** 生活防衛ライン。法人では必要運転資金ライン */
  reserveLine: Yen;
  /**
   * 最後に消し込み操作を行った日（要件定義書 §3.2 Settings）。
   *
   * FR-43 の「消し込みが止まっている」警告のためだけに持つ。
   * null は一度も消し込んでいない状態で、起点には基準日を使う。
   */
  lastReconciledAt: DateStr | null;
  accounts: Account[];
  recurring: RecurringItem[];
  oneoffs: OneoffItem[];
  actuals: Actual[];
  overrides: Overrides;
  /** CSV仕分けルール（要件定義書 §3.2 ImportRule・FR-18） */
  rules: ImportRule[];
}

/**
 * 初期状態。**空**である。
 *
 * サンプルデータを入れない。PoC開発計画 §4 が指標として
 * 「登録後14日時点の予定登録件数（中央値）」を測るため、
 * 最初から予定が入っていると、その指標が意味を失う。
 */
export function emptyAppData(asOf: DateStr): AppData {
  return {
    asOf,
    reserveLine: 0,
    lastReconciledAt: null,
    accounts: [],
    recurring: [],
    oneoffs: [],
    actuals: [],
    overrides: {},
    rules: [],
  };
}

/**
 * まだ何も登録されていないか。空状態の表示に使う。
 *
 * **仕分けルールは数えない。** ルールだけがある状態は「予定も実績も無い」
 * ままなので、空状態の案内を出すのが正しい（ルールは取込のときに効く）。
 */
export function isEmpty(data: AppData): boolean {
  return (
    data.accounts.length === 0 &&
    data.recurring.length === 0 &&
    data.oneoffs.length === 0 &&
    data.actuals.length === 0
  );
}
