-- ============================================================
-- 0008 import_rules（CSV仕分けルール）
--
-- 一次情報：docs/要件定義書.md §3.2 ImportRule、§3.3 CL-10、FR-18
--
-- 取込の確認画面で、照合が成立しなかった行の費目を決める。
-- **利用者が作る。自動では作らない**（OI-2 の結論）。
--
-- 適用の順序：**このマイグレーションを適用してからコードをデプロイする**
-- （CLAUDE.md §2.5.1）。新しいテーブルの追加なので後方互換である。
--
-- **未適用でもコードが壊れないようにしてある。** 読み込み側は「テーブルが
-- 無い」だけを見分けて空のルール一覧として扱う（`src/lib/supabase/storage.ts`
-- の `fetchRules`、ADR-0026）。適用とデプロイの順序を人の手順で守らせると、
-- 逆順になった瞬間にアプリ全体が読み込めなくなる ―― `loadAppData` は
-- `Promise.all` の中で読むので、1つの 42P01 で全部が落ちる。
--
-- `type` 列は持たない。収支は金額の符号で決まり（CL-7）、ルールはそれを
-- 変えない。振替は `type` ではなく費目で表す（適用規則5a・ADR-0025）。
-- ============================================================

create table if not exists public.import_rules (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 摘要に含まれていれば当たり。利用者が書いた文字列をそのまま持つ。
  -- **空は許さない。** `''` は全行に含まれるので、全行に当たるルールになる。
  pattern text not null check (btrim(pattern) <> ''),
  -- null は全口座。他のテーブルと同じく accounts への外部キーは張らない
  account_id uuid,
  -- null は両方。意味を持つのは TRF の費目のときだけ（費目から導く）
  direction text check (direction in ('in', 'out')),
  category_code text not null,
  cost_type text check (cost_type in ('fixed', 'variable')),
  biz_ratio smallint not null default 0 check (biz_ratio between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_rules_user_id_idx on public.import_rules (user_id);

-- ------------------------------------------------------------
-- 当たる条件は一意（§3.2 ImportRule・AC-57f）
--   同じ条件で決める内容だけが違う2行があると、**どちらが勝つかは id の順で
--   決まり、画面からは見分けられない。**
--
--   **`nulls not distinct` が要る**（PostgreSQL 15 以上）。既定では null は
--   互いに異なるので、素直に張ると **account_id が null のルール（全口座）と
--   direction が null のルール（両方）だけ重複し放題になる。** いちばん
--   作られやすい組み合わせがいちばん守られない。落ちていないことは
--   このファイルの末尾で検査する。
-- ------------------------------------------------------------
create unique index if not exists import_rules_match_key_idx
  on public.import_rules (user_id, pattern, account_id, direction)
  nulls not distinct;

-- ------------------------------------------------------------
-- RLS（CLAUDE.md §2.5）
--   自分の行だけ。読みも書きも同じ条件で絞る。
--   with check を付けないと、他人の user_id で insert できてしまう。
-- ------------------------------------------------------------
alter table public.import_rules enable row level security;

create policy "own rows" on public.import_rules
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.import_rules is
  'CSV仕分けルール（FR-18・CL-10）。利用者が作る。自動学習はしない。'
  '　当たりは pattern の部分一致で、複数当たったら pattern の長い順に1件。';

comment on column public.import_rules.pattern is
  '摘要に含まれていれば当たり。切り詰めない。空は許さない（全行に当たるため）';

comment on column public.import_rules.direction is
  '行の向き。入金が in。意味を持つのは TRF の費目のときだけ（INC/EXP は費目から導く）';

-- ------------------------------------------------------------
-- 適用後の確認
--   RLS が有効でポリシーが1本あること。
--   一意制約があり、**null を同じとみなす設定が落ちていないこと**
--   ―― ここが落ちると、全口座のルールだけ重複できる状態で通ってしまう。
-- ------------------------------------------------------------
do $$
declare
  guarded boolean;
  policies int;
  nulls_merged boolean;
begin
  select relrowsecurity into guarded
    from pg_class where oid = 'public.import_rules'::regclass;
  select count(*) into policies
    from pg_policy where polrelid = 'public.import_rules'::regclass;

  if not guarded or policies = 0 then
    raise exception 'import_rules の RLS が有効でない、またはポリシーが無い（RLS=%、ポリシー=%件）',
      guarded, policies;
  end if;

  select indnullsnotdistinct into nulls_merged
    from pg_index where indexrelid = 'public.import_rules_match_key_idx'::regclass;

  if nulls_merged is null then
    raise exception 'import_rules の一意制約（import_rules_match_key_idx）が無い';
  end if;
  if not nulls_merged then
    raise exception 'import_rules_match_key_idx に nulls not distinct が無い（全口座のルールだけ重複できる）';
  end if;
end $$;
