# sakiguri コンポーネント仕様

Figma fileKey: `diqeunxgHCLNIPKVXL4evB`

この仕様の node ID を `get_design_context` / `get_screenshot` に渡すと、各部品の実物を確認できます。

色・余白・角丸はすべて `tokens.css` の変数か、Tailwind のクラス（`bg-primary`、`p-6`、`rounded-lg` など）で指定してください。hex や px の直書きは禁止です。

---

## 0. 実装方針

- **ベースは shadcn/ui を使います。** Figma のベース部品（Vastra Base）は shadcn/ui の命名と変数に合わせて作ってあるため、次の部品は shadcn をそのまま導入し、`tokens.css` の変数で見た目を合わせます。
  - Button / Badge / Tabs / Select / Input / Checkbox / Table / Dialog / Alert / Card
- **sakiguri 固有の部品は `components/sakiguri/` に置きます。** shadcn 部品を内部で使う「ラップ部品」として作り、shadcn 側のソースはなるべく改変しません。
- **アイコンは Heroicons v2 に限ります**（`@heroicons/react`）。
  - 使い分け：Outline 24 → `24/outline`、Solid 24 → `24/solid`、Mini 20 → `20/solid`、Micro 16 → `16/solid`。
  - アイコンの色は `currentColor` で親の文字色を継承させます。どうしても個別に指定するときは、次の4種類だけを使います（Figma の Icon コレクションのモードと同じ）。
    - `text-foreground`（Default）
    - `text-muted-foreground`（Muted）
    - `text-primary-foreground`（On Solid）
    - `text-fg-disabled`（Disabled）
- **数字の表示**
  - 金額・日付・件数は `.num` クラスで `tabular-nums` にします。
  - フォントは `font-family: Inter, "Noto Sans JP"` のスタックにより、数字と記号は自動的に Inter になります。
- **金額のフォーマット**
  - 書式は `¥1,234,567` です。
  - 支出は U+2212「−」（全角ではないマイナス記号）を付けて `−¥12,000` と表示します。ハイフン `-` は使いません。
  - 一覧の中の収入には「+」を付けず、色（`text-fg-success`）で示します。
  - 差分や内訳を補足する文では「+」を付けます。例：「うち未記録の予定 +¥186,400」。

## 1. ベース部品の使い方（shadcn に対応）

| Figma | node | shadcn | sakiguri での使い方 |
|---|---|---|---|
| Button | `6:482` | `button` | Variant: Primary / Secondary / Outline / Ghost / Destructive<br>Size: sm(32) / md(40) / lg(48)<br>高さは `--control-height-*`、横の余白は `--control-padding-x-*`、角丸は `rounded-md`<br>Primary の色は `bg-primary`、hover 時は `bg-primary-hover` |
| Badge | `9:121` | `badge` | Default / Secondary / Outline / Destructive / Info / Success / Warning に加え、Dot あり / なし |
| Tab | `12:18` | `tabs` | Style: Segmented（`bg-muted` の器の中で、アクティブなタブだけ `bg-background` と影）/ Underline |
| Select | `8:62` | `select` | Size × State |
| Input | `7:122` | `input` | 枠は `border-input`、フォーカス時は `ring` |
| Checkbox | `9:41` | `checkbox` | — |
| Table Header Cell / Table Cell | `17:8` / `17:48` | `table` | sakiguri では「Table Cell（sakiguri）」でラップして使う |
| Alert | `10:56` | `alert` | 通知には sakiguri の Callout を優先する |
| Card | `11:56` | `card` | sakiguri の Panel を優先する |
| Dialog | Dialog ページ | `dialog` | 角丸は `rounded-xl`、影は `shadow-xl`、背景の覆いは `bg-overlay` |

## 2. sakiguri 部品（Figma ページ `sakiguri` = `2007:3`）

### Layout

#### SideNav — `2008:19`

- **サイズ：** 幅 224px、高さは画面いっぱい。外側に 8px の余白を取ります（Sidebar inset：`p-2`）。
- **見た目：** 背景 `bg-primary`、角丸 `rounded-lg`、内側の余白は上下 24px・左右 16px、項目の間隔は 4px。
- **構成（上から）：**
  1. ロゴ「SAKIGURI」。Figma では Cormorant Garamond 22px で仮置きしています。正式なロゴは画像で差し替えます（未支給）。
  2. NavItem × 6。並び順と URL は下の表のとおりです。
  3. 空きスペース（spacer）。
  4. フッター：上辺に `border-t border-border-primary-subtle` の区切り線。その下にラベル「基準日」（`t-label-sm`）と日付「2026年9月1日」を置き、どちらも `text-primary-foreground` にします。

| ラベル | アイコン（outline） | URL |
|---|---|---|
| ダッシュボード | `HomeIcon` | `/` |
| キャッシュフロー | `PresentationChartLineIcon` | `/cashflow` |
| 年月別 収支 | `TableCellsIcon` | `/monthly` |
| 実績入力 | `PencilSquareIcon` | `/actuals` |
| CSV取込 | `ArrowUpTrayIcon` | `/import` |
| 予定の設定 | `Cog6ToothIcon` | `/settings` |

#### NavItem — `2008:18`

- **Props：** `state: "default" | "active"`、`label`、`icon`
- **Default：**
  - 背景は透明で、文字とアイコンは `text-primary-foreground`（白）。
  - hover 時は `bg-white/10` を推奨します。Figma に hover の定義はないため、これは実装側の提案です。
- **Active：** 背景 `bg-background`、文字とアイコン `text-fg-primary`。
- **寸法：**
  - 角丸 `rounded-md`、内側の余白は上下 8px・左右 12px、アイコンと文字の間は 12px。
  - アイコンは 24px（outline）、文字は `t-label`。
- **アクセシビリティ：** 現在のページの項目には `aria-current="page"` を付けます。

#### PageHeader — `2038:49`

- **Props：** `title`、`subtitle?`、`showBalance?`、`action?: ReactNode`
- **見た目：** 内側の余白は上下 20px・左右 32px。下辺に `border-b` の区切り線を引き、背景は `bg-background`。
- **左側：**
  - `title`（`t-h4`）
  - `subtitle`（`t-body-sm`、`text-muted-foreground`）
- **右側：**
  - 残高のサマリー：今日の残高 / 30日後 / 90日後 / カード未払。各項目はラベル（`t-label-sm`、muted）と金額（`num`、Inter Semi Bold 16）の組み合わせです。
  - その右に `action` を置きます。例：Primary ボタン「CSVを取り込む」に `ArrowUpTrayIcon` を添えたもの。

#### Panel（Figma 名：Card）— `2008:62`

- **Props：** `title`、`count?`（例「4件」）、`action?: ReactNode`、`children`
- **見た目：** 背景 `bg-card`、枠線なし、角丸 `rounded-lg`、内側の余白 24px、中の要素の間隔 16px。
- **見出し行：**
  - 左にタイトル（`t-card-title`）と件数（`t-body-sm`、muted）を、ベースラインを揃えて並べます。
  - 右に `action` を置きます。
- **中身：** Figma ではインスタンスの差し替えスロットで作っていますが、実装では `children` で受け取ります。

### Navigation / steps

#### MonthTab — `2009:87`

- **用途：** 月を切り替えるタブ。
- **State：**
  - `active`：`bg-primary-subtle`、`text-fg-primary`
  - `inactive`：透明、`text-muted-foreground`
  - `future`：`border border-border-primary-subtle`、`text-muted-foreground`。基準日より後の、予定だけの月です。
- **形：** 角丸 `rounded-md`、高さ 32px 前後。

#### Step — `2009:80`

- **用途：** CSV取込の手順表示。
- **Props：** `number`、`label`、`state: "done" | "current" | "upcoming"`
- **番号の丸：** 直径 24px で、中に番号を入れます。
- **state ごとの表示：**
  - done：`bg-primary` の丸に白い番号、ラベルは `text-muted-foreground`
  - current：`bg-primary` の丸に白い番号、ラベルは `text-foreground`
  - upcoming：`border-input` の枠だけの丸に muted の番号、ラベルも muted
- **区切り：** ステップの間は `ChevronRightIcon`（micro、muted）で区切ります。

### Data display

#### Amount — `2007:48`

- **Props：** `value: number`、`type: "income" | "expense" | "neutral"`、`size: "table" | "body" | "kpi"`
- **文字色：**
  - income：`text-fg-success`（teal-500、白地に対するコントラスト比 5.1:1）
  - expense：`text-fg-destructive`（plum-800）。頭に「−」を付けます。
  - neutral：`text-foreground`（残高・合計など）
- **サイズ：**
  - table：Inter 13/20
  - body：Inter 14/24
  - kpi：Inter Semi Bold 28/36
- **配置：** すべて `num` クラスを付けて右揃えにします。
- **実装：** フォーマットの関数 `formatYen(value, {sign})` は `lib/format.ts` に1つだけ置き、全画面で共有します。

#### Stat — `2008:41`

- **構成：** ラベル（`t-label-sm`、muted）＋値（`text-foreground`、`num`）＋補足 note。
- **Size：**
  - primary：値は `t-balance`（34/40）、note（`t-body-sm`、`text-fg-primary`）あり。例：「うち未記録の予定 +¥186,400」。
  - secondary：値は `t-kpi` 相当で、note はなし。

#### LedgerRow — `2008:56`

- **用途：** 口座・カードの一覧の1行。
- **構成：** 左にラベル、右に Amount。
- **見た目：** 行の高さ 48px、区切りは `border-b`（最後の行には付けない）。

#### TodoRow — `2038:77`

- **用途：** 「やること」の1行。
- **Props：** `date`、`title`、`amount`、`category`、`status?`、`primaryAction?`、`secondaryAction?`
- **左から順に：**
  - 日付（`num`、muted、幅 48px）
  - タイトル（`t-body`）
  - CategoryTag
  - StatusChip
  - Amount（右揃え）
  - 操作ボタン：Primary sm「予定どおり」（予定をそのまま実績として確定）、Ghost/Outline sm「ほかの操作」（金額違い・スキップなどを展開）
- **例：** `9/27 / 事務所家賃 / −¥95,000 / 固定費 / 予定 / [予定どおり]`
- **区切り：** 行の間に `border-b`。

#### TableCell（sakiguri）— `2009:67`

- **Props：** `kind`、`align: "left" | "right"`
- **kind ごとの表示：**

| kind | 文字 | 背景 |
|---|---|---|
| `row-header` | `t-table`（左の固定列） | — |
| `group` | `t-table-strong` | `bg-muted` |
| `item` | `t-table` | — |
| `subtotal` | `t-table-strong` | 上辺に `border-t` |
| `total` | `t-table-strong` | `bg-muted` |
| `highlight` | — | `bg-warning-subtle`（防衛ラインを割る月の行） |

- **寸法：**
  - 行の高さは `--table-row-height`、横の余白は `--table-cell-padding-x`。
  - 大きな表（月次資金繰り表・年月別 収支）は `data-density="compact"` で表示します（行の高さ 36px）。

#### LegendItem — `2009:97`

- **用途：** グラフの凡例。
- **Series：**
  - Actual「実績残高」：実線、`--chart-actual`
  - Forecast「予測残高」：破線、`--chart-forecast`
  - Defense「生活防衛ライン」：破線、`--chart-defense`
- **ラベルの文字：** `t-body-sm`、muted。

### Status / notices

#### CategoryTag — `2007:20`

- **作り：** Badge をラップし、角丸を `rounded-sm` にします。

| category | Badge variant | 色 |
|---|---|---|
| 収入 | Success | `bg-success-subtle`、`text-fg-success` |
| 固定費 | Info | `bg-primary-subtle`、`text-fg-primary` |
| 変動費 | Warning | `bg-warning-subtle`、`text-fg-warning` |
| 振替 | Secondary | `bg-secondary`、`text-secondary-foreground` |

#### StatusChip — `2007:29`

- **予定：** Badge の Outline。枠は `border-border` の破線（`border-dashed`）、文字は muted。
- **実績：** Badge の Default（`bg-primary`、`text-primary-foreground`）。

#### Callout — `2007:55`

- **Props：** `tone: "info" | "caution" | "error"`、`children`
- **見た目：**
  - 左辺に 2px の線（`border-l-2`）、角丸 `rounded-sm`。
  - 内側の余白は上下 12px・右 16px・左 20px。
  - 高さは中身に合わせて伸ばし、文字とアイコンは上下中央に揃えます（v0.6.0 で修正済み）。
- **tone ごとの色：**

| tone | 背景 | 左の線と文字 |
|---|---|---|
| info | `bg-primary-subtle` | `text-fg-primary` / `border-l-fg-primary` |
| caution | `bg-warning-subtle` | `text-fg-warning` / `border-l-fg-warning` |
| error | `bg-destructive-subtle` | `text-fg-destructive` / `border-l-fg-destructive` |

- アイコンはありません（Figma 上も文字だけ）。文字は `t-body`。

- **アクセシビリティ：** `role="status"` を付けます。error のときだけ `role="alert"` にします。

## 3. 状態の意味と色の割り当て（重要）

| 意味 | 使う変数 | 補足 |
|---|---|---|
| ブランド・主操作 | `primary` (teal-600) | — |
| 収入・成功・情報 | `fg-success` / `success-subtle` (teal) | — |
| 注意・防衛ライン付近 | `fg-warning` / `warning-subtle` (**green**) | 一般的な黄・橙ではない。sakiguri の決定事項 |
| エラー・破壊的操作 | `destructive` (**plum**) | 赤ではない。sakiguri の決定事項 |
| 支出の金額 | `fg-destructive` (plum-800) ＋「−」 | — |
| 残高・合計 | `foreground` | — |
