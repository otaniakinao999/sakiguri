/**
 * 月次資金繰り表（FR-13 の表示、SC-03）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-6、§4.1 SC-03
 *
 * 表は横スクロールを許容する（designsystem.md §5）。列を削って収めない。
 */

import type { MonthlyCashflowRow } from "@/core/monthly";
import { formatAmount, formatMonthDay, formatSigned } from "@/lib/format";

function Warning({ row }: { row: MonthlyCashflowRow }) {
  if (!row.warning) return null;
  return (
    <>
      {formatMonthDay(row.warning.date)}に
      {row.warning.kind === "shortfall" ? "資金ショート" : "防衛ライン割れ"}
    </>
  );
}

export function MonthlyCashflowTable({ rows }: { rows: MonthlyCashflowRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-object-base-mid py-24 text-center text-body-xs">
        表示できる月がありません。
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body-xs leading-normal">
          <thead>
            <tr className="bg-surface-base-secondary text-object-base-mid">
              <th className="border-b-border-base-low border-b px-12 py-8 text-left text-body-xxs font-semibold tracking-wide whitespace-nowrap">
                月
              </th>
              {["前月繰越", "入金", "出金", "収支", "月末残高", "月中最低"].map(
                (label) => (
                  <th
                    key={label}
                    className="num border-b-border-base-low border-b px-12 py-8 text-right text-body-xxs font-semibold tracking-wide whitespace-nowrap"
                  >
                    {label}
                  </th>
                ),
              )}
              <th className="border-b-border-base-low border-b px-12 py-8 text-left text-body-xxs font-semibold tracking-wide" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.yearMonth}>
                <td className="num border-b-border-base-low border-b px-12 py-8 whitespace-nowrap">
                  {row.yearMonth}
                </td>
                <td className="num text-object-base-mid border-b-border-base-low border-b px-12 py-8 text-right whitespace-nowrap">
                  {formatAmount(row.opening)}
                </td>
                <td className="num text-object-success-bright border-b-border-base-low border-b px-12 py-8 text-right whitespace-nowrap">
                  {formatAmount(row.inflow)}
                </td>
                <td className="num border-b-border-base-low border-b px-12 py-8 text-right whitespace-nowrap">
                  {formatAmount(row.outflow)}
                </td>
                <td
                  className={`num border-b-border-base-low border-b px-12 py-8 text-right whitespace-nowrap ${
                    row.net >= 0
                      ? "text-object-success-bright"
                      : "text-object-error-dim"
                  }`}
                >
                  {formatSigned(row.net)}
                </td>
                <td
                  className={`num border-b-border-base-low border-b px-12 py-8 text-right font-semibold whitespace-nowrap ${
                    row.closing < 0 ? "text-object-error-dim" : ""
                  }`}
                >
                  {formatAmount(row.closing)}
                </td>
                <td
                  className={`num border-b-border-base-low border-b px-12 py-8 text-right whitespace-nowrap ${
                    row.warning ? "text-object-error-dim" : "text-object-base-mid"
                  }`}
                >
                  {formatAmount(row.lowest)}
                </td>
                <td className="text-object-base-mid border-b-border-base-low border-b px-12 py-8 text-body-xxs whitespace-nowrap">
                  <Warning row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-object-base-mid mt-12 text-body-xxs leading-normal">
        カード利用は利用日ではなく引き落とし日で出金に計上しています。
      </p>
    </>
  );
}
