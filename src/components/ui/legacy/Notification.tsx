/**
 * Notification
 *
 * 一次情報：docs/designsystem.md §4 Notification
 *   警告バナー。左に 4px のバーを引く。
 *   エラー（資金ショート）：バー object-error-dim、背景 surface-error-subtle
 *   情報：バー object-accent-dim、背景 surface-accent-subtle
 *
 * error は赤ではなく purple（§1.3）。
 */

const VARIANTS = {
  error: "border-l-object-error-dim bg-surface-error-subtle",
  info: "border-l-object-accent-dim bg-surface-accent-subtle",
  caution: "border-l-object-caution-dim bg-surface-caution-subtle",
} as const;

export function Notification({
  variant = "info",
  children,
}: {
  variant?: keyof typeof VARIANTS;
  children: React.ReactNode;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : undefined}
      className={`text-object-base-high rounded-base border-l-4 p-12 text-body-xs leading-normal ${VARIANTS[variant]}`}
    >
      {children}
    </div>
  );
}
