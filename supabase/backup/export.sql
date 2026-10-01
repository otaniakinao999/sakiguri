-- ============================================================
-- 手動バックアップ（書き出しと復元）
--
-- 一次情報：docs/要件定義書.md §5.2「日次でバックアップし7日分を保持する」
--
-- **これは §5.2 を満たすものではない。** §5.2 は自動の日次バックアップで
-- あり、これは手で動かす代替である。Supabase の自動バックアップが有効に
-- なるまでのあいだ、実データを失わないための最低限の手段として置く。
-- 有効かどうかの確認方法は docs/バックアップの状況.md に書いた。
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ 使い方（書き出し）                                             │
-- │                                                                │
-- │ 1. Supabase ダッシュボード → SQL Editor                        │
-- │ 2. 下の「A. 書き出し」のクエリを貼って実行                     │
-- │ 3. 結果の1行1列をコピーして、日付入りのファイル名で保存する    │
-- │      sakiguri-backup-2026-10-01.json                           │
-- │ 4. そのファイルを**この端末の外にも1つ置く**                   │
-- │    （端末が壊れるとバックアップごと失う）                      │
-- └──────────────────────────────────────────────────────────────┘
--
-- **このファイルは利用者を絞らずに全行を書き出す。** SQL Editor は
-- サービスロールで動くので RLS を通らない。いまは利用者が開発者自身
-- だけなので問題にならないが、**モニターに配布したあとは、全員の資金
-- 繰りデータが1つのファイルに入ることになる。** その時点で、利用者を
-- 絞る形（下のコメント）に変えるか、自動バックアップに切り替える。
--
-- 復元できないもの：
--   - `auth.users` の行（アカウントそのもの）
--   - `usage_events`（指標の記録。失っても資金繰りデータは復元できる）
-- ============================================================


-- ============================================================
-- A. 書き出し
--
-- 1行1列の JSON が返る。そのセルをコピーして保存する。
-- ============================================================

select jsonb_pretty(
  jsonb_build_object(
    'exported_at', now(),
    -- 復元時に、どのマイグレーションまで当たった状態の形かを見る
    'schema', '0007',
    'settings', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb)
      from public.settings t
      -- 利用者を絞るときはここを有効にする
      -- where t.user_id = '00000000-0000-0000-0000-000000000000'
    ),
    'accounts', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
      from public.accounts t
    ),
    'recurring_items', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
      from public.recurring_items t
    ),
    'oneoff_items', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
      from public.oneoff_items t
    ),
    'actuals', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
      from public.actuals t
    ),
    'overrides', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.plan_key), '[]'::jsonb)
      from public.overrides t
    )
  )
) as backup;


-- ============================================================
-- B. 書き出したものの件数を確かめる
--
-- A をコピーし損ねていないかを見る。**A の直後に実行して、
-- 保存したファイルの中の件数と突き合わせる。**
-- ============================================================

select
  (select count(*) from public.settings)        as 設定,
  (select count(*) from public.accounts)        as 口座,
  (select count(*) from public.recurring_items) as 定期項目,
  (select count(*) from public.oneoff_items)    as 単発予定,
  (select count(*) from public.actuals)         as 実績,
  (select count(*) from public.overrides)       as 変更;


-- ============================================================
-- C. 復元
--
-- **先に読むこと。**
--
-- 1. この復元は `auth.users` を戻さない。**アカウントが残っている場合
--    （行だけ消えた、テーブルを壊した）はそのまま使える。**
--
-- 2. プロジェクトごと失った場合は、先にアカウントを作り直す。**新しい
--    アカウントの uuid は元と違う。** 保存した JSON の中の古い uuid を
--    新しいものに全置換してから復元する（エディタの置換で足りる）。
--    `user_id` のほか、`settle_account_id` などの口座 id は変えない。
--
-- 3. **復元の前に、いまの状態をもう一度 A で書き出す。** 復元で上書き
--    される側が消える。消していいと分かっていても書き出す。
--
-- 手順
--   1. 下の `$backup$` と `$backup$` のあいだに、保存した JSON を貼る
--   2. 全体を選択して実行する
--   3. 最後に出る件数が、保存したファイルの件数と一致することを見る
-- ============================================================

begin;

create temporary table _restore (doc jsonb) on commit drop;

insert into _restore (doc) values (
$backup$
ここに保存した JSON を貼る
$backup$::jsonb
);

-- 既にある行は触らない（`do nothing`）。**上書きしたい場合は、先に
-- 対象の行を消してから実行する。** 黙って上書きすると、復元したつもりで
-- 新しいほうを消すことになる。

insert into public.settings
select * from jsonb_populate_recordset(
  null::public.settings, (select doc -> 'settings' from _restore))
on conflict (user_id) do nothing;

insert into public.accounts
select * from jsonb_populate_recordset(
  null::public.accounts, (select doc -> 'accounts' from _restore))
on conflict (id) do nothing;

insert into public.recurring_items
select * from jsonb_populate_recordset(
  null::public.recurring_items, (select doc -> 'recurring_items' from _restore))
on conflict (id) do nothing;

insert into public.oneoff_items
select * from jsonb_populate_recordset(
  null::public.oneoff_items, (select doc -> 'oneoff_items' from _restore))
on conflict (id) do nothing;

insert into public.actuals
select * from jsonb_populate_recordset(
  null::public.actuals, (select doc -> 'actuals' from _restore))
on conflict (id) do nothing;

insert into public.overrides
select * from jsonb_populate_recordset(
  null::public.overrides, (select doc -> 'overrides' from _restore))
on conflict (user_id, plan_key) do nothing;

-- 入った件数と、ファイルの中の件数を並べる。**一致しなければ commit しない**
select
  (select count(*) from public.actuals)                                   as 実績_DB,
  (select jsonb_array_length(doc -> 'actuals') from _restore)             as 実績_ファイル,
  (select count(*) from public.recurring_items)                           as 定期項目_DB,
  (select jsonb_array_length(doc -> 'recurring_items') from _restore)     as 定期項目_ファイル,
  (select count(*) from public.oneoff_items)                              as 単発予定_DB,
  (select jsonb_array_length(doc -> 'oneoff_items') from _restore)        as 単発予定_ファイル,
  (select count(*) from public.accounts)                                  as 口座_DB,
  (select jsonb_array_length(doc -> 'accounts') from _restore)            as 口座_ファイル,
  (select count(*) from public.overrides)                                 as 変更_DB,
  (select jsonb_array_length(doc -> 'overrides') from _restore)           as 変更_ファイル;

-- 件数を見てから、どちらかを実行する
--   commit;     -- 一致していた
--   rollback;   -- 一致しなかった。何も変わらない
