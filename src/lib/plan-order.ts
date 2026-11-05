import { compareDate } from "@/core/date";
import type { CostType, EntryType } from "@/core/types";

/**
 * 予定の表の並び順
 *
 * **設定の表は常時編集できるグリッドで、並べ替えの基準になる列も編集
 * できる。** 毎描画で並べ直すと、値を変えた瞬間に行が動く。単発の予定は
 * 日付の昇順に並べていて日付欄が編集できるので、**並べ替えを足す前から
 * 既に動いていた。** 金額で並べ替えれば「1 → 12 → 120 → 1200」で
 * 1打鍵ごとに行が歩く（`onChange` が1打鍵ごとに `data` を書く）。
 *
 * だから**順序は「いつ決め直すか」を明示して持つ。** 決め直すのは
 * 見出しを押したときと、行が増減したときだけ。**値が変わっても動かさない。**
 */

/** 並べ替えられる列。`when` は定期項目では発生日、単発の予定では日付 */
export type PlanSortColumn =
  | "name"
  | "type"
  | "costType"
  | "category"
  | "amount"
  | "account"
  | "when";

export type SortDirection = "asc" | "desc";

export interface PlanSort {
  column: PlanSortColumn;
  direction: SortDirection;
}

/** 見出しを押したときの次の状態。同じ列なら向きを反転、違う列なら昇順から */
export function nextSort(current: PlanSort, column: PlanSortColumn): PlanSort {
  if (current.column !== column) return { column, direction: "asc" };
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

/**
 * 収支の並び。**画面のプルダウンと同じ順にする。**
 * 名前の五十音で並べると画面と食い違う。
 */
const TYPE_ORDER: Record<EntryType, number> = { income: 0, expense: 1, transfer: 2 };

/** 固定/変動の並び。null（収入・振替）は後ろ */
const COST_ORDER: Record<CostType, number> = { fixed: 0, variable: 1 };

/** 並べ替えの対象になる行が持っていなければならない値 */
export interface PlanSortable {
  id: string;
  name: string;
  type: EntryType;
  costType: CostType | null;
  categoryCode: string;
  amount: number;
  accountId: string;
}

/** 日付列の値。定期項目は発生日（数）、単発の予定は日付（文字列） */
export type WhenValue = number | string;

function compareWhen(a: WhenValue, b: WhenValue): number {
  /* **数は数として比べる。** 文字列にすると発生日 10 が 2 より前に来る */
  if (typeof a === "number" && typeof b === "number") return a - b;
  return compareDate(String(a), String(b));
}

/**
 * 並べ替えの比較関数を作る。
 *
 * `accountIds` は口座の表示順。**名前で並べない。** プルダウンの順と
 * 食い違うと、同じ口座が表と選択肢で違う位置に出る。
 *
 * `when` は日付列の値を取り出す。表ごとに違う（発生日 / 日付）。
 *
 * **同値は必ず id で割る。** 割らないと、値が等しい行の相対位置が
 * `sort` の実装次第になり、同じ操作で違う並びが出る（要件定義書 §6.2 の
 * 「並び替えキーが一意であること」と同じ理由）。
 */
export function comparePlans<T extends PlanSortable>(
  sort: PlanSort,
  accountIds: readonly string[],
  when: (item: T) => WhenValue,
): (a: T, b: T) => number {
  const accountIndex = new Map(accountIds.map((id, at) => [id, at]));
  const indexOf = (id: string) => accountIndex.get(id) ?? accountIds.length;

  const direction = sort.direction === "asc" ? 1 : -1;

  return (a, b) => {
    let diff = 0;

    switch (sort.column) {
      case "name":
        diff = a.name.localeCompare(b.name, "ja");
        break;
      case "type":
        diff = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
        break;
      case "costType":
        diff =
          (a.costType ? COST_ORDER[a.costType] : 2) -
          (b.costType ? COST_ORDER[b.costType] : 2);
        break;
      case "category":
        /* 費目はコードの昇順（要件定義書 §3.1.2 適用規則3）。表示名で
           並べない。名称は将来変わりうる */
        diff = a.categoryCode.localeCompare(b.categoryCode);
        break;
      case "amount":
        diff = a.amount - b.amount;
        break;
      case "account":
        diff = indexOf(a.accountId) - indexOf(b.accountId);
        break;
      case "when":
        diff = compareWhen(when(a), when(b));
        break;
    }

    if (diff !== 0) return diff * direction;

    /* **同値の割り方は向きで反転させない。** 反転させると、向きを
       変えただけで同値の行どうしが入れ替わって見える */
    return a.id.localeCompare(b.id);
  };
}

/**
 * 見出しを押したときの順序。
 *
 * ここだけが並べ直す。**描画のたびには呼ばない。**
 */
export function freshOrder<T extends { id: string }>(
  rows: readonly T[],
  compare: (a: T, b: T) => number,
): string[] {
  return [...rows].sort(compare).map((row) => row.id);
}

/**
 * 覚えている順序のまま、いまある行を並べる。
 *
 * **id の集合だけを見る。値は見ない。** だから金額や日付を打ち替えても
 * 行は動かない。
 *
 * - 覚えている順序に無い行は**末尾**に付ける。互いは `compare` で並べる
 * - 覚えている順序が空（初回）なら全部が末尾あつかいなので、結果は
 *   完全に並ぶ
 * - 覚えている順序にあって、いま無い行（消した行）は落とす
 *
 * **増えた行を並べ込まずに末尾へ出すのは意図。** 追加した直後の空行が
 * 表の真ん中に入ると、いま足した行が見つからない。
 */
export function applyOrder<T extends { id: string }>(
  previous: readonly string[],
  rows: readonly T[],
  compare: (a: T, b: T) => number,
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept: T[] = [];

  for (const id of previous) {
    const row = byId.get(id);
    if (!row) continue;
    kept.push(row);
    byId.delete(id);
  }

  return [...kept, ...[...byId.values()].sort(compare)];
}
