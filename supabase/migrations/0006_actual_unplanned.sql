-- 実績に「予定に対応しない」の判定を持たせる（FR-46、AC-38）
--
-- 一次情報：docs/要件定義書.md §3.2 Actual、§4.1.1 SC-05
--
-- key が null であることには2つの意味が混ざっている。
--
--   「まだ判定していない」        → 消し込み候補を出す
--   「判定した結果、突発だった」  → 候補を出さない
--
-- 区別が無いと、利用者が何度「予定にない支出」を選んでも同じ候補が戻り、
-- 却下の操作が機能していないように見える。
--
-- **候補提示を抑止するためだけのフラグ。** CL-1〜CL-6 の計算には影響しない。
--
-- 適用の順序：このマイグレーションを適用してからコードをデプロイする
-- （CLAUDE.md §2.5.1、ADR-0018）。列の追加なので後方互換。

alter table public.actuals
  add column if not exists unplanned boolean not null default false;

comment on column public.actuals.unplanned is
  'key が null である理由が「予定に対応しないと利用者が確定した」ことであるか。既定 false（未判定）';
