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
-- │ 3. 下の LOAD_USER_ID を、その id に差し替える（1箇所だけ）      │
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
  if load_user_id = '00000000-0000-0000-0000-000000000000' then
    raise exception 'load_user_id を差し替えてください';
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

-- 1ヶ月あたりの件数。FR-42 のページング（200件）と FR-47 の分割取得
-- （1,000件）の両方を超えることを確かめる。
select
  to_char(date, 'YYYY-MM') as 年月,
  count(*)                 as 件数
from public.actuals
group by 1
order by 2 desc
limit 5;
