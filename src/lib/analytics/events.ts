/**
 * 利用イベントの定義
 *
 * 一次情報：docs/PoC開発計画.md §4「PoCで取る指標」
 * 設計方針：docs/adr/0013-利用イベントに金額を入れない.md
 *
 * **イベントに資金繰りの中身を入れない。**
 *   入れないもの：金額、費目名、取引先名、口座名、ファイル名、
 *                 IP、User-Agent、日付そのもの
 *   入れてよいもの：件数、期間の長さ（日数・月数）、種別、口座数
 *
 * 記録するのは「取り込んだ」という事実であって「いくら」ではない。
 * イベントに金額を入れると、アクセス制御の違う場所に資金繰りデータの
 * 複製ができ、本体を RLS で守っている意味がなくなる。
 *
 * ここの型を緩めると、その穴から中身が漏れ出す。緩めるときは ADR-0013 を
 * 読み直すこと。
 */

/**
 * props に入れてよい値。
 *
 * 文字列は**閉じた選択肢だけ**（種別）。自由入力の文字列を許すと、
 * そこに名称が入り込む。
 */
export type EventProps = Record<string, number | boolean>;

/** イベントの名前と、それぞれが持てる props。 */
export interface EventMap {
  /** サインインした。週あたりのログイン日数を数える */
  signed_in: Record<string, never>;

  /** 予定を登録した */
  plan_created: {
    /** 定期項目なら true、単発予定なら false */
    recurring: boolean;
  };

  /**
   * 消し込み操作を1件行った。
   *
   * **FR-46 の候補が当たっているかを測る。** FR-46 は途中で追加した機能で
   * 当初の5指標に無いため、このままでは候補提示が役に立ったのか、毎回
   * 外れて邪魔だっただけなのかが分からないまま終わる。CL-7 の条件
   * （同額・±12日・同口座）が緩すぎるかどうかは、これでしか分からない。
   *
   * `fromCandidate` が true のものだけを母数にし、`unplanned` が true の
   * 割合を見る。却下が大半なら条件が緩すぎるという判断ができる。
   *
   * 新しいイベントは増やさず、既存のこれに型を足す形にしてある。
   */
  actual_recorded: {
    /** 予定を消し込んだものか（＝突発ではないか） */
    settled: boolean;
    /** CSV取込から来たか */
    fromCsv: boolean;
    /**
     * FR-46 の候補提示から行った操作か。
     *
     * 省略時は false（候補を経由しない通常の消し込み・手入力）。
     */
    fromCandidate?: boolean;
    /**
     * 候補を「予定にない支出」として却下したか。
     *
     * `fromCandidate` が true のときだけ意味を持つ。false なら候補を
     * 確定した（`key` を張った）。
     */
    unplanned?: boolean;
  };

  /** CSVを取り込んだ。初回30日以内の2回目取込率を数える */
  csv_imported: {
    /** 取り込んだ行数。金額は入れない */
    rows: number;
    /** うち予定と自動照合できた件数 */
    matched: number;
  };

  /** 残高の警告を見せた。警告からの操作率の分母 */
  shortfall_warned: {
    /** 残高がマイナスになるか（false なら防衛ライン割れ） */
    shortfall: boolean;
    /** 今日から何日先か。日付そのものは入れない */
    daysAhead: number;
  };

  /**
   * 残高の警告から操作に進んだ。**警告からの操作率の分子。**
   *
   * ダッシュボードの警告に置いたリンクを押したときに記録する。
   * 「警告を見せたあと30分以内に何かした」という推定ではなく、
   * 警告そのものから動いたことを直接残す。
   */
  shortfall_acted: {
    /** 実績入力へ進んだか（false ならキャッシュフローへ） */
    toEntry: boolean;
  };

  /** 予定を繰り延べた。警告からの操作率の分子 */
  plan_deferred: {
    /** 当回スキップか（false なら日付か金額の変更） */
    skipped: boolean;
  };

  /**
   * データの読み込みが不完全だった（FR-47、§5.1.2）。
   *
   * **分割取得のバグを検知するカナリア。** ページングが正しく効いていれば
   * 発生しない。発生していたら残高が静かに間違う経路が開いているので、
   * 件数だけを残して気づけるようにする。
   */
  load_incomplete: {
    /** 総件数 */
    expected: number;
    /** 実際に受け取った件数 */
    received: number;
  };

  /** 予定の期間の広さ。3ヶ月以上先まで予定があるかを数える */
  forecast_horizon: {
    /** 最も先の予定までの月数 */
    months: number;
    /** 登録してある口座の数 */
    accounts: number;
  };
}

export type EventName = keyof EventMap;

/**
 * props に入れてはいけないキー。
 *
 * 型で防いでいるが、名前でも弾く。`amount` のような番号だけの値でも、
 * それは金額であり入れてはいけない。テストで固定してある。
 */
export const FORBIDDEN_PROP_KEYS: readonly string[] = [
  "amount",
  "balance",
  "name",
  "category",
  "categoryCode",
  "categoryName",
  "account",
  "accountId",
  "accountName",
  "counterparty",
  "filename",
  "fileName",
  "date",
  "ip",
  "userAgent",
  "email",
  "note",
];

/** 入れてはいけないキーが混ざっていないか。 */
export function hasForbiddenKey(props: EventProps): string | null {
  for (const key of Object.keys(props)) {
    if (FORBIDDEN_PROP_KEYS.includes(key)) return key;
  }
  return null;
}
