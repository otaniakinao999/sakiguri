-- 負荷試験用データ投入（AC-28 / AC-34）
--
-- 実績10万件を1ユーザーに作る。§5.1「1ユーザーあたり実績10万件まで劣化
-- しないこと」と、FR-47 の分割取得が実サーバーで正しく効くことを測るため。
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ 使い方                                                         │
-- │                                                                │
-- │ 1. 負荷試験用のアカウントを作る（アプリでサインアップ）         │
-- │ 2. その id を調べる                                            │
-- │      select id, email from auth.users order by created_at desc;│
-- │ 3. 下の load_user_id を、その id に差し替える                   │
-- │    **3箇所ある**（投入の DO ブロック／後片付けの DO ブロック／  │
-- │    最後の確認クエリ）。確認クエリは2行に書いてあるので計4箇所   │
-- │ 4. Supabase ダッシュボードの SQL Editor に貼って実行する        │
-- │ 5. 測り終わったらアカウントごと削除する。actuals も             │
-- │    usage_events も on delete cascade で一緒に消える             │
-- └──────────────────────────────────────────────────────────────┘
--
-- **検証用アカウントには入れないこと。** PoC の指標（csv_imported の
-- matched / rows 比）に負荷試験ぶんが混ざると読めなくなる。
--
-- UI を通さず直接 insert するので usage_events は発生しない。アプリ側に
-- 試験用のフラグを足さずに済ませるための方法である。
--
-- psql のメタコマンド（\set）は SQL Editor で使えないため、DO ブロックの
-- 中で変数を宣言している。

do $$
declare
  -- ここだけ差し替える ----------------------------------------------------
  load_user_id uuid := '00000000-0000-0000-0000-000000000000';
  -- ------------------------------------------------------------------------

  -- 基準日。**投入する日付はすべてこの日以降にする。**
  -- FR-47 が実績を基準日以降に絞るため、これより前に入れると読み込み対象が
  -- 0件になり、テストが自明に通ってしまう。
  as_of date := '2026-01-01';

  seikatsu uuid := '11111111-1111-4111-8111-111111111111';
  jigyou   uuid := '22222222-2222-4222-8222-222222222222';
  card     uuid := '33333333-3333-4333-8333-333333333333';
begin
  -- **差し替え漏れの番人。** 未置換のゼロUUIDも、打ち間違えた id も、
  -- どちらもここで止まる。**プレースホルダの値と比べない。** 比べると、
  -- 一括置換したときに番人自身も書き換わって必ず落ちるようになる
  -- （CLAUDE.md §2.8）。
  if not exists (select 1 from auth.users where id = load_user_id) then
    raise exception 'load_user_id が auth.users に見つかりません: %', load_user_id;
  end if;

  -- 設定。基準日と生活防衛ライン
  insert into public.settings (user_id, as_of, reserve_line)
  values (load_user_id, as_of, 600000)
  on conflict (user_id) do update
    set as_of = excluded.as_of, reserve_line = excluded.reserve_line;

  -- 口座2つとカード1枚。カードを入れるのは CL-2 の引落ラグを負荷に含めるため
  insert into public.accounts
    (id, user_id, name, kind, balance,
     closing_day, pay_month_offset, pay_day, settle_account_id)
  values
    (seikatsu, load_user_id, '生活口座',     'bank', 1500000, null, null, null, null),
    (jigyou,   load_user_id, '事業口座',     'bank',  800000, null, null, null, null),
    (card,     load_user_id, 'メインカード', 'card',  142000,   15,    1,   10, seikatsu)
  on conflict (id) do nothing;

  -- **前回の負荷試験の残りを踏まない。** 口座の id は固定値なので、
  -- 同じ id の行が別の利用者に残っていると `on conflict do nothing` が
  -- 黙って飛ばし、10万件が他人の口座を指したまま入る。
  if (
    select count(*) from public.accounts
    where id in (seikatsu, jigyou, card) and user_id = load_user_id
  ) <> 3 then
    raise exception
      '口座 id が別の利用者に使われています。前回の負荷試験の行を消してから実行してください';
  end if;

  -- 定期項目50件 --------------------------------------------------------------
  --
  -- **実績だけ入れても測りたい経路を通らない。** 予定インスタンスが0件だと
  -- CL-1 の展開も、FR-46 の候補照合（実績 × 未消込予定）も、FR-43 の
  -- 未消し込み件数も空振りする。§5.1 の目標値も「定期項目50件」込みで
  -- 書かれているので、無いと測っている対象が違う。
  --
  -- 50件 × 24ヶ月（FORECAST_HORIZON_MONTHS）で予定インスタンスは約1,200件。
  -- 実績10万件がすべて `plan_key = null`（未判定）なので、候補照合は
  -- 10万 × 1,200 の総当たりになる。**ここが一番重い。**
  --
  -- id は決定的に作る。`gen_random_uuid()` だと再実行で重複して増える。
  insert into public.recurring_items
    (id, user_id, name, type, cost_type, category_code, amount, biz_ratio,
     account_id, to_account_id, day, months, active)
  select
    ('44444444-4444-4444-8444-' || lpad(i::text, 12, '0'))::uuid,
    load_user_id,
    '負荷試験 定期 ' || i,
    case when i % 10 = 0 then 'income' else 'expense' end,
    case
      when i % 10 = 0 then null            -- 収入は cost_type を持たない
      when i % 3 = 0  then 'fixed'
      else 'variable'
    end,
    case
      when i % 10 = 0 then 'INC-01'        -- 事業売上
      when i % 3 = 0  then 'EXP-01'        -- 地代家賃・住居費（固定）
      when i % 7 = 0  then 'EXP-03'        -- 通信費
      when i % 5 = 0  then 'EXP-02'        -- 水道光熱費
      else 'EXP-21'                        -- 食費（変動）
    end,
    case when i % 10 = 0 then 400000 + i * 1000 else 3000 + i * 700 end,
    case when i % 4 = 0 then 100 when i % 6 = 0 then 40 else 0 end,
    -- 4件はカード払い。CL-2 の引落ラグを予定側でも通す
    case
      when i % 11 = 0 then card
      when i % 4  = 0 then jigyou
      else seikatsu
    end,
    null,
    -- 発生日は 1〜28 に散らし、4件だけ 31（月末の丸めを通す。CL-1）
    case when i % 12 = 0 then 31 else 1 + (i % 28) end,
    -- 2件だけ対象月を絞る（住民税のような年数回の項目。CL-1 の months 分岐）
    case when i % 17 = 0 then array[1, 6, 8, 10]::smallint[] else null end,
    -- 2件は停止。active の絞り込みを通す
    i % 20 <> 0
  from generate_series(1, 50) as i
  on conflict (id) do nothing;

  -- 単発予定40件 --------------------------------------------------------------
  --
  -- CL-1 は定期項目と単発予定で経路が分かれる。両方を通す。
  -- 17日おきに置いて、24ヶ月の予測期間の全体に散らす。
  insert into public.oneoff_items
    (id, user_id, date, name, type, cost_type, category_code, amount,
     biz_ratio, account_id, to_account_id)
  select
    ('55555555-5555-4555-8555-' || lpad(i::text, 12, '0'))::uuid,
    load_user_id,
    as_of + (i * 17),
    '負荷試験 単発 ' || i,
    case when i % 8 = 0 then 'income' else 'expense' end,
    case
      when i % 8 = 0 then null
      when i % 3 = 0 then 'fixed'
      else 'variable'
    end,
    case
      when i % 8 = 0 then 'INC-02'         -- 雑収入
      when i % 3 = 0 then 'EXP-14'         -- 租税公課（固定）
      when i % 5 = 0 then 'EXP-07'         -- 消耗品費
      else 'EXP-04'                        -- 旅費交通費
    end,
    12000 + i * 1300,
    case when i % 3 = 0 then 100 else 0 end,
    case when i % 9 = 0 then card else seikatsu end,
    null
  from generate_series(1, 40) as i
  on conflict (id) do nothing;

  -- 実績10万件 --------------------------------------------------------------
  --
  -- 基準日から1,000日ぶんに散らす（2026-01-01 〜 2028-09-26）。1日あたり
  -- 100件。月あたり約3,000件になり、FR-42 の月内ページング（200件）も
  -- FR-47 の分割取得（1,000件）も両方通る。
  --
  -- 費目は §3.1.2 の実在するコードだけを使う。存在しないコードを入れると
  -- categoryOf が落ちる。
  insert into public.actuals
    (id, user_id, plan_key, date, name, type, cost_type,
     category_code, amount, biz_ratio, account_id, to_account_id)
  select
    gen_random_uuid(),
    load_user_id,
    null,                                  -- 消し込みなし（突発扱い）
    as_of + (i / 100),                     -- 100件ごとに1日進む
    '負荷試験 ' || i,
    case when i % 20 = 0 then 'income' else 'expense' end,
    case
      when i % 20 = 0 then null            -- 収入は cost_type を持たない
      when i % 5 = 0  then 'fixed'
      else 'variable'
    end,
    case
      when i % 20 = 0 then 'INC-01'        -- 事業売上
      when i % 5 = 0  then 'EXP-01'        -- 地代家賃・住居費（固定）
      when i % 7 = 0  then 'EXP-02'        -- 水道光熱費
      when i % 11 = 0 then 'EXP-03'        -- 通信費
      else 'EXP-21'                        -- 食費（変動）
    end,
    case
      when i % 20 = 0 then 300000 + (i % 50) * 1000
      else 500 + (i % 9000)
    end,
    case when i % 3 = 0 then 100 else 0 end,
    case
      -- 3件に1件はカード払い。CL-2 の引落ラグを通す
      when i % 3 = 1 then card
      when i % 3 = 2 then jigyou
      else seikatsu
    end,
    null
  from generate_series(0, 99999) as i;
end $$;

-- 確認 -----------------------------------------------------------------------
-- 件数が100,000でないなら投入が途中で止まっている。
-- 利用者ごとに出るので、負荷試験アカウントの行を見る。
select
  user_id,
  count(*)                                   as 件数,
  min(date)                                  as 最も古い日,
  max(date)                                  as 最も新しい日,
  count(*) filter (
    where account_id = '33333333-3333-4333-8333-333333333333'
  )                                          as カード払い,
  count(distinct to_char(date, 'YYYY-MM'))   as 月数
from public.actuals
group by user_id
order by 件数 desc;

-- 予定側。定期項目50件・単発予定40件が入っていること。
-- **0件のまま測ると、候補照合も未消し込み件数も空振りする。**
select
  (select count(*) from public.recurring_items where user_id = '00000000-0000-0000-0000-000000000000') as 定期項目,
  (select count(*) filter (where active) from public.recurring_items where user_id = '00000000-0000-0000-0000-000000000000') as うち有効,
  (select count(*) from public.oneoff_items    where user_id = '00000000-0000-0000-0000-000000000000') as 単発予定;

-- 1ヶ月あたりの件数。FR-42 のページング（200件）と FR-47 の分割取得
-- （1,000件）の両方を超えることを確かめる。
select
  to_char(date, 'YYYY-MM') as 年月,
  count(*)                 as 件数
from public.actuals
group by 1
order by 2 desc
limit 5;

-- 後片付け -------------------------------------------------------------------
--
-- **行を先に消してから、アカウントを消すこと。**
--
-- accounts / actuals などは on delete cascade なのでアカウント削除だけでも
-- 消えるが、**10万行の cascade delete が1トランザクションで走るため
-- タイムアウトしうる。** 途中で失敗すると中途半端な状態が残り、原因が
-- 分かりにくくなる。先に行を消しておけば、アカウント削除は軽い操作になる。
--
-- LOAD_USER_ID は投入時と同じものに差し替える。

do $$
declare
  load_user_id uuid := '00000000-0000-0000-0000-000000000000';
  removed integer;
begin
  -- **差し替え漏れの番人。** 未置換のゼロUUIDも、打ち間違えた id も、
  -- どちらもここで止まる。**プレースホルダの値と比べない。** 比べると、
  -- 一括置換したときに番人自身も書き換わって必ず落ちるようになる
  -- （CLAUDE.md §2.8）。
  if not exists (select 1 from auth.users where id = load_user_id) then
    raise exception 'load_user_id が auth.users に見つかりません: %', load_user_id;
  end if;

  -- 1万行ずつ消す。1トランザクションで10万行消してタイムアウトするのを避ける
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

-- 残っていないことを確認してから、ダッシュボードの
-- Authentication → Users でアカウントを削除する。
select
  (select count(*) from public.actuals  where user_id = '00000000-0000-0000-0000-000000000000') as 実績,
  (select count(*) from public.accounts where user_id = '00000000-0000-0000-0000-000000000000') as 口座;
