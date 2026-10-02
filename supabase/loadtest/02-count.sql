-- ============================================================
-- 2. 入ったことを確かめる（3本まとめて実行してよい）
--
-- **このファイルは全部を選択してコピーし、Supabase の SQL Editor に
-- 貼って実行する。** 中から一部を切り出す必要はない。
--
-- 使い方・注意・順番は supabase/loadtest/README.md
-- ============================================================

-- 件数が `row_total` と違うなら投入が途中で止まっている。
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
  (select count(*) filter (where type = 'transfer') from public.recurring_items where user_id = '00000000-0000-0000-0000-000000000000') as うち振替,
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
