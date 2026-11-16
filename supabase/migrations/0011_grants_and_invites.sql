-- ============================================================
-- 0011 grants / invites / actuals.created_by（共有）
--
-- 一次情報：docs/要件定義書.md FR-23・FR-31・FR-67、AC-76〜AC-83
--           artifact「権限とアカウント」案A、ADR-0046
--
-- **所有は人のまま。** 8表の `user_id` は触らない。共有は別の表で表す
-- （AC-76）。実データが入っている上で所有の列を差し替えるのは、この案件で
-- 最も危険な種類の変更である（CLAUDE.md §2.5.2）。
--
-- 適用の順序：**このマイグレーションを適用してからコードをデプロイする**
-- （§2.5.1）。表と列の追加、ポリシーの緩和だけなので後方互換である ――
-- 所有者の権限は1文字も変わらず、`grants` が0行のあいだ**挙動は現状と
-- 完全に同じ**になる。未適用のままコードが先に出ても、共有の画面が
-- 「テーブルが無い」で空になるだけで、既存の画面は壊れない。
--
-- **破壊的ではない**（§2.5.2）。列を消さず、型も変えず、NOT NULL も
-- 足さない。書き出しは要らない。
-- ============================================================

-- ------------------------------------------------------------
-- grants（誰が誰の帳をどの権限で見られるか）
--
--   **`actuals` を参照しない**（AC-80）。失効しても代理で入れた実績は
--   持ち主の帳に残る ―― 記帳は持ち主の帳への行為であって、代行者の
--   持ち物ではない。**これはテストではなく列の設計で守る。** この表から
--   実績への外部キーを張った瞬間に、cascade の経路ができる。
--
--   **段は2つだけ**（AC-77）。3段目（設定を触れる／触れない）を作らない。
--   段を増やすと、その分が全部 RLS の述語に乗る。
-- ------------------------------------------------------------
create table if not exists public.grants (
  owner_id uuid not null references auth.users (id) on delete cascade,
  grantee_id uuid not null references auth.users (id) on delete cascade,
  level text not null check (level in ('view', 'edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 自分に自分を付与しない。意味が無いうえ、述語の1本目と二重になる
  constraint grants_not_self check (owner_id <> grantee_id),
  primary key (owner_id, grantee_id)
);

create index if not exists grants_grantee_idx on public.grants (grantee_id);

drop trigger if exists grants_touch on public.grants;
create trigger grants_touch before update on public.grants
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- invites（アカウントがまだ無い相手を呼ぶ）
--
--   **アドレスをそのまま持つ**（AC-79）。アドレスから `user_id` を引く
--   経路を画面から使えるようにすると、**誰でも「そのアドレスが登録されて
--   いるか」を試せる。** 相手がサインインしたときに、自分のアドレスに
--   向いた招待を**自分で受け取る**（`accept_invite`）。
-- ------------------------------------------------------------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- この時点では利用者と紐づいていない。**紐づけてはいけない**（AC-79）
  email text not null check (btrim(email) <> ''),
  level text not null check (level in ('view', 'edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- 同じ相手を二重に招待しない。大文字小文字は同じ相手として扱う
create unique index if not exists invites_owner_email_idx
  on public.invites (owner_id, lower(email));

create index if not exists invites_email_idx on public.invites (lower(email));

drop trigger if exists invites_touch on public.invites;
create trigger invites_touch before update on public.invites
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- actuals.created_by（AC-81）
--
--   **ここが「操作履歴」の上限である。** 行に「誰が入れたか」を持たせる。
--   変更前の値を残す・読み取りを記録する・消した行を残す・改変できない
--   記録にする、の4つは**対象外**（監査ログ。従業員20名超の要求）。
--
--   **`on delete set null`。** artifact の下書きは動作を書いていないが、
--   既定の no action だと**代行者のアカウントを消せなくなる。** 消えて
--   困るのは実績の行であって、誰が入れたかの印ではない。
-- ------------------------------------------------------------
alter table public.actuals
  add column if not exists created_by uuid references auth.users (id) on delete set null;

comment on column public.actuals.created_by is
  '誰がこの行を入れたか（AC-81）。代理操作の区別のためだけに持つ。'
  '　監査ログではない ―― 変更前の値・読み取り・削除は記録しない。';

-- ============================================================
-- 7表のポリシーを張り替える
--
--   **`usage_events` は共有の対象外**（指標の記録。ADR-0013）。誰も
--   select できず、teardown も消さない。ここには手を付けない。
--
--   **`for all` を4つに割る。** 読みは閲覧以上、書きは編集だけ。1本の
--   ままだと、閲覧の客に書き込みを許すか、客に読み込みを許さないかの
--   どちらかになる。
--
--   **述語はこのファイルの2つの定数だけ**（CLAUDE.md §2.8）。7回書き写すと、
--   1つだけ違う式になったときに目で見つけられない。末尾で本数を数える。
--
--   **関数に切り出さない。** `can_read(user_id)` のような SQL 関数は
--   読みやすいが、**`set search_path` を付けた関数はインライン展開されない。**
--   展開されないと、行ごとに関数を呼ぶことになり、**実績10万件（§5.1）で
--   10万回の呼び出し**になる。ここでは式をそのまま置き、プランナに
--   semi join を選ばせる。
--
--   **`in (select ...)` は相関していない。** `grantee_id` だけで絞るので
--   1回で済み、結果はハッシュに載る。`exists (... and g.owner_id = user_id)`
--   と書くと行ごとの相関になりうる。
-- ============================================================
do $$
declare
  t text;
  shared text[] := array[
    'settings', 'accounts', 'recurring_items',
    'oneoff_items', 'actuals', 'overrides', 'import_rules'
  ];
  -- 持ち主か、閲覧以上を渡された客か（AC-77）
  readable text :=
    'user_id = (select auth.uid())
     or user_id in (select g.owner_id from public.grants g
                     where g.grantee_id = (select auth.uid()))';
  -- 持ち主か、編集を渡された客か（AC-77）
  writable text :=
    'user_id = (select auth.uid())
     or user_id in (select g.owner_id from public.grants g
                     where g.grantee_id = (select auth.uid())
                       and g.level = ''edit'')';
begin
  foreach t in array shared loop
    execute format('drop policy if exists %I on public.%I', 'own rows', t);
    execute format('drop policy if exists %I on public.%I', 'read own or granted', t);
    execute format('drop policy if exists %I on public.%I', 'insert when editable', t);
    execute format('drop policy if exists %I on public.%I', 'update when editable', t);
    execute format('drop policy if exists %I on public.%I', 'delete when editable', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      'read own or granted', t, readable);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      'insert when editable', t, writable);
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      'update when editable', t, writable, writable);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      'delete when editable', t, writable);
  end loop;
end $$;

-- ------------------------------------------------------------
-- grants の RLS
--
--   **書けるのは持ち主だけ**（AC-78）。編集を渡された客が別の客を呼べる
--   形にすると、**持ち主が知らない人が帳を見られる。**
--
--   **読みは客にも要る。** 7表の述語が `grants` を引くので、客がこの行を
--   読めないと述語が成立しない（ポリシーの中から引く表にも、その利用者の
--   RLS がそのまま効く）。自分に向いた付与しか見えないので、他人の
--   共有関係は漏れない。
-- ------------------------------------------------------------
alter table public.grants enable row level security;

drop policy if exists "owner writes" on public.grants;
drop policy if exists "owner or grantee reads" on public.grants;

create policy "owner or grantee reads" on public.grants
  for select to authenticated
  using (owner_id = (select auth.uid()) or grantee_id = (select auth.uid()));

create policy "owner writes" on public.grants
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ------------------------------------------------------------
-- invites の RLS
--
--   持ち主は自分が出した招待を作る・見る・消す。
--   **客は自分のアドレスに向いた招待だけを読める**（AC-79）。他人宛の
--   招待が見えると、そのアドレスが招待されているかを試せる。
-- ------------------------------------------------------------
alter table public.invites enable row level security;

drop policy if exists "owner writes invites" on public.invites;
drop policy if exists "owner or invitee reads" on public.invites;

create policy "owner or invitee reads" on public.invites
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

create policy "owner writes invites" on public.invites
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ============================================================
-- 招待を受け取る
--
--   **ここだけ `security definer` である。** 理由を書いておく ――
--   AC-78 が `grants` への書き込みを `owner_id = auth.uid()` に限るので、
--   **客は自分の付与を作れない。** 受諾は客の操作なので、関数の中でだけ
--   権限を上げる。
--
--   **上げた権限で何ができるかを狭める。** 作れるのは
--   「自分のアドレスに宛てて、持ち主が出した、まだ受諾していない招待」に
--   対応する1行だけである。招待の id を当てても、アドレスが一致しなければ
--   何も起きない。
--
--   直接の insert は依然として弾かれる ―― `pnpm loadtest:sharing` の
--   「客は grants を書けない」がそれを測る。
-- ============================================================
create or replace function public.accept_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invites;
  me uuid := (select auth.uid());
  my_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  if me is null or my_email = '' then
    raise exception 'サインインしていません';
  end if;

  select * into inv
    from public.invites
   where id = invite_id
     and accepted_at is null
     and lower(email) = my_email;

  if not found then
    -- **理由を分けない。** 「招待が無い」と「自分宛でない」を分けると、
    -- 招待の id を総当たりして存在を試せる
    raise exception '受け取れる招待がありません';
  end if;

  if inv.owner_id = me then
    raise exception '自分の招待は受け取れません';
  end if;

  insert into public.grants (owner_id, grantee_id, level)
       values (inv.owner_id, me, inv.level)
  on conflict (owner_id, grantee_id)
    do update set level = excluded.level, updated_at = now();

  update public.invites set accepted_at = now() where id = inv.id;
end;
$$;

revoke execute on function public.accept_invite(uuid) from public;
grant execute on function public.accept_invite(uuid) to authenticated;

comment on function public.accept_invite(uuid) is
  '自分のアドレスに向いた招待を受け取り、grants を1行作る（AC-79）。'
  '　security definer。AC-78 により客は grants を直接書けないため。';

-- ============================================================
-- 適用後の確認
--
--   **数える。** 7表 × 4本 = 28本。1表でも張り替えに失敗すると、
--   そこだけ共有が効かない（または古い `own rows` が残って全部通る）。
-- ============================================================
do $$
declare
  t text;
  shared text[] := array[
    'settings', 'accounts', 'recurring_items',
    'oneoff_items', 'actuals', 'overrides', 'import_rules'
  ];
  n int;
  leftovers int;
  total int := 0;
begin
  foreach t in array shared loop
    select count(*) into n
      from pg_policy where polrelid = ('public.' || t)::regclass;
    if n <> 4 then
      raise exception '% のポリシーが4本ではない（%本）', t, n;
    end if;
    total := total + n;

    select count(*) into leftovers
      from pg_policy
     where polrelid = ('public.' || t)::regclass
       and polname = 'own rows';
    if leftovers > 0 then
      raise exception '% に古い own rows が残っている（共有の分岐を通らない）', t;
    end if;
  end loop;

  if total <> 28 then
    raise exception 'ポリシーの合計が28本でない（%本）', total;
  end if;

  -- grants と invites にも RLS があること
  foreach t in array array['grants', 'invites'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '% の RLS が有効でない', t;
    end if;
    select count(*) into n from pg_policy where polrelid = ('public.' || t)::regclass;
    if n <> 2 then
      raise exception '% のポリシーが2本ではない（%本）', t, n;
    end if;
  end loop;

  -- **AC-80 を列の設計で確かめる。** grants から actuals への外部キーが
  -- 1本でもあれば、失効で実績が消える経路ができている
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.grants'::regclass
     and contype = 'f'
     and confrelid = 'public.actuals'::regclass;
  if n > 0 then
    raise exception 'grants が actuals を参照している（失効で実績が消える。AC-80）';
  end if;

  -- usage_events に手を付けていないこと（共有の対象外）
  select count(*) into n
    from pg_policy where polrelid = 'public.usage_events'::regclass;
  if n <> 1 then
    raise exception 'usage_events のポリシーが変わっている（%本）。共有の対象外のはず', n;
  end if;
end $$;
