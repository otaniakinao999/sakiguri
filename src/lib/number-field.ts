/**
 * 数値入力欄の文字列解析
 *
 * 一次情報：docs/要件定義書.md §3.2、§4.3「金額の正規化」
 *   §3.2 Account.balance … 基準日時点の残高。**card の場合は未払残高（正の値）**
 *   §3.2 amount          … 金額（**絶対値**）
 *   §4.3                 … `¥` `,` `、` 空白 `円` を除去。`▲` `△` はマイナスとして扱う
 *
 * `NumberInput` から切り出した純関数。UI から分けてあるのは、DOM の
 * テスト環境（jsdom）を入れずにテストするため。CLAUDE.md §2.7 の
 * 依存許可リストに jsdom は無い。
 *
 * **入力途中の状態を潰さないこと。** 欄を空にできない実装だと、既存の値を
 * 消して入れ直せない。空文字と符号だけの状態は `text` にそのまま残し、
 * 値としては 0 を返す。
 */

/** 半角に直す全角数字。日本語IMEでそのまま打たれる */
const FULLWIDTH_DIGITS = /[０-９]/g;

/**
 * マイナスとして扱う文字。
 *
 * `-` のほか、表示に使っている U+2212（format.ts の MINUS）と、
 * 通帳・明細で使われる `▲` `△` を受ける（§4.3）。画面の数字をそのまま
 * コピーして貼り戻せるようにするため。
 */
const MINUS_CHARS = /[-−－▲△]/;

export interface NumberFieldOptions {
  /**
   * 負の値を受け付けるか。既定は false。
   *
   * false のときマイナス記号は**無視する**（値として存在しない文字として
   * 扱う）。符号を読み取ってから0に丸めると、利用者の意図した −8,000 が
   * 黙って 0 になる。無視なら 8,000 になり、どちらも誤りだが、
   * 「絶対値」という仕様（§3.2）に沿うのは後者である。
   */
  allowNegative?: boolean;
  /** 上限。超えたら丸める */
  max?: number;
}

export interface NumberFieldResult {
  /**
   * 欄に表示する文字列。
   *
   * 入力途中の `""`（空）と `"-"`（符号だけ）をそのまま返す。
   * これを value から作り直すと、欄を空にできなくなる。
   */
  text: string;
  /** 確定した値。円単位の整数（ADR-0001） */
  value: number;
  /**
   * 上限で丸めたか。
   *
   * 丸めたときは呼び出し側が `text` を捨てて `value` を表示する。
   * 「100 が上限の欄に 150 と打つと 150 のまま見える」を避けるため。
   */
  clamped: boolean;
}

/**
 * 入力欄の文字列を、表示用の文字列と値に分ける。
 *
 * 数字以外は落とす。小数点も指数も受け付けない（金額は整数。ADR-0001）。
 */
export function parseNumberField(
  raw: string,
  { allowNegative = false, max }: NumberFieldOptions = {},
): NumberFieldResult {
  const normalized = raw.replace(FULLWIDTH_DIGITS, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

  /* 符号は先頭のものだけを見る。途中の `-` は区切り文字とみなして落とす */
  const negative = allowNegative && MINUS_CHARS.test(normalized.trimStart()[0] ?? "");

  const digits = normalized.replace(/\D/g, "");
  /* 先頭の 0 を落とす。"007" は 7、"0" は 0、"" は "" のまま */
  const trimmed = digits.replace(/^0+(?=\d)/, "");

  const magnitude = trimmed === "" ? 0 : Number(trimmed);
  /* `-0` を作らない。符号だけ打った状態の値は 0 であって −0 ではない */
  const signed = negative && magnitude !== 0 ? -magnitude : magnitude;

  const value = max === undefined ? signed : Math.min(signed, max);
  const clamped = value !== signed;

  const sign = negative ? "-" : "";
  return { text: clamped ? String(value) : `${sign}${trimmed}`, value, clamped };
}
