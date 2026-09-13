# Sakiguri

個人事業主と小規模法人のための資金繰り予測サービス。予定を先に登録し、実績で消し込みながら、日次の残高予測を最新に保つ。

## 読む順番

| ファイル | 位置づけ |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | 開発規約。推測で上書きしない |
| [docs/要件定義書.md](./docs/要件定義書.md) | 仕様の一次情報。計算ロジック CL-1〜CL-9、受入基準 AC-01〜17 |
| [docs/PoC開発計画.md](./docs/PoC開発計画.md) | タスク分解と実開発の懸念 |
| [docs/designsystem.md](./docs/designsystem.md) | デザイントークンの一次情報 |
| [docs/adr/](./docs/adr/) | 設計判断の記録 |
| [docs/prototype/](./docs/prototype/) | 参照実装。そのまま本番に持ち込まない |

## 環境

Node.js 20 以上（開発は 24 で確認）、pnpm。

```bash
corepack enable --install-directory ~/Library/pnpm pnpm
pnpm install
```

## コマンド

```bash
pnpm dev          # 開発サーバー
pnpm build        # 本番ビルド
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
```

`pnpm test` / `pnpm test:watch`（Vitest）はフェーズ1・タスク#2 で、`pnpm db:migrate`（Supabase）はフェーズ3・タスク#12 で追加する。

PR を出す前に `pnpm typecheck && pnpm lint` が通っていることを確認する。テストが入り次第 `pnpm test` を加える。

## 構成

```
src/
  app/            Next.js App Router
  core/           計算ロジック（純関数。React / DOM / fetch を import しない）
  styles/
    tokens.css    デザイントークン。docs/designsystem.md の転記
```

`src/core/` の制約は CLAUDE.md §2.3 と [ADR-0003](./docs/adr/0003-残高計算をクライアント側で行う.md) を参照。

## スタイル

色とサイズは `src/styles/tokens.css` のトークンからのみ引く。Tailwind の既定スケールは無効化してあり、スケール外の値（`p-15`、`bg-red-500`）はクラスが生成されない。**`p-16` は 16px であり、Tailwind 既定の 64px ではない。** 経緯は [ADR-0004](./docs/adr/0004-Tailwindをデザイントークンに束縛する.md) を参照。
