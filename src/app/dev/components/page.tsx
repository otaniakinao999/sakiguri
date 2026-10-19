/**
 * 部品の一覧（開発用）
 *
 * HANDOFF_CLAUDE.md「進め方」2：全 variant と state を並べ、
 * Figma のページ 2007:3 と見比べる。
 *
 * **認証の外に置いてある。** AuthGate も AppDataProvider も通さないので、
 * Supabase に届かない環境でも開ける。移行中の確認のためだけのページで、
 * 製品の導線からは繋がない。
 */

import { Badge } from "@/components/ui/v06/badge";
import { Button } from "@/components/ui/v06/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/v06/tabs";
import { Amount } from "@/components/sakiguri/Amount";
import { Callout } from "@/components/sakiguri/Callout";
import { CategoryTag, type Category } from "@/components/sakiguri/CategoryTag";
import { LedgerRow } from "@/components/sakiguri/LedgerRow";
import { LegendItem } from "@/components/sakiguri/LegendItem";
import { Panel } from "@/components/sakiguri/Panel";
import { StatusChip } from "@/components/sakiguri/StatusChip";

const BUTTON_VARIANTS = ["primary", "secondary", "outline", "ghost", "destructive"] as const;
const BUTTON_SIZES = ["sm", "md", "lg"] as const;
const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "info",
  "success",
  "warning",
] as const;
const CATEGORIES: Category[] = ["収入", "固定費", "変動費", "振替", "カード引落"];

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="t-label-sm text-muted-foreground">{title}</div>
      <div className="flex flex-wrap items-center gap-12">{children}</div>
    </div>
  );
}

export default function DevComponentsPage() {
  return (
    <div className="min-h-screen bg-muted p-32">
      <div className="mx-auto flex w-full max-w-content flex-col gap-24">
        <header className="flex flex-col gap-4">
          <h1 className="t-h3">部品の一覧</h1>
          <p className="t-body-sm text-muted-foreground">
            Design System sakiguri v0.6.0 ／ 開発用。製品の導線からは繋がっていません。
          </p>
        </header>

        <Panel title="Button" count="5 variant × 3 size">
          {BUTTON_SIZES.map((size) => (
            <Row key={size} title={`size = ${size}`}>
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>
                  予定どおり
                </Button>
              ))}
              <Button variant="primary" size={size} disabled>
                disabled
              </Button>
            </Row>
          ))}
        </Panel>

        <Panel title="Badge">
          <Row title="variant">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </Row>
          <Row title="dot あり">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant} dot>
                {variant}
              </Badge>
            ))}
          </Row>
        </Panel>

        <Panel title="CategoryTag / StatusChip">
          <Row title="区分">
            {CATEGORIES.map((c) => (
              <CategoryTag key={c} category={c} />
            ))}
          </Row>
          <Row title="状態">
            <StatusChip status="予定" />
            <StatusChip status="実績" />
          </Row>
        </Panel>

        <Panel title="Callout">
          <Callout tone="info">60日以上前の予定が2件、消し込まれずに残っています。</Callout>
          <Callout tone="caution">口座を間違えると、別の口座の予定と照合してしまいます。</Callout>
          <Callout tone="error">
            ここを変えると、ほかの画面の数字がすべて変わります。日々の記帳では触りません。
          </Callout>
        </Panel>

        <Panel title="Amount">
          <Row title="type（size = body）">
            <Amount value={330000} type="income" />
            <Amount value={95000} type="expense" />
            <Amount value={2847300} type="neutral" />
            <Amount value={186400} type="neutral" signed />
          </Row>
          <Row title="size">
            <Amount value={2847300} size="table" />
            <Amount value={2847300} size="body" />
            <Amount value={2847300} size="kpi" />
          </Row>
        </Panel>

        <Panel title="LedgerRow">
          <div className="flex flex-col">
            <LedgerRow label="現金" value={52000} />
            <LedgerRow label="○○銀行 普通" value={2145300} />
            <LedgerRow label="△△信金 普通" value={650000} />
            <hr className="my-12 border-t border-border" />
            <LedgerRow label="××カード 確定金額" value={186200} type="expense" />
            <LedgerRow label="××カード 未確定分" value={62400} type="expense" />
          </div>
        </Panel>

        <Panel title="Tabs / LegendItem">
          <Row title="Segmented">
            <Tabs defaultValue="90">
              <TabsList>
                <TabsTrigger value="90">90日</TabsTrigger>
                <TabsTrigger value="6m">6ヶ月</TabsTrigger>
                <TabsTrigger value="12m">12ヶ月</TabsTrigger>
              </TabsList>
            </Tabs>
          </Row>
          <Row title="凡例">
            <LegendItem series="actual" label="実績" />
            <LegendItem series="forecast" label="予測（予定から計算）" />
            <LegendItem series="defense" label="生活防衛ライン" />
          </Row>
        </Panel>
      </div>
    </div>
  );
}
