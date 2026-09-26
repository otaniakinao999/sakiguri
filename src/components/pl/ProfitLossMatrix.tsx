/**
 * 予実マトリクス（SC-04）
 *
 * 一次情報：docs/要件定義書.md §3.3 CL-5 手順5、docs/designsystem.md §5
 *   列は1〜12月と年計。**列を削って収めようとしない。**
 *   横スクロールを許容し、1列目はスティッキーにする。
 */

import { formatAmount, formatSigned } from "@/lib/format";
import { diffTone, type PLDisplay, type PLDisplayRow } from "@/lib/pl-view";

const CELL = "border-b-border-base-low border-b px-12 py-8 whitespace-nowrap";

/** 1列目。横スクロールしても残る */
const STICKY = "sticky left-0 z-1";

function toneClass(tone: "good" | "bad" | null): string {
  if (tone === "good") return "text-object-success-bright";
  if (tone === "bad") return "text-object-error-dim";
  return "text-object-base-mid";
}

function Cell({
  row,
  index,
  display,
}: {
  row: PLDisplayRow;
  index: number;
  display: PLDisplay;
}) {
  const value = row.monthly[index];
  const plan = row.planMonthly?.[index];
  const bold = row.kind !== "category";

  /* 差異は正が良い方向。色は designsystem.md §1.4 のマッピングに従う */
  if (display.mode === "diff") {
    let text: string;
    if (value === null) text = "·";
    else if (value === 0) text = "0";
    else text = formatSigned(value);

    return (
      <td className={`${CELL} num text-right ${toneClass(diffTone(value))}`}>
        {text}
      </td>
    );
  }

  /* 収支の行は符号で色を変える */
  const netTone =
    row.kind === "net" && value !== null
      ? value >= 0
        ? "text-object-success-bright"
        : "text-object-error-dim"
      : "";

  return (
    <td className={`${CELL} num text-right ${netTone}`}>
      {value === null ? (
        <span className="text-object-base-mid">·</span>
      ) : value === 0 ? (
        <span className="text-object-base-mid">—</span>
      ) : (
        <span className={bold ? "font-semibold" : ""}>{formatAmount(value)}</span>
      )}
      {/* 予実併記。見込みが当初予算と違う月にだけ、当初予算を小さく添える */}
      {display.mode === "mixed" &&
        plan != null &&
        plan !== 0 &&
        plan !== value && (
          <span className="text-object-base-mid block text-body-xxs">
            予 {formatAmount(plan)}
          </span>
        )}
    </td>
  );
}

export function ProfitLossMatrix({ display }: { display: PLDisplay }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-xs leading-normal">
        <thead>
          <tr>
            <th
              className={`${STICKY} bg-surface-base-secondary text-object-base-mid border-b-border-base-low min-w-[var(--layout-pl-label-width)] border-b px-12 py-8 text-left text-body-xxs font-semibold tracking-wide`}
            >
              費目
            </th>
            {display.months.map((month, index) => (
              <th
                key={month}
                className="num bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-12 py-8 text-right text-body-xxs font-semibold tracking-wide whitespace-nowrap"
              >
                {Number(month.slice(5, 7))}月
                {/* 途中までの比較であることを列に出す（AC-43） */}
                {display.asOfNote?.monthIndex === index && (
                  <span className="text-object-base-mid block font-normal">
                    {display.asOfNote.label}
                  </span>
                )}
              </th>
            ))}
            <th className="num bg-surface-base-secondary text-object-base-mid border-b-border-base-low border-b px-12 py-8 text-right text-body-xxs font-semibold tracking-wide whitespace-nowrap">
              年計
            </th>
          </tr>
        </thead>
        <tbody>
          {display.rows.map((row) => {
            const isGroup = row.kind === "group";
            const isNet = row.kind === "net";
            const rowBg = isGroup || isNet ? "bg-surface-accent-subtle" : "bg-surface-base-primary";
            const netBorder = isNet ? "border-t-object-base-high border-t-2" : "";

            return (
              <tr key={row.key} className={netBorder}>
                <th
                  scope="row"
                  className={`${STICKY} ${rowBg} ${CELL} text-left font-normal ${
                    isGroup || isNet
                      ? "font-semibold"
                      : "text-object-base-mid pl-24"
                  }`}
                >
                  {row.label}
                </th>
                {display.months.map((month, index) => (
                  <Cell key={month} row={row} index={index} display={display} />
                ))}
                <td
                  className={`${CELL} num text-right ${
                    isGroup || isNet ? "font-semibold" : "text-object-base-mid"
                  }`}
                >
                  {display.mode === "diff"
                    ? /* 0 に符号を付けない。月のセルと揃える */
                      row.yearTotal === 0
                      ? "0"
                      : formatSigned(row.yearTotal)
                    : formatAmount(row.yearTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
