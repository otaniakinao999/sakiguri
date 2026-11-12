-- ============================================================
-- 0009 実績に「取込時の摘要の原文」を持たせる（FR-58・AC-64）
--
-- 一次情報：docs/要件定義書.md §3.2 Actual、FR-58、AC-64、AC-65、AC-66
--
-- 重複判定（FR-50）は `name` を含む鍵で行っている。`name` は**表示名**で、
-- 実績編集で摘要を直すと保存されている名前がCSVの摘要と変わり、**その行は
-- 二度と「登録済み」にならない。** 仕分けルールで摘要を置き換える（FR-59）と、
-- ルールを作った行が全部そうなる。
--
-- そこで**取込時の摘要そのもの**を別に持ち、判定はこちらで行う。
--
--   source_name が null  → 原文を持たない。**表示名を原文として扱う**
--                          （既存データを壊さない。AC-64）
--   source_name がある   → 表示名を直しても判定は変わらない
--
-- **手入力の実績は null のままでよい。** CSVから来ていないので原文が無い。
--
-- 適用の順序：**このマイグレーションを適用してからコードをデプロイする**
-- （CLAUDE.md §2.5.1）。列の追加なので後方互換である。
--
-- **逆順にすると全員が画面を開けない。** 読み込み側は `source_name` を
-- 明示的に取りに行く（`src/lib/supabase/rows.ts` の `SELECT_COLUMNS`）ので、
-- 列が無ければ 42703 が返り、`loadAppData` の `Promise.all` の中で落ちる。
-- 0008（テーブルの追加）は未適用でも動くようにしてあるが、**列の追加では
-- 同じ逃げ方ができない** ―― 取る列を実行時に変えると、列の過不足を型で
-- 止めている `columns<Row>()` の守りが外れる（§2.8）。
-- したがって**適用が済むまでコードを push しない**という側を選んでいる。
-- ============================================================

alter table public.actuals
  add column if not exists source_name text;

comment on column public.actuals.source_name is
  '取込時の摘要の原文（FR-58・AC-64）。重複判定はこちらで行う。'
  '　null は「原文を持たない」＝表示名を原文として扱う（手入力・0009 より前のデータ）。'
  '　表示名（name）を直してもこの列は変えない。';

-- ------------------------------------------------------------
-- 適用後の確認
--   列があること。**既存の行が消えていないこと**（列の追加なので消えない
--   が、数えておく。CLAUDE.md §2.5.2 の2番目）。
-- ------------------------------------------------------------
do $$
declare
  has_column boolean;
  rows_now bigint;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'actuals'
      and column_name = 'source_name'
  ) into has_column;

  if not has_column then
    raise exception 'actuals.source_name が無い';
  end if;

  select count(*) into rows_now from public.actuals;
  raise notice 'actuals の行数 % 件（この変更では1行も書き換えていない）', rows_now;
end $$;
