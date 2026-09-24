import { describe, expect, it } from "vitest";

import { fetchAll, IncompleteLoadError, PAGE_SIZE } from "../supabase/fetch-all";

/**
 * FR-47 / AC-34・AC-35。
 *
 * 一次情報：docs/要件定義書.md §5.1.2「データ取得の完全性」
 *
 * PostgREST は1回の応答で返す行数に上限を持つ（既定 1000）。`select("*")` は
 * この上限で黙って打ち切られ、短い配列がそのまま返る。それを CL-3 に渡すと
 * 残高が静かに間違う。
 *
 * Supabase のクライアントを型だけ真似た偽物で検査する。実サーバーを立てず、
 * 上限・順序・総件数の食い違いを自由に作れるようにするため。
 */

interface Row {
  id: string;
  date: string;
}

/** `date` 昇順・`id` 昇順に並んだ行を作る */
function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i).padStart(6, "0"),
    date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
  }));
}

interface FakeOptions {
  /** 1回に返せる上限。既定は PAGE_SIZE */
  maxRows?: number;
  /** count として返す値。既定は絞り込み後の実件数 */
  reportedCount?: number;
  /** order を無視して並びを崩す（順序を固定しない実装の再現） */
  ignoreOrder?: boolean;
  /** サーバーがエラーを返す */
  error?: string;
}

/**
 * Supabase クライアントの偽物。
 *
 * `order` が呼ばれたかどうかを覚えておき、`ignoreOrder` のときは要求された
 * 並びを無視して毎回シャッフルした集合から切り出す。順序を固定せずに範囲で
 * 分割したときに何が起きるかを再現するため。
 */
function fakeSupabase(all: Row[], opts: FakeOptions = {}) {
  const maxRows = opts.maxRows ?? PAGE_SIZE;
  const calls: { from: number; to: number; ordered: string[] }[] = [];

  const client = {
    from() {
      let gte: { column: string; value: string } | null = null;
      let range: { from: number; to: number } = { from: 0, to: maxRows - 1 };
      const ordered: string[] = [];

      const builder = {
        select() {
          return builder;
        },
        gte(column: string, value: string) {
          gte = { column, value };
          return builder;
        },
        order(column: string) {
          ordered.push(column);
          return builder;
        },
        range(from: number, to: number) {
          range = { from, to };
          return builder;
        },
        then(resolve: (r: unknown) => void) {
          calls.push({ ...range, ordered: [...ordered] });

          let rows = all;
          if (gte) {
            const g = gte as { column: string; value: string };
            rows = rows.filter(
              (r) => (r as unknown as Record<string, string>)[g.column] >= g.value,
            );
          }

          if (opts.error) {
            resolve({ data: null, error: { message: opts.error }, count: null });
            return;
          }

          const count = opts.reportedCount ?? rows.length;

          /* 順序を固定しない実装の再現。ページごとに並びが変わる */
          const source = opts.ignoreOrder
            ? [...rows].sort(() => (calls.length % 2 === 0 ? 1 : -1))
            : rows;

          const size = Math.min(range.to - range.from + 1, maxRows);
          const data = source.slice(range.from, range.from + size);
          resolve({ data, error: null, count });
        },
      };
      return builder;
    },
  };

  return { client: client as never, calls };
}

/* ========================= 分割取得 ========================= */

describe("AC-34 上限を超えても全件を取る", () => {
  it("上限ちょうどなら1回で終わる", async () => {
    const { client, calls } = fakeSupabase(makeRows(PAGE_SIZE));

    const got = await fetchAll<Row>(client, "actuals");

    expect(got).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(1);
  });

  it("上限を超えたら分割して全件を取る", async () => {
    const { client, calls } = fakeSupabase(makeRows(2_500));

    const got = await fetchAll<Row>(client, "actuals");

    expect(got).toHaveLength(2_500);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("重複と欠落がない", async () => {
    const all = makeRows(2_500);
    const { client } = fakeSupabase(all);

    const got = await fetchAll<Row>(client, "actuals");
    const ids = got.map((r) => r.id);

    expect(new Set(ids).size).toBe(2_500);
    expect(ids).toEqual(all.map((r) => r.id));
  });

  it("実績10万件でも全件を取る", async () => {
    const { client } = fakeSupabase(makeRows(100_000));

    const got = await fetchAll<Row>(client, "actuals");

    expect(got).toHaveLength(100_000);
    expect(new Set(got.map((r) => r.id)).size).toBe(100_000);
  });

  it("上限が想定より小さい環境でも全件を取る", async () => {
    /* Max rows を下げてある、あるいは既定が変わった場合 */
    const { client } = fakeSupabase(makeRows(2_500), { maxRows: 100 });

    const got = await fetchAll<Row>(client, "actuals");

    expect(got).toHaveLength(2_500);
  });

  it("0件なら空で返る", async () => {
    const { client } = fakeSupabase([]);

    expect(await fetchAll<Row>(client, "actuals")).toEqual([]);
  });
});

/* ========================= 順序の固定 ========================= */

describe("AC-34 順序を固定する", () => {
  it("date と id で並べるよう要求している", async () => {
    const { client, calls } = fakeSupabase(makeRows(10));

    await fetchAll<Row>(client, "actuals", {
      since: { column: "date", value: "2026-01-01" },
    });

    expect(calls[0].ordered).toEqual(["date", "id"]);
  });

  it("日付を持たないテーブルでも id で並べる", async () => {
    const { client, calls } = fakeSupabase(makeRows(10));

    await fetchAll<Row>(client, "accounts");

    expect(calls[0].ordered).toEqual(["id"]);
  });

  it("一意な列を指定できる", () => {
    /* overrides は主キーが plan_key で id 列を持たない。実サーバーでは
       order("id") が `column overrides.id does not exist` で落ちる */
    const { client, calls } = fakeSupabase(makeRows(10));

    return fetchAll<Row>(client, "overrides", { idColumn: "plan_key" }).then(
      () => {
        expect(calls[0].ordered).toEqual(["plan_key"]);
      },
    );
  });

  /**
   * 順序を固定しないと何が起きるかの実証。
   *
   * ページごとに並びが変わると、同じ行が2回返り別の行が1回も返らない。
   * **しかも件数は一致するので、下の切り捨て検知をすり抜ける。**
   * だから順序の固定と件数の検知は両方いる（§5.1.2）。
   */
  it("順序が崩れると、件数が合っていても中身が壊れる", async () => {
    const { client } = fakeSupabase(makeRows(2_500), { ignoreOrder: true });

    const got = await fetchAll<Row>(client, "actuals");

    /* 例外は飛ばない。件数は合っている */
    expect(got).toHaveLength(2_500);
    /* それでも重複と欠落がある */
    expect(new Set(got.map((r) => r.id)).size).toBeLessThan(2_500);
  });
});

/* ========================= 範囲の指定 ========================= */

describe("基準日以降に絞る（§5.1）", () => {
  it("基準日より前の行を読まない", async () => {
    const all: Row[] = [
      { id: "a", date: "2025-12-31" },
      { id: "b", date: "2026-01-01" },
      { id: "c", date: "2026-06-01" },
    ];
    const { client } = fakeSupabase(all);

    const got = await fetchAll<Row>(client, "actuals", {
      since: { column: "date", value: "2026-01-01" },
    });

    expect(got.map((r) => r.id)).toEqual(["b", "c"]);
  });
});

/* ========================= 切り捨ての検知 ========================= */

describe("AC-35 切り捨てを検知する", () => {
  it("総件数より少なければ例外にする", async () => {
    /* サーバーが「3000件ある」と言いながら1000件しか返さない状態 */
    const { client } = fakeSupabase(makeRows(1_000), { reportedCount: 3_000 });

    await expect(fetchAll<Row>(client, "actuals")).rejects.toThrow(
      IncompleteLoadError,
    );
  });

  it("例外は件数を持つ。イベントに残すため", async () => {
    const { client } = fakeSupabase(makeRows(1_000), { reportedCount: 3_000 });

    const error = await fetchAll<Row>(client, "actuals").catch((e) => e);

    expect(error).toBeInstanceOf(IncompleteLoadError);
    expect(error.table).toBe("actuals");
    expect(error.expected).toBe(3_000);
    expect(error.received).toBe(1_000);
  });

  it("件数が合っていれば例外にしない", async () => {
    const { client } = fakeSupabase(makeRows(1_500));

    await expect(fetchAll<Row>(client, "actuals")).resolves.toHaveLength(1_500);
  });

  it("サーバーのエラーはそのまま投げる", async () => {
    const { client } = fakeSupabase(makeRows(10), { error: "boom" });

    await expect(fetchAll<Row>(client, "actuals")).rejects.toThrow("boom");
  });
});
