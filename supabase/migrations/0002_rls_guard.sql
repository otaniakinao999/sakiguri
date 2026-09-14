-- ============================================================
-- 0002 RLS の漏れを検出する
--
-- 一次情報：CLAUDE.md §2.5、docs/PoC開発計画.md §5.4
--
-- 「Supabaseでテーブルを作ってRLSを有効化し忘れると、全ユーザーの
--  データが誰からでも読めます。AIはマイグレーションを書くとき RLS を
--  忘れがちです。テーブルが増えるほど確率が上がります。」
--
-- 目視に頼らず、検出できる形にしておく。
-- ============================================================

-- ------------------------------------------------------------
-- 危険なテーブルを列挙するビュー
--
-- 危険とみなすのは次のどちらか。
--   RLS が有効になっていない
--   RLS は有効だが、ポリシーが1つも無い（＝誰も読み書きできないか、
--   あるいは有効化し忘れと同じ意味で設定が未完成）
--
-- ここが1行でも返したら、その時点で事故の可能性がある。
-- ------------------------------------------------------------
create or replace view public.rls_guard
with (security_invoker = true)
as
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.polname) as policy_count,
  case
    when not c.relrowsecurity then 'RLS が無効'
    when count(p.polname) = 0 then 'ポリシーが無い'
  end as problem
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity
having not c.relrowsecurity or count(p.polname) = 0;

comment on view public.rls_guard is
  'RLS が無効、またはポリシーの無い public のテーブル。1行でも返したら事故の可能性がある。';

-- ------------------------------------------------------------
-- マイグレーション適用時に落とす
--
-- ビューを作るだけでは、誰かが見に行かない限り気づけない。
-- 適用のたびに検査し、漏れていればマイグレーションごと失敗させる。
-- ------------------------------------------------------------
do $$
declare
  offenders text;
begin
  select string_agg(table_name || '（' || problem || '）', '、' order by table_name)
  into offenders
  from public.rls_guard;

  if offenders is not null then
    raise exception
      'RLS が設定されていないテーブルがあります: %. CLAUDE.md §2.5 を参照してください。',
      offenders;
  end if;
end;
$$;
