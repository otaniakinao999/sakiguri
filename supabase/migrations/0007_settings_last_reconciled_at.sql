-- 最後に消し込み操作を行った日（FR-43、AC-29a）
--
-- 一次情報：docs/要件定義書.md §3.2 Settings
--
-- FR-43 の「消し込みが止まっている」警告のためだけに持つ。
--
-- 既存の項目では代用できない。
--   Actual.date       … 取引日であって操作日ではない（去年の取引を今日入力できる）
--   actuals.created_at … 「予定にない支出」の確定は既存行にフラグを立てる操作
--                        なので作成日時が動かず、処理した事実を拾えない
--
-- null は「一度も消し込んでいない」。起点には基準日を使う。null を「とても
-- 古い」と扱うと新規利用者が初日から警告を受ける（AC-29a）。
--
-- 適用の順序：このマイグレーションを適用してからコードをデプロイする
-- （CLAUDE.md §2.5.1、ADR-0018）。列の追加なので後方互換。

alter table public.settings
  add column if not exists last_reconciled_at date;

comment on column public.settings.last_reconciled_at is
  '最後に消し込み操作を行った日。FR-43 の警告のためだけに持つ。null は未実施';
