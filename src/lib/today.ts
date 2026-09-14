/**
 * 「今日」を得る
 *
 * `src/core/` は現在日時を自分で取らない（CLAUDE.md §2.3）。
 * 取るのはここだけにして、core には `today: DateStr` を引数で渡す。
 */

import type { DateStr } from "@/core/types";

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * 端末のローカル時刻から 'YYYY-MM-DD' を作る。
 *
 * **`toISOString()` を使わない。** UTC に変換されるため、JST の
 * 2026-09-01 が 2026-08-31 になる（CLAUDE.md §2.2、ADR-0002）。
 * `getFullYear` / `getMonth` / `getDate` はローカル時刻で読むので、
 * JST の端末では JST の日付が返る。
 */
export function todayStr(): DateStr {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
