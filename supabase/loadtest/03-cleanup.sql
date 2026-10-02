-- ============================================================
-- 3. 行を消す（アカウントは消さない）
--
-- **このファイルは全部を選択してコピーし、Supabase の SQL Editor に
-- 貼って実行する。** 中から一部を切り出す必要はない。
--
-- 使い方・注意・順番は supabase/loadtest/README.md
-- ============================================================

-- **行を先に消してから、アカウントを消すこと。**
--
-- accounts / actuals などは on delete cascade なのでアカウント削除だけでも
-- 消えるが、**行数が多いと cascade delete が1トランザクションで走って
-- タイムアウトしうる。** 途中で失敗すると中途半端な状態が残り、原因が
-- 分かりにくくなる。先に行を消しておけば、アカウント削除は軽い操作になる。
--
-- LOAD_USER_ID は投入時と同じものに差し替える。

do $$
declare
  load_user_id uuid := '00000000-0000-0000-0000-000000000000';
  removed integer;
  -- 上の id のメールアドレス。ガードが使う
  target_email text;

  -- 作る実績の件数。**v1.0 の目標値が 3,000（§5.1）**
  row_total integer := 3000;

  -- 何日ぶんに散らすか。3,000件なら約1.5年分という §5.1 の前提に合わせる。
  -- 件数を変えてもここは変えない。1日あたりの件数のほうが変わる
  span_days integer := 550;
begin
  -- **差し替え漏れの番人。** 未置換のゼロUUIDも、打ち間違えた id も、
  -- どちらもここで止まる。**プレースホルダの値と比べない。** 比べると、
  -- 一括置換したときに番人自身も書き換わって必ず落ちるようになる
  -- （CLAUDE.md §2.8）。
  if not exists (select 1 from auth.users where id = load_user_id) then
    raise exception 'load_user_id が auth.users に見つかりません: %', load_user_id;
  end if;

  -- **取り違えの番人。** 実在する id であることだけでは足りない。実データの
  -- 入ったアカウントの id も実在するからである。**負荷試験用のアカウントで
  -- あることをメールアドレスで確かめる**（冒頭の枠を参照）。
  select email into target_email from auth.users where id = load_user_id;
  if target_email is null or position('+loadtest' in target_email) = 0 then
    raise exception '負荷試験用アカウントではありません: %', coalesce(target_email, '(見つからない)');
  end if;

  -- 1万行ずつ消す。件数が多いときに1トランザクションで消すのを避ける
  loop
    delete from public.actuals
    where id in (
      select id from public.actuals
      where user_id = load_user_id
      limit 10000
    );
    get diagnostics removed = row_count;
    raise notice '% 行削除', removed;
    exit when removed = 0;
  end loop;

  delete from public.oneoff_items   where user_id = load_user_id;
  delete from public.recurring_items where user_id = load_user_id;
  delete from public.overrides      where user_id = load_user_id;
  delete from public.accounts       where user_id = load_user_id;
  delete from public.settings       where user_id = load_user_id;
  -- usage_events はイベント記録。ここでは消さず、アカウント削除の cascade に任せる
end $$;
