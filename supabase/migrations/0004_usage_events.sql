-- ============================================================
-- 0004 利用イベントの記録
--
-- 一次情報：docs/PoC開発計画.md §4「PoCで取る指標」
-- 対応するタスク：フェーズ3・タスク#13
--
-- 設計方針は docs/adr/0013-利用イベントに金額を入れない.md
--
-- 要点は2つ。
--
-- 1. **イベントに資金繰りの中身を入れない。**
--    金額・費目名・取引先名・口座名・ファイル名・IP・User-Agent を
--    入れない。入れると、アクセス制御の違う場所に資金繰りデータの
--    複製ができ、本体を RLS で守っている意味がなくなる。
--    記録するのは「取り込んだ」という事実であって「いくら」ではない。
--
-- 2. **利用者には insert しか与えない。**
--    自分のイベント履歴を見る画面は v1.0 に無いため、select も与えない。
--    update と delete はポリシーを書かない。イベントは訂正も削除も
--    しない記録である。
--    集計はダッシュボードの SQL Editor から secret 権限で行う。
-- ============================================================

create table public.usage_events (
  id bigint generated always as identity primary key,

  -- 退会したら一緒に消える（非機能要件 5.1：退会後30日で物理削除）
  user_id uuid not null references auth.users (id) on delete cascade,

  -- 何が起きたか。src/lib/analytics/events.ts と対応する
  event text not null,

  -- 件数・期間の長さ・種別・口座数などの非機微な値だけ。
  -- 金額と名称は入れない（上記1）
  props jsonb not null default '{}'::jsonb,

  -- **サーバー側の時刻。クライアントの時刻を信用しない**
  occurred_at timestamptz not null default now()
);

create index usage_events_user_idx on public.usage_events (user_id, occurred_at);
create index usage_events_event_idx on public.usage_events (event, occurred_at);

-- ============================================================
-- RLS
-- ============================================================

alter table public.usage_events enable row level security;

-- **insert だけ。** 自分の user_id でしか書けない。
create policy "insert own events" on public.usage_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- select のポリシーは意図的に書かない。
--   自分のイベント履歴を見る画面が v1.0 に無いため、使わない権限は
--   与えない。supabase-js の .insert() は .select() を連鎖しない限り
--   行を返さないので、書き込みは動く。
--
-- update / delete のポリシーも意図的に書かない。
--   イベントは訂正も削除もしない記録。
--
-- RLS が有効でポリシーが1つでもあるため、0002 の rls_guard には
-- 引っかからない。

comment on table public.usage_events is
  'PoC の指標のための利用イベント。資金繰りの中身（金額・名称）は入れない。'
  '　利用者は insert のみ。集計は SQL Editor から secret 権限で行う。';
comment on column public.usage_events.props is
  '件数・期間の長さ・種別など非機微な値のみ。金額と名称を入れないこと。';
comment on column public.usage_events.occurred_at is
  'サーバー側の now()。クライアントの時刻は使わない。';
