-- ============================================================
-- 0003 rls_guard を外から読めなくする
--
-- 0002 で作った public.rls_guard は PostgREST 経由で公開されていた。
-- 参照しているのは pg_class / pg_policy というカタログで、これらは
-- 匿名ロールからも読める。つまり**未サインインの相手に「どのテーブルの
-- RLS が漏れているか」を教えてしまう。** 攻撃者にとっては下見になる。
--
-- 使わない権限は与えない。集計と点検はダッシュボードの SQL Editor から
-- secret 権限で行う。
-- ============================================================

revoke all on public.rls_guard from anon;
revoke all on public.rls_guard from authenticated;

comment on view public.rls_guard is
  'RLS が無効、またはポリシーの無い public のテーブル。1行でも返したら事故の可能性がある。'
  '　anon / authenticated からは読めない。SQL Editor から secret 権限で見ること。';
