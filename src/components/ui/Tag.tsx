/**
 * 区分バッジ（Tag / size sm）
 *
 * 一次情報：docs/designsystem.md §1.4 用途マッピング、§4 Tag
 *
 * 配色は §1.4 の表で固定されている。**独自の割り当てを作らない。**
 *   固定費 → accent（blue）        変動費 → caution（green）
 *   収入   → success（lightblue）  カード引落 → error-bright（lightpurple）
 *   振替   → base-mid（gray）      事業割合 → error-bright（lightpurple）
 *   予定バッジ → 破線・白抜き      実績バッジ → 塗りつぶし（gray-100）
 *
 * error は赤ではなく purple、caution は黄ではなく green（§1.3）。
 */

import { groupOfCategory } from "@/core/categories";
import type { CostType, EntryType } from "@/core/types";

const BASE =
  "inline-block rounded-base border px-8 text-body-xxs leading-normal font-semibold";

type Variant =
  | "income"
  | "fixed"
  | "variable"
  | "settle"
  | "transfer"
  | "ratio"
  | "plan"
  | "actual";

const VARIANTS: Record<Variant, string> = {
  income:
    "text-object-success-bright border-border-success-high bg-surface-success-subtle",
  fixed:
    "text-object-accent-dim border-border-accent-high bg-surface-accent-subtle",
  variable:
    "text-object-caution-dim border-border-caution-high bg-surface-caution-subtle",
  settle: "text-object-error-bright border-border-error-high bg-surface-error-subtle",
  transfer:
    "text-object-base-mid border-border-base-low bg-surface-overlay-hoverd",
  ratio: "text-object-error-bright border-border-error-high bg-surface-error-subtle",
  plan: "text-object-base-mid border-border-base-high bg-surface-base-primary border-dashed",
  actual:
    "text-object-base-high-inverse border-object-base-high bg-object-base-high",
};

const LABELS: Partial<Record<Variant, string>> = {
  income: "収入",
  fixed: "固定費",
  variable: "変動費",
  settle: "引落",
  transfer: "振替",
  plan: "予定",
  actual: "実績",
};

export function Tag({
  variant,
  children,
}: {
  variant: Variant;
  children?: React.ReactNode;
}) {
  return (
    <span className={`${BASE} ${VARIANTS[variant]}`}>
      {children ?? LABELS[variant]}
    </span>
  );
}

/** イベントの区分を判定してバッジにする。 */
export function KindTag({
  event,
}: {
  event: {
    type: EntryType;
    costType: CostType | null;
    categoryCode: string;
    src: string;
  };
}) {
  if (event.src === "settle") return <Tag variant="settle" />;
  if (
    event.type === "transfer" ||
    groupOfCategory(event.categoryCode) === "TRF"
  ) {
    return <Tag variant="transfer" />;
  }
  if (event.type === "income") return <Tag variant="income" />;
  return <Tag variant={event.costType === "fixed" ? "fixed" : "variable"} />;
}

/** 事業割合のバッジ。0のときは出さない。 */
export function RatioTag({ bizRatio }: { bizRatio: number }) {
  if (!bizRatio) return null;
  return <Tag variant="ratio">事業{bizRatio}%</Tag>;
}

/** 予定／実績のバッジ。 */
export function StatusTag({ status }: { status: "plan" | "actual" }) {
  return <Tag variant={status} />;
}
