-- ============================================================
-- 0001 初期スキーマ
--
-- 一次情報：docs/要件定義書.md §3.2 データモデル
-- 対応する機能要件：FR-17（ユーザー登録・認証・クラウド同期）
--
-- **すべてのテーブルで RLS を有効化し、ポリシーを書く。**
-- 他人の資金繰りが見える事故は、このプロダクトでは致命的
-- （CLAUDE.md §2.5、PoC開発計画 §5.4）。
--
-- 規約：
--   金額は円単位の整数（bigint）。numeric を使わない（ADR-0001）
--   日付は date。timestamptz を使わない（ADR-0002）
--   費目はコードで保持する（要件定義書 §3.1.2）
-- ============================================================

-- ------------------------------------------------------------
-- 共通：更新時刻
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- settings（基準日と生活防衛ライン）
--   1ユーザー1行。
-- ------------------------------------------------------------
create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 基準日。この日の口座残高を入力値として与える（要件定義書 §1.3）
  as_of date not null,
  -- 生活防衛ライン。法人では必要運転資金ライン
  reserve_line bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- accounts（口座・カード）
-- ------------------------------------------------------------
create table public.accounts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('bank', 'cash', 'card')),
  -- card の場合は未払残高（正の値）
  balance bigint not null default 0,
  -- 以下は kind = 'card' のとき必須（要件定義書 §3.2）
  closing_day smallint check (closing_day between 1 and 31),
  pay_month_offset smallint check (pay_month_offset between 0 and 2),
  pay_day smallint check (pay_day between 1 and 31),
  settle_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- card なら4項目が揃っていること。型で表せない制約をここで担保する
  -- （アプリ側は判別可能なユニオン。docs/adr/0009）
  constraint accounts_card_fields check (
    kind <> 'card'
    or (
      closing_day is not null
      and pay_month_offset is not null
      and pay_day is not null
    )
  )
);

create index accounts_user_id_idx on public.accounts (user_id);

-- ------------------------------------------------------------
-- recurring_items（定期項目）
-- ------------------------------------------------------------
create table public.recurring_items (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense', 'transfer')),
  -- 費用のときのみ意味を持つ（要件定義書 §3.1.2 適用規則6）
  cost_type text check (cost_type in ('fixed', 'variable')),
  -- 費目コード。名称ではなくコードで保持する（§3.1.2）
  category_code text not null,
  amount bigint not null default 0,
  biz_ratio smallint not null default 0 check (biz_ratio between 0 and 100),
  account_id uuid not null,
  to_account_id uuid,
  -- 発生日。31 は月末になる（CL-1）
  day smallint not null check (day between 1 and 31),
  -- 発生月（1〜12）。null は毎月
  months smallint[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_items_user_id_idx on public.recurring_items (user_id);

-- ------------------------------------------------------------
-- oneoff_items（単発予定）
-- ------------------------------------------------------------
create table public.oneoff_items (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  name text not null,
  type text not null check (type in ('income', 'expense', 'transfer')),
  cost_type text check (cost_type in ('fixed', 'variable')),
  category_code text not null,
  amount bigint not null default 0,
  biz_ratio smallint not null default 0 check (biz_ratio between 0 and 100),
  account_id uuid not null,
  to_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index oneoff_items_user_id_idx on public.oneoff_items (user_id);
create index oneoff_items_user_date_idx on public.oneoff_items (user_id, date);

-- ------------------------------------------------------------
-- actuals（実績）
--   非機能要件 5.1 は1ユーザーあたり10万件まで劣化しないことを求める。
-- ------------------------------------------------------------
create table public.actuals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 紐づく予定インスタンスのキー。手入力の突発支出では null（消し込み）
  plan_key text,
  date date not null,
  name text not null,
  type text not null check (type in ('income', 'expense', 'transfer')),
  cost_type text check (cost_type in ('fixed', 'variable')),
  category_code text not null,
  amount bigint not null default 0,
  biz_ratio smallint not null default 0 check (biz_ratio between 0 and 100),
  account_id uuid not null,
  to_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index actuals_user_id_idx on public.actuals (user_id);
create index actuals_user_date_idx on public.actuals (user_id, date);
create index actuals_user_plan_key_idx on public.actuals (user_id, plan_key);

-- ------------------------------------------------------------
-- overrides（この回だけの変更）
--   キーは予定インスタンスキー（要件定義書 §3.2）。
-- ------------------------------------------------------------
create table public.overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_key text not null,
  -- 変更後の日付。null は「日付は変えない」
  date date,
  -- 変更後の金額。null は「金額は変えない」
  amount bigint,
  -- true なら当回を発生させない
  skipped boolean,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_key)
);

-- ============================================================
-- RLS
--   **ここを忘れると全ユーザーのデータが誰からでも読める。**
--   テーブルを足したら必ずこの節にも足すこと（CLAUDE.md §2.5）。
--   漏れは 0002_rls_guard.sql の検出SQLで見つけられる。
-- ============================================================

alter table public.settings        enable row level security;
alter table public.accounts        enable row level security;
alter table public.recurring_items enable row level security;
alter table public.oneoff_items    enable row level security;
alter table public.actuals         enable row level security;
alter table public.overrides       enable row level security;

-- 自分の行だけ。読みも書きも同じ条件で絞る。
-- with check を付けないと、他人の user_id で insert できてしまう。
create policy "own rows" on public.settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own rows" on public.accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own rows" on public.recurring_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own rows" on public.oneoff_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own rows" on public.actuals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own rows" on public.overrides
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ------------------------------------------------------------
-- 更新時刻のトリガ
-- ------------------------------------------------------------
create trigger settings_touch        before update on public.settings        for each row execute function public.touch_updated_at();
create trigger accounts_touch        before update on public.accounts        for each row execute function public.touch_updated_at();
create trigger recurring_items_touch before update on public.recurring_items for each row execute function public.touch_updated_at();
create trigger oneoff_items_touch    before update on public.oneoff_items    for each row execute function public.touch_updated_at();
create trigger actuals_touch         before update on public.actuals         for each row execute function public.touch_updated_at();
create trigger overrides_touch       before update on public.overrides       for each row execute function public.touch_updated_at();
