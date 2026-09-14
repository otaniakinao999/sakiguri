"use client";

/**
 * 並んだ選択肢から1つを選ぶ。
 *
 * docs/designsystem.md §4 に専用のコンポーネント定義はない。
 * Button（`color: black` / `white`、`size: sm`）を隣接させた形として組む。
 * トークンの範囲から出ないこと。
 */

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  /** 支援技術向けのグループ名 */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-border-base-high bg-surface-base-primary flex overflow-hidden rounded-base border"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`
              px-12 py-8 text-body-xs leading-normal whitespace-nowrap
              ${index > 0 ? "border-l-border-base-high border-l" : ""}
              ${
                selected
                  ? "bg-object-base-high text-object-base-high-inverse font-semibold"
                  : "text-object-base-mid hover:bg-surface-overlay-hoverd"
              }
            `}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
