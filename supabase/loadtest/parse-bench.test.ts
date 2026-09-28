/**
 * 読み込み後（パース以降）に何秒かかるかのローカル再現。
 *
 * **実機ではない。** 実機で取れるのは通信までで、JSON.parse から先は
 * resource timing に出ない。ここで測るのは
 *   JSON.parse → toActual の変換 → CL-1 展開 → CL-3 残高 → ダッシュボード
 * の4段。機械が違うので絶対値は実機と一致しない。**比率と桁**を見る。
 */

import { gzipSync } from "node:zlib";

import { describe, it } from "vitest";

import { buildBalanceSeries } from "@/core/balance";
import { buildForecast } from "@/core/forecast";
import { toActual } from "@/lib/supabase/rows";
import type { ActualRow } from "@/lib/supabase/rows";
import { buildDashboard } from "@/lib/dashboard";
import type { Account, ForecastInstance, RecurringItem } from "@/core/types";

const AS_OF = "2026-01-01";
const N = 100_000;
const TODAY = "2026-09-28";

const BANK = "11111111-1111-1111-1111-111111111111";
const JIGYOU = "22222222-2222-2222-2222-222222222222";
const CARD = "33333333-3333-3333-3333-333333333333";
const USER = "97659f3d-da4c-483c-b460-9e49b61be482";

function addDays(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return t.toISOString().slice(0, 10);
}

/** 投入 SQL と同じ形の行を作る */
function makeRows(): ActualRow[] {
  const rows: ActualRow[] = [];
  for (let i = 1; i <= N; i++) {
    rows.push({
      id: `a${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      user_id: USER,
      plan_key: null,
      unplanned: true,
      date: addDays(AS_OF, Math.floor(i / 100)),
      name: `負荷試験 ${i}`,
      type: i % 20 === 0 ? "income" : "expense",
      cost_type: i % 20 === 0 ? null : i % 5 === 0 ? "fixed" : "variable",
      category_code:
        i % 20 === 0 ? "INC-01" : i % 5 === 0 ? "EXP-01" : i % 7 === 0 ? "EXP-02" : "EXP-21",
      amount: i % 20 === 0 ? 300000 + (i % 50) * 1000 : 500 + (i % 9000),
      biz_ratio: i % 3 === 0 ? 100 : 0,
      account_id: i % 3 === 1 ? CARD : i % 3 === 2 ? JIGYOU : BANK,
      to_account_id: null,
    } as ActualRow);
  }
  return rows;
}

const accounts: Account[] = [
  { id: BANK, name: "生活口座", kind: "bank", balance: 1_200_000 },
  { id: JIGYOU, name: "事業口座", kind: "bank", balance: 3_400_000 },
  {
    id: CARD,
    name: "事業カード",
    kind: "card",
    balance: 0,
    unbilledBalance: 0,
    closingDay: 15,
    payMonthOffset: 1,
    payDay: 10,
    settleAccountId: JIGYOU,
  },
] as Account[];

const recurring: RecurringItem[] = Array.from({ length: 50 }, (_, k) => ({
  id: `r${k}`,
  name: `定期 ${k}`,
  type: k % 10 === 0 ? "income" : "expense",
  costType: k % 10 === 0 ? null : "fixed",
  categoryCode: k % 10 === 0 ? "INC-01" : "EXP-01",
  amount: 10_000 + k * 1_000,
  bizRatio: 100,
  accountId: k % 2 === 0 ? BANK : JIGYOU,
  day: (k % 28) + 1,
  months: null,
  active: true,
})) as RecurringItem[];

describe("読み込み後のコスト（ローカル再現）", () => {
  it("パース以降の内訳を出す", () => {
    const at = (label: string, f: () => unknown) => {
      const t0 = performance.now();
      const v = f();
      const ms = performance.now() - t0;
      console.log(`  ${label.padEnd(34)} ${Math.round(ms).toLocaleString().padStart(8)} ms`);
      return { v, ms };
    };

    console.log("\n===== 読み込み後のコスト（ローカル再現・実機ではない） =====");
    const rows = makeRows();
    /* 実際に送られてくるのは 1000 件 × 100 ページ。まとめて測る */
    const text = JSON.stringify(rows);

    /* `select("*")` だったころの本文と比べる。DB はどのテーブルにも
       created_at と updated_at を持つが、Row 型にはどちらも無い。
       **時刻は行ごとに散らす。** 投入 SQL は1文で入れたので全行が同じ値に
       なるが、それだと gzip に有利すぎて実利用の判断材料にならない */
    const stamp = (i: number) =>
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 137_000).toISOString();
    const withUnused = JSON.stringify(
      rows.map((r, i) => ({
        ...r,
        created_at: stamp(i),
        updated_at: stamp(i + 3),
      })),
    );
    /* 投入SQLどおり全行が同じ時刻の場合。負荷試験の実測はこちらになる */
    const withUnusedFlat = JSON.stringify(
      rows.map((r) => ({
        ...r,
        created_at: stamp(0),
        updated_at: stamp(0),
      })),
    );
    const narrowed = JSON.stringify(
      rows.map((r) => {
        const rest: Partial<ActualRow> = { ...r };
        delete rest.user_id;
        return rest;
      }),
    );
    const mbOf = (n: number) => (n / 1024 / 1024).toFixed(1).padStart(5) + " MB";
    /* **圧縮後で比べないと意味がない。** user_id と created_at は行ごとに
       ほぼ同じ文字列なので、gzip だとほとんど場所を取らない。生の削減幅を
       そのまま転送時間の削減として読むと過大評価になる */
    const gz = (s: string) => gzipSync(Buffer.from(s), { level: 6 }).length;
    const pct = (a: number, b: number) => {
      const r = 100 - (a / b) * 100;
      return r >= 0 ? `−${r.toFixed(0)}%` : `+${(-r).toFixed(0)}%（増える）`;
    };
    console.log("  列を絞るとどれだけ減るか                 生       gzip");
    console.log(
      `    select(*) 相当・時刻が行ごとに違う   ${mbOf(withUnused.length)} ${mbOf(gz(withUnused))}   ← 実利用`,
    );
    console.log(
      `    select(*) 相当・全行が同じ時刻       ${mbOf(withUnusedFlat.length)} ${mbOf(gz(withUnusedFlat))}   ← 投入SQLのデータ`,
    );
    console.log(`    読む列だけ                           ${mbOf(narrowed.length)} ${mbOf(gz(narrowed))}`);
    console.log(
      `      実利用に対して   生 ${pct(narrowed.length, withUnused.length)} / gzip ${pct(gz(narrowed), gz(withUnused))}`,
    );
    console.log(
      `      投入SQLに対して  生 ${pct(narrowed.length, withUnusedFlat.length)} / gzip ${pct(gz(narrowed), gz(withUnusedFlat))}` +
        "   ← **負荷試験の実測はこちら。効きを過小に見せる**",
    );
    console.log(`  以降の計測に使う本文                   ${mbOf(text.length)}`);
    console.log(
      "    ※ 作り物のデータは同じ文字列の繰り返しが多く、gzip の絶対値は実機より\n" +
        "      小さく出る。ここで意味があるのは3行の**比**だけ。",
    );

    const parsed = at("JSON.parse", () => JSON.parse(text) as ActualRow[]);
    const mapped = at("toActual の変換（10万件）", () =>
      (parsed.v as ActualRow[]).map(toActual),
    );
    const forecast = at("CL-1 buildForecast", () =>
      buildForecast(
        { recurring, oneoffs: [], overrides: {} },
        AS_OF,
        addDays(AS_OF, 1100),
      ),
    );
    const series = at("CL-3 buildBalanceSeries", () =>
      buildBalanceSeries(
        {
          accounts,
          asOf: AS_OF,
          forecast: forecast.v as ForecastInstance[],
          actuals: mapped.v as ReturnType<typeof toActual>[],
        },
        addDays(AS_OF, 1100),
        TODAY,
      ),
    );
    at("ダッシュボードの組み立て", () =>
      buildDashboard({
        series: series.v as Parameters<typeof buildDashboard>[0]["series"],
        accounts,
        reserveLine: 0,
        today: TODAY,
      }),
    );

    /* 空のデータを速く処理しただけ、を防ぐ */
    const f = forecast.v as ForecastInstance[];
    const s = series.v as { rows: unknown[]; unmatchedForecast: unknown[] };
    console.log(
      `  （確認）予定インスタンス ${f.length} 件 ／ 日次の行 ${s.rows.length} 件 ／ ` +
        `未消込 ${s.unmatchedForecast.length} 件 ／ 実績 ${(mapped.v as unknown[]).length} 件`,
    );

    const total = parsed.ms + mapped.ms + forecast.ms + series.ms;
    console.log(`  ${"上の合計".padEnd(34)} ${Math.round(total).toLocaleString().padStart(8)} ms`);
    console.log("  ※ すべてメインスレッドで直列。並列化では縮まない部分。\n");
  });
});
