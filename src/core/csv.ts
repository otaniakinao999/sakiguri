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
  groupOfCategory,
} from "./categories";
import { daysBetween, parseDate } from "./date";
import type {
  CostType,
  DateStr,
  EntryType,
  ForecastInstance,
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
  /** 1行目が見出しか */
  hasHeader: boolean;
}

const HEADER_PATTERNS = {
  date: /日付|年月日|取引日|利用日|ご利用日|日時/,
  name: /摘要|内容|お取引内容|利用店名|ご利用先|店名|備考|明細/,
  inflow: /入金|お預り|お預入|預入/,
  outflow: /出金|お支払|お引出|引出|支払金額/,
  amount: /金額/,
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
    const taken = new Set([date, inflow, outflow, amount].filter((i) => i >= 0));
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

/* ========================= 予定との自動照合 ========================= */

/** 自動照合で候補にできる最大の日数差（CL-7）。 */
export const MATCH_WINDOW_DAYS = 12;

/**
 * 未消込の予定から自動照合の候補を1件選ぶ（CL-7 予定との自動照合）。
 *
 * 次の4つをすべて満たす最初の1件を返す。
 *
 * - 金額が完全一致
 * - 日付の差が12日以内
 * - 収支の向きが一致
 * - **口座が一致**（予定の `accountId` が、取込対象として選んだ口座と同一）
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
 * `claimed` に入っているキーは飛ばす。**1件の予定を2行が同時に消し込む
 * ことはできない。** 仕様は明記していないが、同じ予定に2つの実績が
 * 紐づくと消し込みの対応が崩れるため、1対1に制限している。
 */
export function matchPlan(
  row: { date: DateStr; amount: Yen; type: EntryType; accountId: string },
  candidates: ForecastInstance[],
  claimed: ReadonlySet<string> = new Set(),
): ForecastInstance | null {
  for (const plan of candidates) {
    if (claimed.has(plan.key)) continue;
    if (plan.amount !== row.amount) continue;
    if (plan.type !== row.type) continue;
    if (plan.accountId !== row.accountId) continue;
    if (daysBetween(plan.date, row.date) > MATCH_WINDOW_DAYS) continue;
    return plan;
  }
  return null;
}

/* ========================= 取込行の組み立て ========================= */

/** 確認画面に出す1行。利用者が修正できる。 */
export interface ImportRow {
  /** 元CSVの行番号（見出しを除いた0始まり） */
  rowIndex: number;
  /** 取込可否。既定は true */
  include: boolean;
  date: DateStr;
  /** 摘要。空なら「（摘要なし）」 */
  name: string;
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  bizRatio: number;
  /** 絶対値 */
  amount: Yen;
  accountId: string;
  /** 自動照合された予定インスタンスのキー。無ければ null */
  matchedKey: string | null;
  /** 照合先の内容。確認画面で明示する */
  matchedName: string | null;
  /** 費目推定のもとになった名称。無ければ null */
  guessedFrom: string | null;
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
 */
export function buildImportRows(input: BuildImportRowsInput): ImportRow[] {
  const { rows, mapping, accountId } = input;
  const candidates = input.candidates ?? [];
  const history = input.history ?? [];

  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const claimed = new Set<string>();
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

    const guess = guessFromHistory(name, history, type);
    const categoryCode =
      guess?.categoryCode ??
      (type === "income" ? FALLBACK_INCOME : FALLBACK_EXPENSE);
    const costType =
      type === "income"
        ? null
        : (guess?.costType ?? categoryOf(categoryCode).recommendedCostType ?? "variable");

    const matched = matchPlan(
      { date, amount, type, accountId },
      candidates,
      claimed,
    );
    if (matched) claimed.add(matched.key);

    out.push({
      rowIndex,
      include: true,
      date,
      name,
      type,
      costType,
      categoryCode,
      /* 事業割合の初期値は0。費目マスタは事業割合を持たない
         （要件定義書 §3.1.2 適用規則7）。過去の項目から推定できた
         場合だけ、その値を引き継ぐ */
      bizRatio: guess?.bizRatio ?? 0,
      amount,
      accountId,
      matchedKey: matched?.key ?? null,
      matchedName: matched?.name ?? null,
      guessedFrom: guess?.from ?? null,
    });
  });

  return out;
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
