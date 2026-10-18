# sakiguri — 実装ガイド（Claude Code 向け）

sakiguri は社内向けの予実管理アプリです。予定と実績の入出金から、日々の残高と生活防衛ラインまでの余裕を見るために使います。

デザインは Figma で確定済みです。このリポジトリでは、それを忠実にコードへ落とします。

## 参照するもの

| 内容 | 場所 |
|---|---|
| デザイントークン（正） | `docs/design/tokens.css` |
| 部品の仕様 | `docs/design/components.md` |
| 画面の仕様・文言 | `docs/design/screens.md` |
| 決定事項・未決事項 | `docs/design/decisions.md` |
| Figma | fileKey `diqeunxgHCLNIPKVXL4evB`（Design System sakiguri v0.6.0） |

**Figma ノード**

- 画面：
  - `2029:60` ダッシュボード
  - `2030:97` キャッシュフロー
  - `2031:256` 年月別 収支
  - `2032:753` 実績入力
  - `2033:858` CSV取込
  - `2034:911` 予定の設定
  - `2034:1204` 基準日の確認ダイアログ
- 部品ページ：`2007:3`（sakiguri）
- ガイド：`2039:85`

**Figma MCP の使い方**

- Figma MCP が使えるときは、画面や部品を作る前に `get_screenshot` で見た目を確認します。
- 細部は `get_design_context` で読みます。
- `get_design_context` が返すコードは参考として扱います。そのまま貼らず、このリポジトリの部品とトークンに置き換えてください。

## 技術スタック（前提。変える場合は相談すること）

- Next.js（App Router）+ TypeScript + React
- Tailwind CSS v4 + shadcn/ui（ベース部品）
- アイコン：`@heroicons/react` のみ。lucide など shadcn 既定のアイコンは Heroicons に置き換えます。
- グラフ：Recharts
- フォント：`next/font/google` で次の3つを読み込み、`<html>` にクラスを付けます。`tokens.css` はこの変数名を参照しています。

  | フォント | ウェイト | variable |
  |---|---|---|
  | Inter | 400 / 500 / 600 | `--font-inter` |
  | Noto Sans JP | 400 / 500 / 700 | `--font-noto-sans-jp` |
  | JetBrains Mono | 400 | `--font-jetbrains-mono` |

## 守るルール

1. **色・余白・角丸・影は `tokens.css` の変数（または Tailwind のクラス）だけで指定します。**
   - hex、rgb、任意値（`p-[13px]` や `bg-[#065d63]` など）は禁止です。
   - 足りない値があれば勝手に足さず、`decisions.md` の未決事項に書き出してください。
2. **shadcn/ui の部品はなるべく改変しません。**
   - 見た目はトークンで合わせます。
   - sakiguri 固有の部品は `components/sakiguri/` にラップ部品として作ります。これは Figma の「既存コンポーネントはデタッチしない」というルールに相当します。
3. **アイコンの色は次の4つに限ります。**
   - `text-foreground` / `text-muted-foreground` / `text-primary-foreground` / `text-fg-disabled`
   - 基本は `currentColor` で親の文字色を継承させます。
4. **フォント**
   - `font-family: Inter, "Noto Sans JP"` のスタックで、数字と記号は Inter、和文は Noto Sans JP にします。
   - 金額・日付・件数には `.num` を付けて `tabular-nums` にします。
5. **金額の表示は `lib/format.ts` の `formatYen` に統一します。**
   - 書式は `¥1,234,567` です。
   - 支出は U+2212 の「−」を付け、色は `text-fg-destructive` です。
   - 収入の色は `text-fg-success` です。
6. **色の意味は sakiguri 独自です。**
   - エラーは plum（赤ではない）、注意は green（黄ではない）、成功と情報は teal です。
   - shadcn の既定の色を使わないでください。
7. **文言は `screens.md` / Figma のとおりにします。** 言い換えや短縮はしないでください。
8. **ダークモードは `.dark` クラスで切り替えます。** トークンは用意済みですが、画面デザインはライトだけです。初期リリースはライト固定で構いません。
9. **密度：** 大きな表には `data-density="compact"` を付けます。それ以外は Comfortable です。

## ディレクトリ（推奨）

```
app/
  globals.css            ← @import "tailwindcss"; @import "../docs/design/tokens.css";
  (app)/layout.tsx       ← Sidebar inset + SideNav + <main>
  (app)/page.tsx         ← ダッシュボード
  (app)/cashflow/page.tsx
  (app)/monthly/page.tsx
  (app)/actuals/page.tsx
  (app)/import/page.tsx
  (app)/settings/page.tsx
components/ui/           ← shadcn
components/sakiguri/     ← SideNav, NavItem, PageHeader, Panel, Amount, Stat, LedgerRow,
                           TodoRow, TableCell, MonthTab, Step, LegendItem, CategoryTag,
                           StatusChip, Callout, ForecastChart
lib/format.ts            ← formatYen, formatDate（M/D・YYYY年M月D日）
lib/mock.ts              ← screens.md のサンプルデータ
```

## 進め方

1. **土台**
   - `tokens.css` の取り込み、フォントの設定、`formatYen` の実装。
   - 色見本のページ（`/dev/tokens`）を作り、Figma の Foundations と見比べます。
2. **部品**
   - `components/sakiguri/*` を作り、`/dev/components` に全 variant と state を並べます。
   - Figma のページ `2007:3` のスクリーンショットと見比べます。
3. **共通レイアウト**（SideNav・PageHeader）
4. **画面**
   - 01 → 07 の順で、まずモックデータで作ります。
   - 1画面できるごとに、Figma の `get_screenshot` とブラウザのスクリーンショットを並べて差分を確認します。
5. **データ層**
   - 予定の生成（定期項目・末日の補正・カード引き落とし）、照合のルール、残高の計算。
   - この部分の仕様は `decisions.md` にあります。

## 完了の基準（各画面）

- 1440px 幅で Figma と並べて、レイアウト・余白・色・文言が一致すること。
- コードに hex や任意値が残っていないこと。次のコマンドで確認します。

  ```
  grep -rE "#[0-9a-fA-F]{3,8}|\[[0-9]+px\]" app components
  ```

  ヒットしてよいのは `tokens.css` だけです。
- キーボードだけで操作できること。現在のページの NavItem に `aria-current` が付いていること。ダイアログの初期フォーカスが「やめる」にあること。
