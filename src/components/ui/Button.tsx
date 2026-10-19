/**
 * Button
 *
 * 一次情報：docs/designsystem.md §4 Button（`btn`）
 *   color: black / white / line / line_gray
 *   size:  lg / md / sm
 *   black は背景 object-base-high・文字 white。white は背景 white・枠 border-base-high。
 *   md は padding sp-8 sp-16 と body-xs、sm は sp-4 sp-8 と body-xxs。
 *
 * `danger` は §4 の color に無い。削除の取り消しがきかない操作を、
 * ほかのボタンと同じ見た目にしたくないため、error のトークンだけで
 * 組んだ5つ目として足してある。新しい色は作っていない。
 */

export type ButtonColor = "black" | "white" | "line" | "line_gray" | "danger";
export type ButtonSize = "lg" | "md" | "sm";

const COLORS: Record<ButtonColor, string> = {
  black:
    "bg-object-base-high text-object-base-high-inverse border-object-base-high hover:bg-object-base-mid",
  white:
    "bg-surface-base-primary text-object-base-high border-border-base-high hover:bg-surface-overlay-hoverd",
  line: "text-object-accent-dim border-border-accent-high hover:bg-surface-accent-subtle",
  line_gray:
    "text-object-base-mid border-border-base-high hover:bg-surface-overlay-hoverd",
  danger:
    "text-object-error-dim border-border-error-high hover:bg-surface-error-subtle",
};

const SIZES: Record<ButtonSize, string> = {
  lg: "px-24 py-12 text-body-sm",
  md: "px-16 py-8 text-body-xs",
  sm: "px-8 py-4 text-body-xxs",
};

export function Button({
  color = "white",
  size = "md",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: ButtonColor;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`rounded-base border font-semibold whitespace-nowrap disabled:opacity-50 ${COLORS[color]} ${SIZES[size]} ${props.className ?? ""}`}
    />
  );
}
