/* トークン確認ページ。
   docs/designsystem.md のトークンが CSS変数として解決され、
   Tailwind のユーティリティがそこに束縛されていることを目視で確かめる。
   画面の実装（PoC開発計画 フェーズ2・タスク#7 以降）で差し替える。 */

const OBJECT_TOKENS = [
  "object-base-high",
  "object-base-mid",
  "object-base-low",
  "object-accent-dim",
  "object-accent-bright",
  "object-error-dim",
  "object-error-bright",
  "object-caution-dim",
  "object-caution-bright",
  "object-success-dim",
  "object-success-bright",
] as const;

const SURFACE_TOKENS = [
  "surface-base-primary",
  "surface-base-secondary",
  "surface-base-primary-inverse",
  "surface-overlay-hoverd",
  "surface-overlay-selected",
  "surface-accent-thin",
  "surface-accent-subtle",
  "surface-success-subtle",
  "surface-caution-subtle",
  "surface-error-subtle",
] as const;

const BORDER_TOKENS = [
  "border-base-high",
  "border-base-low",
  "border-accent-high",
  "border-error-high",
  "border-caution-high",
  "border-success-high",
] as const;

/* 余白は Tailwind のクラスを直接書く。動的に組み立てると
   Tailwind がクラスを検出できず、生成されない。 */
const SPACING = [
  { token: "--sp-4", px: 4, cls: "w-4" },
  { token: "--sp-8", px: 8, cls: "w-8" },
  { token: "--sp-12", px: 12, cls: "w-12" },
  { token: "--sp-16", px: 16, cls: "w-16" },
  { token: "--sp-24", px: 24, cls: "w-24" },
  { token: "--sp-32", px: 32, cls: "w-32" },
  { token: "--sp-40", px: 40, cls: "w-40" },
  { token: "--sp-48", px: 48, cls: "w-48" },
  { token: "--sp-56", px: 56, cls: "w-56" },
  { token: "--sp-64", px: 64, cls: "w-64" },
  { token: "--sp-72", px: 72, cls: "w-72" },
] as const;

const TYPE_SCALE = [
  { name: "display-lg", px: "56px", cls: "text-display-lg" },
  { name: "display-md", px: "48px", cls: "text-display-md" },
  { name: "display-sm", px: "36px", cls: "text-display-sm" },
  { name: "headline-xlg", px: "34px", cls: "text-headline-xlg" },
  { name: "headline-lg", px: "28px", cls: "text-headline-lg" },
  { name: "headline-md", px: "24px", cls: "text-headline-md" },
  { name: "headline-sm", px: "20px", cls: "text-headline-sm" },
  { name: "headline-xs", px: "18px", cls: "text-headline-xs" },
  { name: "body-xlg", px: "20px", cls: "text-body-xlg" },
  { name: "body-lg", px: "18px", cls: "text-body-lg" },
  { name: "body-md", px: "16px", cls: "text-body-md" },
  { name: "body-xmd", px: "15px", cls: "text-body-xmd" },
  { name: "body-sm", px: "14px", cls: "text-body-sm" },
  { name: "body-xs", px: "13px", cls: "text-body-xs" },
  { name: "body-xxs", px: "12px", cls: "text-body-xxs" },
] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-base-primary border-border-base-low rounded-base border">
      <h2 className="border-border-base-low font-display-jp text-body-md text-object-base-high border-b px-16 py-12 font-semibold">
        {title}
      </h2>
      <div className="p-16">{children}</div>
    </section>
  );
}

function Swatch({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <li className="flex items-center gap-12">
      <span
        className="border-border-base-low h-16 w-16 shrink-0 rounded-base border"
        style={style}
      />
      <code className="text-body-xs num">{label}</code>
    </li>
  );
}

export default function TokensPage() {
  return (
    <main className="flex flex-col gap-24 p-24">
      <header>
        <p className="font-display-en text-headline-md tracking-wide leading-none font-bold">
          SAKIGURI
        </p>
        <p className="text-object-base-mid text-body-xxs mt-4">
          デザイントークン確認ページ ／ 一次情報 docs/designsystem.md
        </p>
      </header>

      <Section title="object — 文字・アイコン">
        <ul className="flex flex-col gap-8">
          {OBJECT_TOKENS.map((token) => (
            <Swatch
              key={token}
              label={token}
              style={{ background: `var(--${token})` }}
            />
          ))}
        </ul>
        <p className="text-object-base-mid text-body-xxs mt-12">
          error は赤ではなく purple、caution は黄ではなく green。
        </p>
      </Section>

      <Section title="surface — 背景">
        <ul className="flex flex-col gap-8">
          {SURFACE_TOKENS.map((token) => (
            <Swatch
              key={token}
              label={token}
              style={{ background: `var(--${token})` }}
            />
          ))}
        </ul>
      </Section>

      <Section title="border">
        <ul className="flex flex-col gap-8">
          {BORDER_TOKENS.map((token) => (
            <Swatch
              key={token}
              label={token}
              style={{ borderColor: `var(--${token})` }}
            />
          ))}
        </ul>
      </Section>

      <Section title="スペーシング — Tailwind がトークンを引いていること">
        <ul className="flex flex-col gap-8">
          {SPACING.map(({ token, px, cls }) => (
            <li key={token} className="flex items-center gap-12">
              <span className={`bg-object-accent-dim h-8 shrink-0 ${cls}`} />
              <code className="text-body-xs num">
                {token} = {px}px
              </code>
            </li>
          ))}
        </ul>
        <p className="text-object-base-mid text-body-xxs mt-12">
          Tailwind の既定スケールは無効化してある。上のバーは w-4 〜 w-72
          で描いており、p-16 は 16px（Tailwind 既定の 64px ではない）。
          スケール外の p-15 はクラスが生成されない。
        </p>
      </Section>

      <Section title="タイポグラフィ">
        <ul className="flex flex-col gap-12">
          {TYPE_SCALE.map(({ name, px, cls }) => (
            <li key={name} className="flex flex-wrap items-baseline gap-12">
              <code className="text-object-base-mid text-body-xxs num">
                {name} / {px}
              </code>
              <span className={`${cls} leading-none`}>資金繰り 123,456</span>
            </li>
          ))}
        </ul>
        <p className="text-object-base-mid text-body-xxs mt-12">
          数値は等幅（tabular-nums）。マイナスは − (U+2212) を使う。
        </p>
      </Section>
    </main>
  );
}
