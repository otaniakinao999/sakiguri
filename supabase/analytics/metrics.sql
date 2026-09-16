-- ============================================================
-- PoC で取る指標
--
-- 一次情報：docs/PoC開発計画.md §4「PoCで取る指標」
--
-- **ダッシュボードの SQL Editor から secret 権限で実行する。**
-- アプリからは読めない（usage_events に select のポリシーが無い）。
-- secret キーはアプリにも CI にも置かない。
--
-- マイグレーションではない。必要なときに手で流す。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 初回30日以内の2回目CSV取込率
--
-- 「月に一度のCSV取込が続かないこと」が最大の離脱要因という仮定
--（PoC開発計画 §1）。ここが測れないとモデルの解約率が検証できない。
-- ------------------------------------------------------------
with first_import as (
  select user_id, min(occurred_at) as first_at
  from public.usage_events
  where event = 'csv_imported'
  group by user_id
),
second_import as (
  select f.user_id
  from first_import f
  join public.usage_events e
    on e.user_id = f.user_id
   and e.event = 'csv_imported'
   and e.occurred_at > f.first_at
   and e.occurred_at <= f.first_at + interval '30 days'
  group by f.user_id
)
select
  count(*) filter (where s.user_id is not null) as 二回目あり,
  count(*)                                     as 初回取込したユーザー,
  round(
    100.0 * count(*) filter (where s.user_id is not null) / nullif(count(*), 0),
    1
  ) as 率
from first_import f
left join second_import s on s.user_id = f.user_id;


-- ------------------------------------------------------------
-- 2. 登録後14日時点の予定登録件数（中央値）
--
-- イベントではなく予定テーブルのスナップショット。
-- 登録から14日を過ぎたユーザーだけを見る。
-- ------------------------------------------------------------
with eligible as (
  select id as user_id, created_at
  from auth.users
  where created_at <= now() - interval '14 days'
),
counts as (
  select
    e.user_id,
    (
      select count(*) from public.recurring_items r
      where r.user_id = e.user_id and r.created_at <= e.created_at + interval '14 days'
    ) + (
      select count(*) from public.oneoff_items o
      where o.user_id = e.user_id and o.created_at <= e.created_at + interval '14 days'
    ) as plans
  from eligible e
)
select
  count(*) as 対象ユーザー,
  percentile_cont(0.5) within group (order by plans) as 中央値,
  min(plans) as 最小,
  max(plans) as 最大
from counts;


-- ------------------------------------------------------------
-- 3. 3ヶ月以上先まで予定があるユーザーの比率（北極星指標）
--
-- forecast_horizon イベントの、ユーザーごとの直近の値を見る。
-- ------------------------------------------------------------
with latest as (
  select distinct on (user_id)
    user_id,
    (props->>'months')::int as months
  from public.usage_events
  where event = 'forecast_horizon'
  order by user_id, occurred_at desc
)
select
  count(*) filter (where months >= 3) as 三ヶ月以上,
  count(*)                            as 分母,
  round(100.0 * count(*) filter (where months >= 3) / nullif(count(*), 0), 1) as 率
from latest;


-- ------------------------------------------------------------
-- 4. 残高警告からの操作率
--
-- 警告を見せたあと、30分以内に繰延・実績記録のいずれかをしたか。
-- ------------------------------------------------------------
with warned as (
  select user_id, occurred_at
  from public.usage_events
  where event = 'shortfall_warned'
),
acted as (
  select w.user_id, w.occurred_at
  from warned w
  where exists (
    select 1 from public.usage_events a
    where a.user_id = w.user_id
      and a.event in ('plan_deferred', 'actual_recorded')
      and a.occurred_at > w.occurred_at
      and a.occurred_at <= w.occurred_at + interval '30 minutes'
  )
)
select
  (select count(*) from acted)  as 操作あり,
  (select count(*) from warned) as 警告の回数,
  round(
    100.0 * (select count(*) from acted) / nullif((select count(*) from warned), 0),
    1
  ) as 率;


-- ------------------------------------------------------------
-- 5. 週あたりのログイン日数
--
-- signed_in の、ユーザー・週ごとの「日付の種類数」。
-- ------------------------------------------------------------
select
  date_trunc('week', occurred_at)::date as 週,
  count(distinct user_id)               as 利用者,
  round(
    avg(days) over (partition by date_trunc('week', occurred_at)),
    2
  ) as 平均ログイン日数
from (
  select
    user_id,
    date_trunc('week', occurred_at) as occurred_at,
    count(distinct occurred_at::date) as days
  from public.usage_events
  where event = 'signed_in'
  group by user_id, date_trunc('week', occurred_at)
) per_user
group by date_trunc('week', occurred_at), days
order by 週 desc;


-- ------------------------------------------------------------
-- 点検：イベントに入ってはいけない値が混ざっていないか
--
-- props に金額や名称が入っていないことを確かめる。
-- 1行でも返したら、どこかで ADR-0013 が破られている。
-- ------------------------------------------------------------
select
  event,
  key as 疑わしいキー,
  count(*) as 件数
from public.usage_events, jsonb_each(props) as kv(key, value)
where key in (
    'amount', 'balance', 'name', 'category', 'categoryCode', 'categoryName',
    'account', 'accountId', 'accountName', 'counterparty',
    'filename', 'fileName', 'date', 'ip', 'userAgent', 'email', 'note'
  )
  or jsonb_typeof(value) = 'string'  -- 自由入力の文字列を入れない約束
group by event, key
order by 件数 desc;
