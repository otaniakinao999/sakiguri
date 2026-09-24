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


-- ============================================================
-- 追加の観測（PoC の5指標の外）
--
-- 途中で追加した機能の当たり外れを見る。5指標のように成否を決める値では
-- なく、閾値と条件を調整するための材料である。
-- ============================================================

-- ------------------------------------------------------------
-- OI-20：消し込み間隔の分布
--
-- FR-43 の閾値（45日／60日）は BS-2 の「CSV取込は月1〜2回」から机上で
-- 置いた値である。実際の間隔を見て調整する。
--
-- 読み方：45日のところに山があるなら、警告が正常な運用を踏んでいる。
-- 上位のパーセンタイルが45日より十分に小さければ、閾値は妥当。
-- ------------------------------------------------------------
with reconciles as (
  select
    user_id,
    occurred_at::date as 実施日,
    lag(occurred_at::date) over (
      partition by user_id order by occurred_at
    ) as 前回
  from public.usage_events
  -- 消し込み操作とみなすもの。CSV取込は照合0件でも数える
  where event in ('actual_recorded', 'csv_imported')
),
gaps as (
  select user_id, 実施日 - 前回 as 間隔日数
  from reconciles
  where 前回 is not null
)
select
  count(*)                                                as 回数,
  count(distinct user_id)                                 as 人数,
  round(avg(間隔日数))                                     as 平均,
  percentile_cont(0.5)  within group (order by 間隔日数)   as 中央値,
  percentile_cont(0.75) within group (order by 間隔日数)   as p75,
  percentile_cont(0.90) within group (order by 間隔日数)   as p90,
  max(間隔日数)                                            as 最大,
  count(*) filter (where 間隔日数 >= 45)                   as "45日以上",
  round(
    100.0 * count(*) filter (where 間隔日数 >= 45) / nullif(count(*), 0)
  )                                                        as "45日以上の割合%"
from gaps;

-- 間隔の分布を10日刻みで見る。45日の手前に山があるかを確かめる
with reconciles as (
  select
    user_id,
    occurred_at::date as 実施日,
    lag(occurred_at::date) over (
      partition by user_id order by occurred_at
    ) as 前回
  from public.usage_events
  where event in ('actual_recorded', 'csv_imported')
)
select
  (( 実施日 - 前回 ) / 10) * 10 || '〜' || ((( 実施日 - 前回 ) / 10) * 10 + 9) || '日'
    as 間隔,
  count(*) as 回数
from reconciles
where 前回 is not null
group by ( 実施日 - 前回 ) / 10
order by ( 実施日 - 前回 ) / 10;

-- ------------------------------------------------------------
-- FR-46：候補提示が当たっているか
--
-- 候補から行った操作のうち、確定した割合と「予定にない支出」として
-- 却下した割合を見る。
--
-- 読み方：却下が大半なら CL-7 の条件（同額・日付±12日以内・同一口座）が
-- 緩すぎる。候補が邪魔をしているだけということになる。
-- ------------------------------------------------------------
select
  count(*)                                                    as 候補からの操作,
  count(*) filter (where (props ->> 'unplanned')::boolean)    as 却下,
  count(*) filter (where not (props ->> 'unplanned')::boolean) as 確定,
  round(
    100.0 * count(*) filter (where not (props ->> 'unplanned')::boolean)
    / nullif(count(*), 0)
  )                                                            as "確定率%"
from public.usage_events
where event = 'actual_recorded'
  and (props ->> 'fromCandidate')::boolean;

-- 利用者ごと。特定の1人だけが却下を連発しているのか、全体の傾向かを見る
select
  user_id,
  count(*)                                                     as 候補からの操作,
  count(*) filter (where not (props ->> 'unplanned')::boolean) as 確定
from public.usage_events
where event = 'actual_recorded'
  and (props ->> 'fromCandidate')::boolean
group by user_id
order by 候補からの操作 desc;

-- ------------------------------------------------------------
-- FR-47：読み込みの切り捨てが起きていないか
--
-- load_incomplete は分割取得のバグを検知するカナリアであり、
-- **1件でも出たら実装の不具合である。** 0件であることを確かめる。
-- ------------------------------------------------------------
select
  count(*)                              as 発生件数,
  count(distinct user_id)               as 影響した人数,
  max((props ->> 'expected')::int)      as 最大の総件数,
  max((props ->> 'received')::int)      as 最大の受信件数
from public.usage_events
where event = 'load_incomplete';
