-- カードの未払を2つに分ける（CL-2 手順4、AC-36）
--
-- 一次情報：docs/要件定義書.md §3.2 Account、§3.3 CL-2 手順4
--
-- 締め翌月払いのカードでは、基準日時点で未払の束が2つ同時に存在する。
-- 月末締め・翌月27日払いで基準日が 9/17 なら、8月利用分（締め済み・9/27
-- 引落）と 9/1〜9/16 利用分（未締め・10/27 引落）である。
--
-- 従来は単一の balance を両方まとめて最初の引落日に載せており、最大1ヶ月
-- ぶんの支出を前倒しで計上していた。近い将来の残高が実際より低く出るため、
-- 防衛ラインの警告が誤って鳴る。
--
-- balance の意味が「未払残高の全額」から「次回の引落額」に狭まる。
-- **既存値を2つに分割するデータ移行は行わない。** 分割の根拠となる情報が
-- どこにも無いためである（詳細は docs/adr/0017）。既定値0で追加し、
-- 利用者に入れ直してもらう。

alter table public.accounts
  add column if not exists unbilled_balance bigint not null default 0;

comment on column public.accounts.balance is
  '基準日時点の残高。card の場合は「次回の引落額」（確定済み請求額）';

comment on column public.accounts.unbilled_balance is
  'card のみ。次回の引落に含まれない未確定の利用額。その次の引落日に計上する';
