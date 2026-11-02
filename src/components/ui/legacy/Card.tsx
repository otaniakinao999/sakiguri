/**
 * カード
 *
 * 一次情報：docs/designsystem.md
 *   §3  カード内側の余白は --sp-16、ヘッダーは --sp-12 --sp-16
 *   §2.3 カード見出しは和文 16px semibold
 *   §6  影・グラデーション・大きな角丸を使わない
 */

export function Card({
  title,
  right,
  children,
}: {
  title?: string;
  /** 見出しの右端に置く操作や注記 */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-base-primary border-border-base-low rounded-base border">
      {title && (
        <h2 className="border-b-border-base-low font-display-jp text-object-base-high flex items-center justify-between gap-8 border-b px-16 py-12 text-body-md leading-normal font-semibold">
          <span>{title}</span>
          {right}
        </h2>
      )}
      <div className="p-16">{children}</div>
    </section>
  );
}
