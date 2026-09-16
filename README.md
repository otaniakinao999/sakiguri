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
cp .env.example .env.local   # Supabase の URL と publishable キーを入れる
```

## コマンド

```bash
pnpm dev          # 開発サーバー
pnpm build        # 本番ビルド
pnpm test         # Vitest（src/core のテスト）
pnpm test:watch
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
```

PR を出す前に `pnpm typecheck && pnpm test && pnpm lint` が通っていることを確認する。

## データベース

スキーマは [supabase/migrations/](./supabase/migrations/) にある。**0001 → 0002 の順で適用する。**
0002 は RLS の漏れを検査し、1件でもあればマイグレーションごと失敗させる。

```bash
npx --yes supabase@latest link --project-ref <プロジェクト参照>
pnpm db:migrate
```

CLI を使わない場合は、Supabase ダッシュボードの SQL Editor に2ファイルを順に貼る。

### RLS

**テーブルを作ったら必ず RLS を有効化し、ポリシーを書く**（CLAUDE.md §2.5）。
`using` だけでなく `with check` も書くこと。無いと他人の `user_id` を入れた行を作れてしまう。

効いていることは実際に確かめる。2人のユーザーを作り、読み・更新・削除・
他人名義での作成を試す。

```bash
node scripts/verify-rls.mjs
```

検証には Authentication → Sign In / Providers の「Confirm email」を一時的に切る必要がある
（登録直後にセッションが返らないと2人目を作れないため）。

## 受入基準とテスト

`src/core/__tests__/` のテストは要件定義書 §9 の受入基準 AC-01〜AC-20 に対応する。

**（v2.0）と付いた AC-11〜AC-17・AC-19 は PoC で作らない機能**（借入返済スケジュール、売掛金の入金予定、税理士の代理操作）に対応する。[v2-acceptance.test.ts](./src/core/__tests__/v2-acceptance.test.ts) に `it.todo` として置いてあり、必要な素材と期待値をコメントに書いてある。**削除しないこと。** 実装時に通常の `it` へ書き換えて有効化する。

PoC での代替手段は [PoC開発計画 §4](./docs/PoC開発計画.md) を参照。

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
