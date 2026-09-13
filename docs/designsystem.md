# デザインシステム ── Sakiguri 実装用

Vastra Design System を Sakiguri のアプリ実装に落としたもの。**色・サイズ・余白は必ずここに定義されたトークンから引く。** 中間値を作らない。

実装は `src/styles/tokens.css` に CSS カスタムプロパティとして定義し、コンポーネントからは `var(--...)` で参照する。hex や px を直接書かない。

---

## 1. カラートークン

### 1.1 プリミティブ

各色相は `100`（濃）から `010`（淡）へのランプを持つ。セマンティックトークンのエイリアス先としてのみ使い、UI から直接参照しない。

```css
:root{
  /* blue */
  --blue-100:#065D63; --blue-090:#1F6E73; --blue-070:#518E92; --blue-050:#82AEB1;
  --blue-030:#B4CED0; --blue-015:#DAE7E8; --blue-010:#E6EEEF;
  /* green */
  --green-100:#06631E; --green-090:#1F7335; --green-070:#519262; --green-050:#82B18E;
  --green-030:#B4D0BB; --green-015:#DAE8DE; --green-010:#E6EFE8;
  /* purple */
  --purple-100:#63063E; --purple-090:#731F52; --purple-070:#925178; --purple-050:#B1829E;
  --purple-030:#D0B4C5; --purple-015:#E8DAE2; --purple-010:#EFE6EB;
  /* lightblue */
  --lightblue-100:#068891; --lightblue-090:#1F949C; --lightblue-070:#51ACB3;
  --lightblue-050:#82C3C8; --lightblue-030:#B4DBDE; --lightblue-015:#DAEDEF; --lightblue-010:#E6F3F4;
  /* lightgreen */
  --lightgreen-100:#069149; --lightgreen-090:#1F9C5C; --lightgreen-070:#51B380;
  --lightgreen-030:#B4DEC8; --lightgreen-015:#DAEFE4; --lightgreen-010:#E6F4EC;
  /* lightpurple */
  --lightpurple-100:#91066E; --lightpurple-090:#9C1F7D; --lightpurple-070:#B3519A;
  --lightpurple-030:#D3A7C8; --lightpurple-015:#EFDAEA; --lightpurple-010:#F4E6F0;
  /* graytone */
  --gray-100:#333333; --gray-090:#484848; --gray-070:#717171; --gray-050:#999999;
  --gray-030:#C1C1C1; --gray-015:#E1E1E1; --gray-010:#EAEAEA;
  /* base */
  --base-black:#111111; --base-white:#FFFFFF; --thin-gray:#EEEEEE;
}
```

### 1.2 セマンティック

**UI からはこちらを参照する。**

```css
:root{
  /* object — 文字・アイコン */
  --object-base-high:var(--gray-100);
  --object-base-mid:var(--gray-070);
  --object-base-low:var(--gray-030);
  --object-base-high-inverse:var(--base-white);
  --object-base-mid-inverse:var(--blue-030);
  --object-accent-dim:var(--blue-100);
  --object-accent-bright:var(--lightblue-100);
  --object-error-dim:var(--purple-100);
  --object-error-bright:var(--lightpurple-100);
  --object-caution-dim:var(--green-100);
  --object-caution-bright:var(--lightgreen-100);
  --object-success-dim:var(--blue-100);
  --object-success-bright:var(--lightblue-100);

  /* surface — 背景 */
  --surface-base-primary:var(--base-white);
  --surface-base-secondary:var(--thin-gray);
  --surface-base-primary-inverse:var(--blue-100);
  --surface-overlay-hoverd:var(--gray-010);
  --surface-overlay-selected:var(--blue-010);
  --surface-accent-thin:var(--blue-015);
  --surface-accent-subtle:var(--blue-010);
  --surface-success-subtle:var(--lightblue-010);
  --surface-caution-subtle:var(--green-010);
  --surface-error-subtle:var(--purple-010);

  /* border */
  --border-base-high:var(--gray-030);
  --border-base-low:var(--gray-015);
  --border-accent-high:var(--blue-030);
  --border-error-high:var(--purple-030);
  --border-caution-high:var(--green-030);
  --border-success-high:var(--lightblue-030);
}
```

### 1.3 このシステムで注意すべき点

**`error` は赤ではなく purple、`caution` は黄ではなく green。** `success` と `accent` は同じ blue 系を指す。一般的な配色と異なるため、「エラーだから赤」と推測して色を選ばないこと。

### 1.4 Sakiguri での用途マッピング

金額と区分の表現は次の対応で固定する。**独自の割り当てを作らない。**

| 用途 | トークン | 実際の色 |
|---|---|---|
| 収入・プラスの金額 | `--object-success-bright` | lightblue |
| 支出・マイナス残高・資金ショート | `--object-error-dim` | purple |
| 防衛ライン割れの注意 | `--object-caution-dim` | green |
| 固定費のタグ | accent 系（blue） | blue |
| 変動費のタグ | caution 系（green） | green |
| 収入のタグ | success 系（lightblue） | lightblue |
| カード引落のタグ | error-bright 系（lightpurple） | lightpurple |
| 振替のタグ | base-mid（gray） | gray |
| 事業割合（按分）のタグ | error-bright 系（lightpurple） | lightpurple |
| 予定バッジ | 破線・白抜き | — |
| 実績バッジ | 塗りつぶし（gray-100） | — |

グラフでは次を使う。

| 系列 | 色 | 線種 |
|---|---|---|
| 実績残高 | `--gray-100` | 実線 2px |
| 予測残高 | `--blue-100` | 破線 |
| 0円ライン | `--purple-100` | 実線 |
| 生活防衛ライン | `--green-100` | 破線 |
| 月間入金（棒） | `--lightblue-100` | — |
| 月間出金（棒） | `--lightpurple-100` | — |
| 月中最低残高 | `--lightgreen-100` | 点線 |

---

## 2. タイポグラフィ

### 2.1 書体

```css
:root{
  --family-ui:'Inter','Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,system-ui,sans-serif;
  --family-display-en:'Cormorant Garamond','Times New Roman',serif;
  --family-display-jp:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;
}
```

- `--family-ui`：本文、ラベル、ボタン、数値。**アプリ画面はほぼすべてこれ。**
- `--family-display-en`：ワードマーク「SAKIGURI」のみ
- `--family-display-jp`：カード見出しなど、和文の見出し

### 2.2 ウェイトとサイズ

```css
:root{
  --w-light:300; --w-normal:400; --w-semibold:600; --w-bold:700;

  --size-display-lg:56px; --size-display-md:48px; --size-display-sm:36px;
  --size-headline-xlg:34px; --size-headline-lg:28px; --size-headline-md:24px;
  --size-headline-sm:20px; --size-headline-xs:18px;
  --size-body-xlg:20px; --size-body-lg:18px; --size-body-md:16px; --size-body-xmd:15px;
  --size-body-sm:14px; --size-body-xs:13px; --size-body-xxs:12px;

  --tracking-wide:0.025em; --tracking-normal:0; --tracking-tight:-0.025em;
}
```

### 2.3 テキストスタイルの使い分け

| 用途 | サイズ | ウェイト | 行間 |
|---|---|---|---|
| 残高のヘッドライン | `--size-headline-xlg` (34px) | semibold | 1.0 |
| カードのKPI数値 | `--size-headline-lg` (28px) | semibold | 1.2 |
| カード見出し（和文） | `--size-body-md` (16px) | semibold | 1.4 |
| 本文 | `--size-body-sm` (14px) | normal | 1.5 |
| テーブル | `--size-body-xs` (13px) | normal | 1.4 |
| ラベル・注記 | `--size-body-xxs` (12px) | normal〜semibold | 1.5 |

### 2.4 数値の表示

**金額・件数・日付を含むすべての数値に `font-variant-numeric: tabular-nums` を指定する。** 等幅数字にしないと桁が揃わず、資金繰り表が読めなくなる。

```css
.num, td.n, input.n { font-variant-numeric: tabular-nums; }
```

等幅フォントは使わない。`--family-ui`（Inter）の tabular-nums で足りる。

マイナスの表記は `−`（U+2212）を使う。ハイフンは使わない。

---

## 3. スペーシング

```css
:root{
  --sp-4:4px; --sp-8:8px; --sp-12:12px; --sp-16:16px; --sp-24:24px;
  --sp-32:32px; --sp-40:40px; --sp-48:48px; --sp-56:56px; --sp-64:64px; --sp-72:72px;
}
```

**このスケール以外の値を書かない。** 5px、9px、15px のような中間値を作らないこと。

主な適用箇所。

| 箇所 | 値 |
|---|---|
| カード内側の余白 | `--sp-16` |
| カードヘッダーの余白 | `--sp-12` `--sp-16` |
| テーブルセル | `--sp-8` `--sp-12` |
| フォーム要素の内側 | `--sp-4` `--sp-8` |
| セクション間 | `--sp-24` |
| ページの左右余白 | `--sp-24`（モバイルは `--sp-12`） |

角丸は `--radius: 4px` に統一する。カードもボタンもタグも同じ値を使う。

---

## 4. コンポーネント

Figma に定義のあるコンポーネントに対応させる。プロパティ名は Figma 側と揃える。

### Button（`btn`）

| プロパティ | 値 |
|---|---|
| `color` | `black` / `white` / `line` / `line_gray` |
| `size` | `lg` / `md` / `sm` |
| `type` | `normal` / `hover` / `disabled` |
| `hasIcon` | `none` / `front` / `back` |

- `black`：背景 `--object-base-high`、文字 white
- `white`：背景 white、枠 `--border-base-high`
- `line` / `line_gray`：背景なしの枠線のみ
- `md`：padding `--sp-8` `--sp-16`、`--size-body-xs`
- `sm`：padding `--sp-4` `--sp-8`、`--size-body-xxs`

### Tag（`tag`）

| プロパティ | 値 |
|---|---|
| `color` | `green` / `gray` / `line` / `line_gray` |
| `size` | `md` / `sm` |
| `hasIcon` | `true` / `false` |

Sakiguri では区分バッジ（固定費・変動費・収入・引落・振替・事業割合）に `size: sm` を使う。配色は 1.4 のマッピングに従う。

### TextInput / Textarea / Select / Checkbox / RadioButton / Switch

Figma の定義に従う。枠線は `--border-base-high`、フォーカス時は `outline: 2px solid var(--object-accent-bright)` を `outline-offset: 1px` で当てる。

### Notification

警告バナー。左に 4px のバーを引く。

- エラー（資金ショート）：バー `--object-error-dim`、背景 `--surface-error-subtle`
- 情報：バー `--object-accent-dim`、背景 `--surface-accent-subtle`

### Icon

Heroicons ベース。**アイコンを装飾として置かない。** 意味を持つ場所にだけ使う。

---

## 5. レイアウト規約

**左ナビゲーション + コンテンツ。** デスクトップではサイドバー 216px を固定し、`--surface-base-primary-inverse`（blue-100）で塗る。選択中の項目は白背景に blue-100 の文字で反転させる。

**900px 未満では上部の横並びに切り替える。** サイドバーは横スクロールのタブ列になる。

**残高ヘッダーはスティッキー。** 白背景、下に `--border-base-low` の罫線。現預金残高・30日後・90日後・カード未払を横に並べる。

**テーブルは横スクロールを許容する。** 年月別収支は12ヶ月＋年計で横に長い。列を削って収めようとしない。1列目はスティッキーにする。

---

## 6. やらないこと

- hex や px を直接書く
- スペーシングスケール外の値を作る
- `error` に赤、`caution` に黄を割り当てる（このシステムでは purple と green）
- 見出しにゴシック、本文に明朝を使う（逆にしない）
- 等幅フォントを数値表示のために導入する（tabular-nums で足りる）
- アイコンを装飾として並べる
- グラデーション、影、角丸の大きなカードでの装飾
