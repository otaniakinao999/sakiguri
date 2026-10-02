-- ============================================================
-- 4. 消えたことを確かめる
--
-- **このファイルは全部を選択してコピーし、Supabase の SQL Editor に
-- 貼って実行する。** 中から一部を切り出す必要はない。
--
-- 使い方・注意・順番は supabase/loadtest/README.md
-- ============================================================

-- 残っていないことを確認してから、ダッシュボードの
-- Authentication → Users でアカウントを削除する。
--
-- **`イベント残` 以外がすべて 0 であること。** usage_events は意図して
-- 残してあり、アカウント削除の cascade で消える。
--
-- **0 が「消えた」とは限らない。** load_user_id の差し替えが漏れていると、
-- 存在しない利用者を数えて 0 が返る。貼る前に `0000-0000` が残って
-- いないことを確かめる（README）。
--
-- **`03-cleanup.sql` で消したテーブルを全部数える。** 2つだけ確認して
-- 「0件だった」と読むと、消し忘れたテーブルが残ったままアカウントを
-- 消すことになる。消す側と数える側は同じ集合でなければならない
-- （CLAUDE.md §2.8）。usage_events は意図して残し、cascade に任せる。
select
  (select count(*) from public.actuals        where user_id = '00000000-0000-0000-0000-000000000000') as 実績,
  (select count(*) from public.oneoff_items   where user_id = '00000000-0000-0000-0000-000000000000') as 単発予定,
  (select count(*) from public.recurring_items where user_id = '00000000-0000-0000-0000-000000000000') as 定期項目,
  (select count(*) from public.overrides      where user_id = '00000000-0000-0000-0000-000000000000') as 変更,
  (select count(*) from public.accounts       where user_id = '00000000-0000-0000-0000-000000000000') as 口座,
  (select count(*) from public.settings       where user_id = '00000000-0000-0000-0000-000000000000') as 設定,
  (select count(*) from public.usage_events   where user_id = '00000000-0000-0000-0000-000000000000') as イベント残;
