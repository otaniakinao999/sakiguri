/**
 * CL-7 CSV取込
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-7、§6.1 CSV入力仕様
 * 対応する機能要件：FR-16
 * 対応する受入基準：AC-07
 *
 * 銀行・カードの明細CSVを解析し、取込前の確認画面に出す行を組み立てる。
 * 未消込の予定との自動照合と、過去の名称からの費目推定までを行う。
 *
 * **ファイル本体はサーバーに保存しない。** 解析はクライアントで行い、
 * 確定した実績のみを送信する（要件定義書 §5.1.1）。口座情報を含みうる
 * ファイルを保持しないという安全側の設計でもある。
 */

import {
  affectsProfitLoss,
  categoryOf,
  costTypeApplies,
  groupOfCategory,
} from "./categories";
import { daysBetween, parseDate } from "./date";
import type {
  Actual,
  CostType,
  DateStr,
  EntryType,
  ForecastInstance,
  ImportRule,
  RuleDirection,
  Yen,
} from "./types";

/** 1ファイルの行数上限（要件定義書 §6.1）。 */
export const CSV_MAX_ROWS = 20_000;

/** 費目が足りないときの受け皿（要件定義書 §3.1.2 適用規則4）。 */
const FALLBACK_EXPENSE = "EXP-20"; // 雑費
const FALLBACK_INCOME = "INC-07"; // その他収入

/* ========================= 文字コード ========================= */

/**
 * バイト列を文字列にする（CL-7 文字コード判定）。
 *
 * UTF-8 で厳格デコードを試み、失敗した場合 Shift_JIS でデコードする。
 * 先頭の BOM は除去する。
 *
 * `TextDecoder` はブラウザと Node の双方にある標準のグローバルで、
 * 同じバイト列からは必ず同じ文字列が返る。DOM には依存しないため
 * core に置いてよい（CLAUDE.md §2.3）。
 */
export function decodeCsv(bytes: Uint8Array | ArrayBuffer): string {
  const buffer = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("shift_jis").decode(buffer);
  }
  /* TextDecoder は既定で BOM を落とすが、Shift_JIS 経路や
     すでに文字列化された入力に備えて明示的にも落とす */
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* ========================= 解析 ========================= */

/**
 * 区切り文字を推定する（要件定義書 §6.1：カンマ、タブ）。
 *
 * 引用符の外にある文字だけを数え、多いほうを採る。同数ならカンマ。
 * 両方を無条件に区切りとして扱うと、TSV の摘要に含まれるカンマで
 * 列がずれる。
 */
function detectDelimiter(text: string): "," | "\t" {
  let commas = 0;
  let tabs = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === ",") commas++;
    else if (c === "\t") tabs++;
    else if (c === "\n") break;
  }
  return tabs > commas ? "\t" : ",";
}

/**
 * CSV / TSV を行と列に分解する。
 *
 * ダブルクォートで囲めるほか、囲みの中では `""` がひとつの `"` を表す
 * （要件定義書 §6.1）。CRLF と LF の両方を受け付ける。
 * 全セルが空の行は落とす。
 */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      endCell();
    } else if (c === "\n") {
      endRow();
    } else if (c !== "\r") {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) endRow();

  if (rows.length > CSV_MAX_ROWS) {
    throw new RangeError(
      `行数が上限を超えています: ${rows.length} 行（上限 ${CSV_MAX_ROWS} 行）`,
    );
  }
  return rows;
}

/* ========================= 正規化 ========================= */

/**
 * 日付を 'YYYY-MM-DD' にする（CL-7 日付の正規化）。
 *
 * `YYYY/M/D`、`YYYY-M-D`、`YYYY年M月D日`、`YYYYMMDD` を受け付ける。
 * 和暦は対象外。読めない場合と、存在しない日付（2026-02-30 など）は null。
 */
export function normalizeDate(raw: string): DateStr | null {
  const text = String(raw).trim().replace(/["']/g, "");

  let year: number;
  let month: number;
  let day: number;

  const separated = /^(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})日?$/.exec(text);
  const packed = /^(\d{8})$/.exec(text);

  if (separated) {
    [year, month, day] = [
      Number(separated[1]),
      Number(separated[2]),
      Number(separated[3]),
    ];
  } else if (packed) {
    year = Number(text.slice(0, 4));
    month = Number(text.slice(4, 6));
    day = Number(text.slice(6, 8));
  } else {
    return null;
  }

  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  try {
    parseDate(candidate); // 実在しない日付を弾く
  } catch {
    return null;
  }
  return candidate;
}

/**
 * 金額を数値にする（CL-7 金額の正規化）。
 *
 * `¥` `,` `、` 空白 `円` を除去し、`▲` `△` はマイナスとして扱う。
 * 読めない場合と空欄は null。小数は円未満を丸める（ADR-0001）。
 */
export function normalizeAmount(raw: string): Yen | null {
  const text = String(raw)
    .replace(/[¥￥,、\s円"']/g, "")
    .replace(/^[▲△]/, "-");
  if (text === "" || text === "-") return null;
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/* ========================= 列の推定 ========================= */

/** どの列を何として読むか。利用者が確認画面で修正できる。 */
export interface ColumnMapping {
  /** 日付の列 */
  date: number;
  /** 摘要の列。無ければ -1 */
  name: number;
  /** 入金の列。無ければ -1 */
  inflow: number;
  /** 出金の列。無ければ -1 */
  outflow: number;
  /** 金額が1列の場合の列。無ければ -1 */
  amount: number;
  /** 金額が1列の場合の符号の解釈 */
  sign: "outMinus" | "outPlus";
  /**
   * **残高の列**（FR-61・AC-68）。無ければ -1。
   *
   * 取込の結果を検算するためだけに読む。費目にも照合にも使わない。
   * **見出しからしか拾わない。** 数として見ると金額の列と区別が付かず、
   * 取り違えると検算が意味のない額を出す。したがって**見出しの無いCSVでは
   * 検算しない**（`-1` のまま）。利用者が確認画面で選べる（CL-7「推定結果は
   * 必ず画面に表示し、利用者が修正できること」）。
   *
   * 「日付,摘要,出金,入金,残高」の並びで最後の数の列を金額として拾って
   * しまう経路は、**見出しが無いときにしか通らない**（列の推定は1行目しか
   * 見ない）。そこでは残高も拾えていないので、除く処理を書いても効かない。
   */
  balance: number;
  /** 1行目が見出しか */
  hasHeader: boolean;
}

const HEADER_PATTERNS = {
  date: /日付|年月日|取引日|利用日|ご利用日|日時/,
  name: /摘要|内容|お取引内容|利用店名|ご利用先|店名|備考|明細/,
  inflow: /入金|お預り|お預入|預入/,
  outflow: /出金|お支払|お引出|引出|支払金額/,
  amount: /金額/,
  /** 「差引残高」「現在高」も含む。**「残高」を含む語を広く拾う** */
  balance: /残高|残額|現在高/,
} as const;

/**
 * 列を自動推定する（CL-7 列の自動推定）。
 *
 * ヘッダ行に正規表現を当てる。ヘッダが無い場合は、1行目の各セルを
 * 日付としてパースできるか、数値としてパースできるかで推定する。
 *
 * **推定結果は必ず画面に表示し、利用者が修正できること**（CL-7）。
 * ここが外れても取込が壊れないのは、確認画面があるからである。
 */
export function detectColumns(rows: string[][]): ColumnMapping {
  const head = rows[0] ?? [];
  const find = (re: RegExp) => head.findIndex((cell) => re.test(String(cell)));

  let date = find(HEADER_PATTERNS.date);
  let name = find(HEADER_PATTERNS.name);
  const inflow = find(HEADER_PATTERNS.inflow);
  const outflow = find(HEADER_PATTERNS.outflow);
  let amount = find(HEADER_PATTERNS.amount);
  /* **残高は見出しからだけ拾う。** 中身から推し量らない（`balance` の注記） */
  const balance = find(HEADER_PATTERNS.balance);

  /* 見出しに当たらなければ、1行目の中身から推し量る */
  if (date < 0) date = head.findIndex((cell) => normalizeDate(cell) !== null);
  if (amount < 0 && inflow < 0 && outflow < 0) {
    const numeric = head
      .map((cell, i) => (normalizeAmount(cell) !== null ? i : -1))
      .filter((i) => i >= 0 && i !== date);
    amount = numeric.length > 0 ? numeric[numeric.length - 1] : -1;
  }
  if (name < 0) {
    /* すでに他の用途に割り当たっている列は候補から外す。
       外さないと「日付,入金,出金」のようなCSVで、入金の列を
       摘要として拾ってしまう。 */
    const taken = new Set(
      [date, inflow, outflow, amount, balance].filter((i) => i >= 0),
    );
    name = head.findIndex(
      (cell, i) =>
        !taken.has(i) &&
        String(cell).trim() !== "" &&
        normalizeAmount(cell) === null &&
        normalizeDate(cell) === null,
    );
  }

  /* 1行目が日付として読めるなら、それは見出しではなくデータ */
  const hasHeader = date < 0 || normalizeDate(head[date] ?? "") === null;

  return {
    date: Math.max(date, 0),
    name,
    inflow,
    outflow,
    amount,
    sign: "outMinus",
    balance,
    hasHeader,
  };
}

/* ========================= 費目の推定 ========================= */

/** 費目推定のもとになる、過去に登録された項目。 */
export interface HistoryEntry {
  name: string;
  categoryCode: string;
  costType: CostType | null;
  bizRatio: number;
}

/** 推定された費目の初期値。 */
export interface CategoryGuess {
  categoryCode: string;
  costType: CostType | null;
  bizRatio: number;
  /** 推定のもとになった項目の名称 */
  from: string;
}

/**
 * 名称から照合用のキーを作る。
 *
 * 括弧内を除いた先頭4文字。2文字未満のキーは照合に使わない（CL-7）。
 */
export function historyKeyOf(name: string): string | null {
  const key = String(name)
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim()
    .slice(0, 4);
  return key.length >= 2 ? key : null;
}

/**
 * 過去の名称から費目を推定する（CL-7 費目の自動推定）。
 *
 * 既存の定期項目・単発予定・実績の名称から括弧内を除いた先頭4文字を取り、
 * CSVの摘要に部分一致するものを探す。一致したらその費目・固定変動区分・
 * 事業割合を初期値として引き継ぐ。
 *
 * 収支の向きに合わない費目（支出なのに INC、収入なのに EXP）は使わない。
 * 資金移動（TRF）も引き継がない。CSV から取り込むのは実際の入出金であり、
 * 振替や引落は別の経路で表現されるため。
 */
export function guessFromHistory(
  description: string,
  history: HistoryEntry[],
  type: EntryType,
): CategoryGuess | null {
  const text = String(description);
  const wanted = type === "income" ? "INC" : "EXP";

  for (const entry of history) {
    const key = historyKeyOf(entry.name);
    if (!key || !text.includes(key)) continue;
    if (!affectsProfitLoss(entry.categoryCode)) continue;
    if (groupOfCategory(entry.categoryCode) !== wanted) continue;
    return {
      categoryCode: entry.categoryCode,
      costType: entry.costType,
      bizRatio: entry.bizRatio,
      from: entry.name,
    };
  }
  return null;
}

/* ========================= CL-10 仕分けルール ========================= */

/** 行の向き（CL-10）。入金が `in` */
export function directionOf(type: EntryType): RuleDirection {
  return type === "income" ? "in" : "out";
}

/**
 * そのルールが当たる向き（CL-10）。
 *
 * **INC / EXP の費目は符号が決まっているので、費目から導く。**
 * `direction` を書かなくても入金のルールが出金の行に当たらない（AC-57d）。
 * `direction` が意味を持つのは TRF の費目のときだけで、null なら両方に当たる
 * ―― 振替を両側の明細から記録するとき、出金側と入金側の両方に同じルールを
 * 当てたいためである（ADR-0025）。
 *
 * **ここが唯一の導出である。** ルール側にも符号を持たせると、費目を変えた
 * ときに片方が古いまま残る（CLAUDE.md §2.8）。
 */
export function effectiveDirection(
  rule: Pick<ImportRule, "direction" | "categoryCode">,
): RuleDirection | null {
  const group = groupOfCategory(rule.categoryCode);
  if (group === "INC") return "in";
  if (group === "EXP") return "out";
  return rule.direction;
}

/** CL-10 の当たり判定の対象になる行の情報。 */
export interface RuleTarget {
  name: string;
  type: EntryType;
  accountId: string;
}

/**
 * CL-10 当たりの判定。
 *
 * **空の `pattern` は当たらない。** `"".includes()` は常に true なので、
 * 空のまま保存できると**全行に当たるルール**になる。登録側でも弾くが、
 * 既に入っている行から読むこともあるのでここでも止める。
 */
export function ruleMatches(
  rule: Pick<ImportRule, "pattern" | "accountId" | "direction" | "categoryCode">,
  row: RuleTarget,
): boolean {
  if (rule.pattern.trim() === "") return false;
  if (!row.name.includes(rule.pattern)) return false;
  if (rule.accountId !== null && rule.accountId !== row.accountId) return false;
  const want = effectiveDirection(rule);
  if (want !== null && want !== directionOf(row.type)) return false;
  return true;
}

/**
 * 当たったルールの強さ。**前の項から順に見て、大きいほうが勝つ**（CL-10）。
 *
 * 1. `pattern` の長さ（**コードポイント数**。`length` はサロゲートペアを2つ
 *    数えるので、絵文字を含む `pattern` が不当に勝つ）
 * 2. 口座を指定したほう
 * 3. 向きを指定したほう
 *
 * ここで並びきらなければ `id` の昇順（`strongerRule`）。
 *
 * **長さを口座より先に見るのは意図である**（要件定義書 §3.3 CL-10）。
 * 口座の指定を先に見ると、**1文字の雑なルールが、口座を指定しただけで
 * 精密なルールに勝つ。** 長さが先なら、勝つのは「取引の内容をより細かく
 * 言い当てている側」になる。したがって「全口座の長いルールが、口座を指定した
 * 短いルールに勝つ」という並びは**直さない。**
 *
 * **向きは `direction` 列を見る。`effectiveDirection` ではない。** ここで
 * 測っているのは「利用者がどれだけ条件を絞ったか」で、費目から導かれる向きは
 * 絞り込みではなく費目の性質である。
 */
function ruleStrength(rule: ImportRule): readonly number[] {
  return [
    [...rule.pattern].length,
    rule.accountId !== null ? 1 : 0,
    rule.direction !== null ? 1 : 0,
  ];
}

/**
 * `a` が `b` より勝つか。
 *
 * **最後は `id` の昇順。** 当たる条件が同じ2行は持てない（§3.2 ImportRule の
 * 一意制約）が、**長さが同じで条件の違う2つ**は持てる（`ｱｱ` と `ｲｲ` が同じ
 * 摘要に当たる）ので、最後の決め手が要る。
 */
function strongerRule(a: ImportRule, b: ImportRule): boolean {
  const sa = ruleStrength(a);
  const sb = ruleStrength(b);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i];
  }
  return a.id < b.id;
}

/**
 * 当たったルールから1件を採る（CL-10）。
 *
 * **`pattern` の長い順に1件。同じ長さなら口座を指定したほう → 向きを指定した
 * ほう → `id` の昇順。** 長いほうを採るのは細かいルールが大まかなルールに
 * 勝つようにするためで、利用者は例外をあとから足すだけで済む
 * （`ｱﾏｿﾞﾝ` より `ｱﾏｿﾞﾝｳｴﾌﾞｻ-ﾋﾞｽ` が勝つ）。順序の理由は `ruleStrength`。
 */
export function pickRule(
  rules: readonly ImportRule[],
  row: RuleTarget,
): ImportRule | null {
  let best: ImportRule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, row)) continue;
    if (best === null || strongerRule(rule, best)) best = rule;
  }
  return best;
}

/**
 * 当たる条件が同じか（§3.2 ImportRule・AC-57f）。
 *
 * **DB の一意制約 `(user_id, pattern, account_id, direction) nulls not
 * distinct` と同じ組み合わせを見る。** 片方だけ直すと、画面が通した組み合わせ
 * を DB が弾いて、利用者には理由の分からないエラーが出る（CLAUDE.md §2.8）。
 *
 * `pattern` は前後の空白を落として比べる。**DB は落とさないので、ここは DB より
 * 厳しい。** 厳しい側に振れている分は「保存の前に知らせる」で済み、DB のエラー
 * にはならない。文字種の正規化は OI-22。
 */
export function sameMatchKey(
  a: Pick<ImportRule, "pattern" | "accountId" | "direction">,
  b: Pick<ImportRule, "pattern" | "accountId" | "direction">,
): boolean {
  return (
    a.pattern.trim() === b.pattern.trim() &&
    a.accountId === b.accountId &&
    a.direction === b.direction
  );
}

/**
 * 確認画面の「次回もこうする」が作るルール（CL-10・AC-57e）。
 *
 * **`accountId` は取込先の口座にする。** 当たる行数はいま開いている取込
 * （＝その口座）から数えるので、全口座のルールにすると**表示した数より広く
 * 当たる。** 口座を限れば、出した数がそのルールの当たる範囲とそろう。
 * 広げたくなったら設定のルール表で外す（要件定義書 §3.3 CL-10）。
 *
 * `direction` は null。向きは費目から決まるか（INC / EXP）、資金移動なら
 * 両側に当てたい（ADR-0025）。
 */
export function ruleFromImport(
  draft: {
    pattern: string;
    categoryCode: string;
    costType: CostType | null;
    bizRatio: number;
  },
  accountId: string,
  id: string,
): ImportRule {
  const isTransfer = groupOfCategory(draft.categoryCode) === "TRF";
  return {
    id,
    pattern: draft.pattern.trim(),
    accountId,
    direction: null,
    categoryCode: draft.categoryCode,
    /* 固定変動が意味を持つのは費目グループが EXP のときだけ（適用規則6） */
    costType: costTypeApplies(draft.categoryCode) ? draft.costType : null,
    /* 資金移動では効かない値を持たせない（§3.2 ImportRule） */
    bizRatio: isTransfer ? 0 : draft.bizRatio,
  };
}

/** 保存前のルール。設定画面の下書きは `id` を持つが、確認画面は持たない。 */
export interface RuleDraft {
  id?: string;
  pattern: string;
  accountId: string | null;
  direction: RuleDirection | null;
  categoryCode: string;
  bizRatio: number;
}

/**
 * ルールとして登録できない組み合わせか。理由を返す（AC-57d・AC-57f）。
 *
 * **符号と矛盾する費目グループを弾く。** `direction = 'in'` に EXP の費目、
 * `'out'` に INC の費目は、どの行にも当たらないルールになる。作れてしまうと
 * 「作ったのに当たらない」理由が利用者に分からない。
 *
 * **`others` を渡すと、当たる条件が同じルールがあるかも見る**（AC-57f）。
 * DB の一意制約で弾かれる前に知らせるためで、**知らせる文言はこの関数が持つ**
 * ―― DB のエラーメッセージを利用者に見せない。
 *
 * **ここが唯一の判定である。** 画面側で書くと、設定画面と取込の確認画面で
 * 違う組み合わせを通す（CLAUDE.md §2.8）。
 */
export function ruleConflict(
  rule: RuleDraft,
  others: readonly ImportRule[] = [],
): string | null {
  if (rule.pattern.trim() === "") {
    /* `"".includes()` は常に true。空のままだと全行に当たる */
    return "摘要のどこで当てるかを入れてください";
  }
  const group = groupOfCategory(rule.categoryCode);
  if (rule.direction === "in" && group === "EXP") {
    return "入金の行に支出の費目は当たりません";
  }
  if (rule.direction === "out" && group === "INC") {
    return "出金の行に収入の費目は当たりません";
  }
  if (group === "TRF" && rule.bizRatio !== 0) {
    /* 資金移動は CL-4 も CL-5 も通らないので、事業割合が効かない */
    return "資金移動の費目では事業割合が効きません（0にしてください）";
  }
  /* **自分は除く。** 設定画面は既にある行を直すので、自分と衝突してしまう */
  if (others.some((other) => other.id !== rule.id && sameMatchKey(other, rule))) {
    return "当たる条件が同じルールが既にあります（費目だけを直してください）";
  }
  return null;
}

/** 行の費目がどう決まったか。 */
export interface Classification {
  categoryCode: string;
  costType: CostType | null;
  bizRatio: number;
  /** ルールで決まったときだけ、そのルールの id */
  ruleId: string | null;
  /** 同じルールの `pattern`。確認画面に出す */
  rulePattern: string | null;
  /** 推定で決まったときだけ、もとになった名称 */
  guessedFrom: string | null;
}

/**
 * 費目・固定変動・事業割合を決める（CL-7 と CL-10 の優先順位）。
 *
 * **照合 → ルール → 推定 → 受け皿** の順に決まる。
 *
 * - 照合が成立した行は照合先の予定から引き継ぐ（AC-45）
 * - 次に仕分けルール。**利用者が意図して作ったものが、機械の推定に勝つ**
 *   （AC-57a・CLAUDE.md §2.9）
 * - ルールが当たらなかった行では推定が従来どおり働く
 *
 * **ここが唯一の決め方である。** `buildImportRows` と、ルールを使わないと
 * したときの決め直し（`redecideWithoutRule`）の両方がこれを呼ぶ。2箇所に
 * 書くと、片方に条件が増えたときもう片方が古いまま残る（§2.8）。
 */
export function classifyImportRow(
  row: RuleTarget,
  source: {
    matched?: Pick<ForecastInstance, "categoryCode" | "costType" | "bizRatio"> | null;
    rules?: readonly ImportRule[];
    history?: readonly HistoryEntry[];
  },
): Classification {
  const matched = source.matched ?? null;
  const rule = matched ? null : pickRule(source.rules ?? [], row);
  const guess =
    matched || rule
      ? null
      : guessFromHistory(row.name, [...(source.history ?? [])], row.type);

  const categoryCode =
    matched?.categoryCode ??
    rule?.categoryCode ??
    guess?.categoryCode ??
    (row.type === "income" ? FALLBACK_INCOME : FALLBACK_EXPENSE);

  /* **固定／変動は費目グループから決める**（適用規則6）。`type` で決めると、
     費目が資金移動の行（適用規則5a）に固定変動が付く */
  const costType = costTypeApplies(categoryCode)
    ? (matched?.costType ??
      rule?.costType ??
      guess?.costType ??
      categoryOf(categoryCode).recommendedCostType ??
      "variable")
    : null;

  return {
    categoryCode,
    costType,
    /* 事業割合の初期値は0。費目マスタは事業割合を持たない
       （要件定義書 §3.1.2 適用規則7） */
    bizRatio: matched?.bizRatio ?? rule?.bizRatio ?? guess?.bizRatio ?? 0,
    ruleId: rule?.id ?? null,
    rulePattern: rule?.pattern ?? null,
    guessedFrom: guess?.from ?? null,
  };
}

/**
 * 「このルールを使わない」で、その取込のあいだだけルールを外す（AC-57b）。
 *
 * **決め直すのは、そのルールで決まっていた行だけ。ほかの行は同じ参照で
 * 返す。** 取込行を丸ごと作り直すと、利用者がそこまでに手で直した費目も、
 * 外した取込のチェックも全部消える（FR-50 が既定で外したチェックも巻き戻る）。
 *
 * **手で直した行は決め直さない。** 行を手で直したとき呼び出し側が `ruleId`
 * を外すので（`ImportRow.ruleId` が null になる）、ここでは対象から自然に
 * 落ちる。印を別に持たせると、印とルールの紐づけが2箇所になる。
 *
 * `rules` には**外したあとの残り**を渡す。外したルールが隠していた、より
 * 短い `pattern` のルールが当たることがあり、それは「そのルールが無かった
 * ものとして扱う」の意味どおりである。
 */
export function redecideWithoutRule(
  rows: readonly ImportRow[],
  ruleId: string,
  rules: readonly ImportRule[],
  history?: readonly HistoryEntry[],
): ImportRow[] {
  return rows.map((row) => {
    if (row.ruleId !== ruleId) return row;
    const next = classifyImportRow(row, { rules, history });
    return { ...row, ...next };
  });
}

/**
 * 確認画面で費目を手で直したときの行（CL-7 確認画面・AC-57b）。
 *
 * **`ruleId` と `guessedFrom` を外す。** その行の費目はもうルールや推定が
 * 決めた値ではない。外すことで2つが同時に起きる。
 *
 * 1. 確認画面の表示が「ルールで決まった」と言わなくなる（AC-57a）
 * 2. 「このルールを使わない」で**決め直す対象から外れる**（AC-57b）
 *
 * 「手で直した」という印を別に持たせていないのはこのためである。印と
 * `ruleId` の2つを持つと、どちらが本当かを決める規則がもう1つ要る（§2.8）。
 *
 * **固定／変動も費目に合わせる**（適用規則6）。資金移動の費目に変えたら
 * 固定変動は落ちる。
 */
export function editImportRowCategory(
  row: ImportRow,
  categoryCode: string,
): ImportRow {
  return {
    ...row,
    categoryCode,
    costType: costTypeApplies(categoryCode)
      ? (row.costType ?? categoryOf(categoryCode).recommendedCostType ?? "variable")
      : null,
    ruleId: null,
    rulePattern: null,
    guessedFrom: null,
  };
}

/**
 * その `pattern` が、この取込の何行に当たるか（AC-57e）。
 *
 * 広すぎる `pattern`（`ﾃﾞ` が20行に当たる）に気づくための数。**判定は
 * `ruleMatches` を使う** ―― 数え方を別に書くと、当たる条件が増えたときに
 * 数だけ古くなる（CLAUDE.md §2.8）。
 *
 * **照合が成立した行は数えない。** CL-10 の対象外なので、数えると「当たる」
 * と言いながらその行では使われないことになる。**既に登録済みの行は数える**
 * ―― 取込から外れているだけで、画面にはルールで決まった費目が出る。
 */
export function countRuleMatches(
  rows: readonly ImportRow[],
  draft: Pick<ImportRule, "pattern" | "accountId" | "direction" | "categoryCode">,
): number {
  return rows.filter(
    (row) => row.matchedKey === null && ruleMatches(draft, row),
  ).length;
}

/* ========================= 予定との自動照合 ========================= */

/** 自動照合で候補にできる最大の日数差（CL-7）。 */
export const MATCH_WINDOW_DAYS = 12;

/** 照合の判定に要る、実績またはCSV行の値。 */
export interface MatchSubject {
  date: DateStr;
  amount: Yen;
  type: EntryType;
  accountId: string;
}

/**
 * 実績（またはCSVの1行）と予定インスタンスが同一取引でありうるか
 * （CL-7 予定との自動照合）。
 *
 * 次の4つをすべて満たすこと。
 *
 * - 金額が完全一致
 * - 日付の差が12日以内
 * - 収支の向きが一致
 * - **口座が一致**（予定の `accountId` が、実績の口座と同一）
 *
 * 口座を条件に入れるのは、**探す側の予定が全口座にまたがっている**ためで
 * ある。取込時に選ばせるのは取り込む実績の口座であって、候補の予定は
 * 絞られていない。ゆうちょのCSVを取り込むと、同額・同日のカードの予定に
 * 当たる。家賃 80,000 とカード引落 80,000 が同日に並ぶのは普通にあり、
 * しかも消し込みが成立してしまうので誰も気づかない（AC-33）。
 *
 * カードの予定が銀行口座のCSV行と照合される経路も、これで同時に塞がる。
 * カードの引落は CL-2 で合算された1件として銀行に現れるため、個別の利用
 * 明細とは金額が一致しない。従来は金額不一致で偶然防がれていただけだった。
 *
 * **この述語が唯一の定義である（CLAUDE.md §2.8）。** CL-7 の自動照合
 * （`matchPlan`）も FR-46 の候補提示（`isCandidate`）もここを呼ぶ。
 * 条件を2箇所に書くと、片方にだけ条件が増えて静かに食い違う。実際
 * AC-33 の「口座が一致」は両方に手で足していた。
 */
export function planMatches(
  subject: MatchSubject,
  plan: ForecastInstance,
): boolean {
  if (plan.amount !== subject.amount) return false;
  return planMatchesExceptAmount(subject, plan);
}

/**
 * `planMatches` から**金額の条件だけを外した**もの。
 *
 * 照合できなかった理由を画面に出すために要る（screens.md 05「要対応
 * （金額が一致しません）」と「要対応（候補がありません）」）。
 *
 * **planMatches の隣に置き、planMatches 自身がこれを呼ぶ。** 条件を
 * 2箇所に書くと片方にだけ条件が増える。実際 AC-33 の「口座が一致」は
 * 両方に手で足していた（上のコメント）。同じことを繰り返さない。
 */
export function planMatchesExceptAmount(
  subject: MatchSubject,
  plan: ForecastInstance,
): boolean {
  if (plan.type !== subject.type) return false;
  if (plan.accountId !== subject.accountId) return false;
  return daysBetween(plan.date, subject.date) <= MATCH_WINDOW_DAYS;
}

/**
 * 未消込の予定から自動照合の候補を1件選ぶ（CL-7 予定との自動照合）。
 *
 * 条件は `planMatches`。最初に満たした1件を返す。
 *
 * `claimed` に入っているキーは飛ばす。**1件の予定を2行が同時に消し込む
 * ことはできない。** 仕様は明記していないが、同じ予定に2つの実績が
 * 紐づくと消し込みの対応が崩れるため、1対1に制限している。
 */
export function matchPlan(
  row: MatchSubject,
  candidates: ForecastInstance[],
  claimed: ReadonlySet<string> = new Set(),
): ForecastInstance | null {
  for (const plan of candidates) {
    if (claimed.has(plan.key)) continue;
    if (planMatches(row, plan)) return plan;
  }
  return null;
}

/* ========================= 取込行の組み立て ========================= */

/**
 * 判定に使う摘要（FR-58・AC-64）。
 *
 * **原文があれば原文、無ければ表示名。**
 *
 * `name` は表示名で、実績編集でも仕分けルールの置き換え（FR-59）でも
 * 変わる。変わった行は**二度と「登録済み」にならない** ―― 利用者の
 * 「登録済みの数が毎回変わる」の一因である。
 *
 * **原文を持たない実績は表示名を原文として扱う。** 手入力の実績と、
 * 0009 より前に取り込んだ実績がこれに当たる。既存のデータは、
 * 摘要を直していない限り今までと同じ判定になる（AC-64）。
 *
 * **ここが唯一の決め方である**（CLAUDE.md §2.8）。鍵を作る側と、
 * 既存の実績を数える側の2箇所で書くと、片方だけが原文を見る状態になる。
 */
export function matchNameOf(entry: {
  name: string;
  sourceName?: string | null;
}): string {
  return entry.sourceName?.trim() || entry.name;
}

/**
 * **摘要を外した鍵**（AC-65）。口座・日付・収支・金額。
 *
 * 「摘要だけが違う行」を見つけるために要る。銀行やカードの明細は
 * **保留から確定になるときに摘要が変わる**ので、この4つが一致する行は
 * 同じ取引でありうる。**ただし外さない** ―― 同じ日に同じ額の取引が2件
 * あるのも普通のことで、摘要を見ずに外すと本物のデータが消える。
 */
export function nearKeyOf(entry: {
  accountId: string;
  date: DateStr;
  type: EntryType;
  amount: Yen;
}): string {
  return [entry.accountId, entry.date, entry.type, entry.amount].join("\u0000");
}

/**
 * 重複の判定に使うキー（FR-50・FR-58）。
 *
 * **口座・日付・収支・金額・摘要の原文が全部一致したときだけ**同じとみなす。
 *
 * **ゆるく当てない。** 同じ日に同じ額の取引が2件あるのは普通のことで
 * （同じ店で2回買う、同じ額の振込が2件来る）、摘要を見ずに当てると
 * **本物のデータを落とす。** 取りこぼし（摘要を直したあとの再取込など）は
 * 「外し忘れた行が1つ混じる」で済むが、取りすぎは**気づかないまま消える。**
 * 外す側に倒す。
 *
 * **摘要は原文で比べる**（`matchNameOf`）。取り込んだ実績は原文を
 * `source_name` に持つので、表示名を直しても同じキーになる（AC-64）。
 *
 * **この鍵で全部一致しても、同じ取引だとは限らない。** 口座・日付・収支・
 * 金額・摘要が完全に重なる行は実在する（2026年10月の実データで18行）。
 * 鍵に足せる項目はもう無いので、**結果を残高で検算する**（FR-61・AC-68）。
 */
export function duplicateKeyOf(entry: {
  accountId: string;
  date: DateStr;
  type: EntryType;
  amount: Yen;
  name: string;
  sourceName?: string | null;
}): string {
  return [nearKeyOf(entry), matchNameOf(entry)].join("\u0000");
}

/**
 * 既に保存されている実績を、重複の判定用に数える。
 *
 * **件数で持つ。** 「そのキーがあるか」で見ると、保存済み1件に対して
 * CSVの同一行2件が**両方とも重複印になる。** 実際には1件が新しい取引
 * なので、1件ぶんだけ当てて、残りは通す。
 *
 * **2つの数え方を同時に持つ**（AC-65）。原文まで一致したぶん（`exact`）と、
 * 摘要を外したぶん（`near`）である。`near` は `exact` を含む。
 */
interface DuplicatePool {
  exact: Map<string, number>;
  near: Map<string, number>;
}

function countByKey(existing: readonly Actual[], accountId: string): DuplicatePool {
  const exact = new Map<string, number>();
  const near = new Map<string, number>();

  const bump = (pool: Map<string, number>, key: string) =>
    pool.set(key, (pool.get(key) ?? 0) + 1);

  for (const actual of existing) {
    if (actual.accountId !== accountId) continue;
    bump(exact, duplicateKeyOf(actual));
    bump(near, nearKeyOf(actual));
  }

  return { exact, near };
}

/** 1件ぶん使う。残っていれば true */
function take(pool: Map<string, number>, key: string): boolean {
  const left = pool.get(key) ?? 0;
  if (left <= 0) return false;
  pool.set(key, left - 1);
  return true;
}

/** 確認画面に出す1行。利用者が修正できる。 */
export interface ImportRow {
  /** 元CSVの行番号（見出しを除いた0始まり） */
  rowIndex: number;
  /** 取込可否。既定は true */
  include: boolean;
  date: DateStr;
  /**
   * **表示名。** 空なら「（摘要なし）」。
   *
   * 仕分けルールの置き換え（FR-59）と、別の明細からの差し替え（FR-62）が
   * ここを変える。**判定には使わない**（`sourceName` を使う）。
   */
  name: string;
  /**
   * **摘要の原文**（FR-58・AC-64）。CSVから読んだまま。
   *
   * 重複判定はこれで行い、実績の `sourceName` に保存する。**どの機構も
   * ここを書き換えない** ―― 書き換えたら、次に同じ明細を読んだときに
   * 当たらなくなる。
   */
  sourceName: string;
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  bizRatio: number;
  /** 絶対値 */
  amount: Yen;
  /**
   * **その行の時点の残高**（FR-61・AC-68）。列が無ければ null。
   *
   * 取込の結果を検算するためだけに持つ（`core/balance-check.ts`）。実績には
   * 保存しない ―― 残高は口座の属性であって1件の取引の属性ではなく、
   * 保存すると同じ残高が2箇所から出る（CLAUDE.md §2.12）。
   */
  balance: Yen | null;
  accountId: string;
  /** 自動照合された予定インスタンスのキー。無ければ null */
  matchedKey: string | null;
  /** 照合先の内容。確認画面で明示する */
  matchedName: string | null;
  /** 費目推定のもとになった名称。無ければ null */
  guessedFrom: string | null;
  /**
   * **仕分けルールで決まった行**（FR-18・CL-10）。そのルールの id。
   *
   * `guessedFrom` とは**排他である。** ルールが当たった行には推定を当てない
   * （AC-57a。利用者が意図して作ったものが機械の推定に勝つ）。確認画面は
   * この2つで「ルールで決まった」「推定で決まった」を書き分ける。
   *
   * **行を手で直したら null に戻す。** そのルールで決まった値ではなくなる
   * ので、表示も「ルール」ではなくなり、「このルールを使わない」で
   * 決め直す対象からも外れる（AC-57b）。
   */
  ruleId: string | null;
  /** 当たったルールの `pattern`。確認画面に出す */
  rulePattern: string | null;
  /**
   * 照合の結果（screens.md 05「照合」列）。
   *
   * `amountDiffers` は「日付も口座も種別も合う予定はあるが、金額が違う」。
   * 利用者が次にすることが変わる（金額を直すのか、予定を作るのか）ので、
   * 「候補がありません」と同じ文言にしない。
   */
  matchHint: "matched" | "amountDiffers" | "noCandidate";
  /**
   * **既に保存されている実績との重なり**（FR-50・AC-65）。
   *
   * | | | 取込 |
   * |---|---|---|
   * | `none` | 重なる実績が無い | **入れる** |
   * | `similar` | 口座・日付・収支・金額は一致、**摘要の原文が違う** | **入れる** |
   * | `registered` | 原文まで一致 | **外す** |
   *
   * **`similar` は外さない**（AC-65）。銀行やカードの明細は保留から確定に
   * なるときに摘要が変わるので、摘要だけで外すと取り落とす。一方、摘要を
   * 見ずに外すと別の取引を外す。**外すのは取り落とし、出すだけなら
   * 利用者が判断できる。**
   *
   * **`matchHint` とは別の軸である。** あちらは「予定と照合できたか」、
   * こちらは「実績として既に入っているか」。混ぜると、照合できなかった
   * 重複行と、照合できた新規行の区別がつかなくなる（CLAUDE.md §2.12）。
   */
  duplicate: "none" | "similar" | "registered";
}

export interface BuildImportRowsInput {
  /** parseCsv の出力 */
  rows: string[][];
  mapping: ColumnMapping;
  /** 取り込む口座・カードの id */
  accountId: string;
  /** 未消込の予定インスタンス（CL-3 の unmatchedForecast） */
  candidates?: ForecastInstance[];
  /** 費目推定のもとになる既存の項目 */
  history?: HistoryEntry[];
  /**
   * **既に保存されている実績**（FR-50）。重複の判定に使う。
   *
   * 口座での絞り込みはこの中でやるので、全件そのまま渡してよい。
   */
  existing?: readonly Actual[];
  /**
   * **仕分けルール**（FR-18・CL-10）。利用者が作ったもの全件。
   *
   * 口座と向きでの絞り込みは `ruleMatches` がやるので、そのまま渡してよい。
   * 「このルールを使わない」で外したぶんは**呼び出し側が除いて渡す**
   * （ここで外すと取込行を丸ごと作り直すことになる。AC-57b）。
   */
  rules?: readonly ImportRule[];
}

/** 摘要が空のときの表示。 */
export const NO_DESCRIPTION = "（摘要なし）";

/**
 * 解析結果から確認画面の行を組み立てる。
 *
 * 日付が読めない行と、金額が0または読めない行は落とす。見出し行の判定は
 * `mapping.hasHeader` に従う。
 *
 * 符号の解釈（CL-7）：
 *   入金列・出金列が分かれている場合は入金を正、出金を負とする
 *   1列の場合は `sign` に従う
 *
 * **照合と費目推定の優先順位（CL-7、AC-45）。** 照合が成立した行は
 * 費目・固定変動区分・事業割合を**照合先の予定から引き継ぐ**。名称からの
 * 推定は、照合が成立しなかった行にだけ当てる。
 *
 * 2つを独立に動かすと、照合できているのに費目が推定（多くは雑費）に
 * なる。**銀行CSVの摘要は半角カナが多く、名称の先頭4文字の部分一致は
 * 原理的に当たりにくい。** 「事務所家賃」は「ﾌﾘｺﾐ ｼﾞﾑｼｮﾔﾁﾝ」に含まれない。
 * 照合先の予定のほうが確実な情報である。
 *
 * 合計では見えない誤りになる。予定側は地代家賃・固定費、実績側は雑費・
 * 変動費となり、CL-5 の差異が2つの費目に割れる。事業割合が 100 → 0 に
 * なると、その額が事業から家計へ移る。
 *
 * 金額は実績の値を使う。予定と違ってよい（消し込みは `key` の一致だけで
 * 決まる。CL-3）。
 */
export function buildImportRows(input: BuildImportRowsInput): ImportRow[] {
  const { rows, mapping, accountId } = input;
  const candidates = input.candidates ?? [];
  const history = input.history ?? [];

  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const claimed = new Set<string>();
  /* **同じファイルの中の同一行どうしは当てない。** 明細に同じ行が2つ
     並ぶのは実在の2件なので、消費するのは保存済みのぶんだけ */
  const registered = countByKey(input.existing ?? [], accountId);
  const out: ImportRow[] = [];

  body.forEach((cells, rowIndex) => {
    const date = normalizeDate(cells[mapping.date] ?? "");
    if (!date) return;

    const signed = readAmount(cells, mapping);
    if (signed === null || signed === 0) return;

    const type: EntryType = signed > 0 ? "income" : "expense";
    const amount = Math.abs(signed);
    const name =
      String(cells[mapping.name] ?? "").trim() || NO_DESCRIPTION;
    /* **読めない残高は null。** 0 にすると鎖が繋がらないのに
       繋がっているように見える（`checkBalance` が `broken` を返せない） */
    const balance =
      mapping.balance >= 0
        ? normalizeAmount(cells[mapping.balance] ?? "")
        : null;

    const matched = matchPlan(
      { date, amount, type, accountId },
      candidates,
      claimed,
    );
    if (matched) claimed.add(matched.key);


    /* **照合 → ルール → 推定 → 受け皿。** 決め方は1箇所にある（CL-10） */
    const decided = classifyImportRow(
      { name, type, accountId },
      { matched, rules: input.rules, history },
    );

    out.push({
      rowIndex,
      /* 重複の判定は全行を組み立てたあと（`markDuplicates`）。
         **原文まで一致した行に先に枠を使わせる**ため、1行ずつ決められない */
      include: true,
      duplicate: "none",
      date,
      name,
      /* **原文は読んだまま。** 以降どの機構も書き換えない（FR-58） */
      sourceName: name,
      type,
      costType: decided.costType,
      categoryCode: decided.categoryCode,
      bizRatio: decided.bizRatio,
      amount,
      balance,
      accountId,
      matchedKey: matched?.key ?? null,
      matchedName: matched?.name ?? null,
      guessedFrom: decided.guessedFrom,
      ruleId: decided.ruleId,
      rulePattern: decided.rulePattern,
      matchHint: matched
        ? ("matched" as const)
        : candidates.some((plan) =>
              planMatchesExceptAmount({ date, type, amount, accountId }, plan),
            )
          ? ("amountDiffers" as const)
          : ("noCandidate" as const),
    });
  });

  return markDuplicates(out, registered);
}

/**
 * 既に保存されている実績との重なりを決める（FR-50・AC-65）。
 *
 * **2段階で決める。原文まで一致した行に先に枠を使わせる。**
 *
 * 1行ずつ決めると、**先に来た行が「似た行」の枠を取ってしまう。**
 * 保存済みが摘要 B の1件、CSVが A・B の2行という場合、
 *
 *   1行ずつ  A が似た行の枠を取る → `[似た行, 登録済み]`
 *   2段階    B が先に枠を使う     → `[なし, 登録済み]`
 *
 * **正しいのは後者。** 保存済みの1件は B そのものであって、A に対応する
 * 実績は無い。A は新しい取引なので、警告を出す相手がいない。**在りもしない
 * 相手について「似た行があります」と出すと、利用者はその警告を見なくなる。**
 *
 * **同じファイルの中の同一行どうしは当てない。** 明細に同じ行が2つ並ぶのは
 * 実在の2件なので、消費するのは保存済みのぶんだけである。
 */
function markDuplicates(
  rows: readonly ImportRow[],
  pool: DuplicatePool,
): ImportRow[] {
  const mark = new Map<number, ImportRow["duplicate"]>();

  /* 段階1：原文まで一致した行。`near` の枠も同時に使う */
  for (const row of rows) {
    if (!take(pool.exact, duplicateKeyOf(row))) continue;
    take(pool.near, nearKeyOf(row));
    mark.set(row.rowIndex, "registered");
  }

  /* 段階2：残った行のうち、摘要だけが違うもの */
  for (const row of rows) {
    if (mark.has(row.rowIndex)) continue;
    if (!take(pool.near, nearKeyOf(row))) continue;
    mark.set(row.rowIndex, "similar");
  }

  return rows.map((row) => {
    const duplicate = mark.get(row.rowIndex) ?? "none";
    return {
      ...row,
      duplicate,
      /* **原文まで一致した行だけ外す**（AC-65）。消すのではなく外すだけに
         して、利用者が入れ直せるようにする。`similar` は入れたままにする
         ―― 外すと取り落とし、出すだけなら利用者が判断できる */
      include: duplicate !== "registered",
    };
  });
}

/** 1行から符号つきの金額を読む。入金が正、出金が負。 */
function readAmount(cells: string[], mapping: ColumnMapping): Yen | null {
  if (mapping.inflow >= 0 || mapping.outflow >= 0) {
    const inflow =
      mapping.inflow >= 0 ? normalizeAmount(cells[mapping.inflow] ?? "") : null;
    if (inflow !== null && inflow !== 0) return Math.abs(inflow);

    const outflow =
      mapping.outflow >= 0 ? normalizeAmount(cells[mapping.outflow] ?? "") : null;
    if (outflow !== null && outflow !== 0) return -Math.abs(outflow);

    return null;
  }

  if (mapping.amount < 0) return null;
  const value = normalizeAmount(cells[mapping.amount] ?? "");
  if (value === null) return null;
  return mapping.sign === "outMinus" ? value : -value;
}

/**
 * 取込行を実績にする（CL-7 一括登録）。
 *
 * **ここが唯一の変換である**（CLAUDE.md §2.8）。登録のときと、登録前の
 * 検算（FR-61）のときの2箇所から呼ぶ。別々に書くと、**画面に出した検算の
 * 額と、実際に登録される額が違う**という形で食い違う ―― しかも登録するまで
 * 誰も気づけない。
 *
 * `id` は呼び出し側が渡す。`newId()` は乱数なので core では呼べない（§2.3）。
 */
export function actualFromImportRow(row: ImportRow, id: string): Actual {
  return {
    id,
    key: row.matchedKey,
    date: row.date,
    name: row.name,
    type: row.type,
    costType: row.costType,
    categoryCode: row.categoryCode,
    amount: row.amount,
    bizRatio: row.bizRatio,
    accountId: row.accountId,
    /* **原文を保存する**（FR-58・AC-64）。表示名を直しても判定は変わらない */
    sourceName: row.sourceName,
  };
}
