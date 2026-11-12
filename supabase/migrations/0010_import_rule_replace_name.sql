-- ============================================================
-- 0010 仕分けルールで摘要を置き換えられるようにする（FR-59・AC-66）
--
-- 一次情報：docs/要件定義書.md §3.2 ImportRule、FR-59、AC-66
--
-- 利用者の要望：「仕訳ルールで**摘要も置き換えたい**。
-- 例：『振込＊カ）ラボル』→『㈱ラボル』」
--
-- **0009 が先に要る。** 置き換えると表示名がCSVの摘要と変わるので、原文で
-- 判定する仕組み（FR-58）が無いと、**ルールを作った行が全部、重複判定から
-- 外れる。** 置き換えを後から変えても、過去に取り込んだ行の判定は変わらない
-- （原文は保存時のまま。AC-66）。
--
-- **`pattern`・`account_id`・`direction` の一意制約は変えない。**
-- 置き換える摘要は「当たる条件」ではなく「当たったときに何をするか」である。
-- 一意制約に入れると、同じ条件で違う置き換えをする2行が持ててしまい、
-- どちらが勝つかは id の順で決まる（画面からは見分けられない）。
--
-- 適用の順序：**このマイグレーションを適用してからコードをデプロイする**
-- （CLAUDE.md §2.5.1）。列の追加なので後方互換である。
-- ============================================================

alter table public.import_rules
  add column if not exists replace_name text;

comment on column public.import_rules.replace_name is
  '当たった行の表示名をこれに置き換える（FR-59・AC-66）。null は置き換えない。'
  '　原文（actuals.source_name）は置き換えないので、重複判定は変わらない。'
  '　当たる条件ではないので、一意制約（user_id, pattern, account_id, direction）には入れない。';

-- ------------------------------------------------------------
-- 適用後の確認
--   列があること。**一意制約が変わっていないこと** ―― 置き換える摘要を
--   条件に入れてしまうと、同じ条件で違う置き換えをする2行が持てる。
-- ------------------------------------------------------------
do $$
declare
  has_column boolean;
  key_columns text;
  nulls_merged boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'import_rules'
      and column_name = 'replace_name'
  ) into has_column;

  if not has_column then
    raise exception 'import_rules.replace_name が無い';
  end if;

  /* **`indkey` は int2vector なので、`unnest` に直接渡さない。**
     版によって受け付けないことがある。テキストにしてから分ける */
  select string_agg(a.attname, ',' order by k.ord) into key_columns
    from pg_index i
    cross join lateral unnest(string_to_array(i.indkey::text, ' '))
      with ordinality as k(attnum, ord)
    join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = k.attnum::smallint
   where i.indexrelid = 'public.import_rules_match_key_idx'::regclass;

  if key_columns is distinct from 'user_id,pattern,account_id,direction' then
    raise exception '一意制約の列が変わっている（% ）', key_columns;
  end if;

  select indnullsnotdistinct into nulls_merged
    from pg_index where indexrelid = 'public.import_rules_match_key_idx'::regclass;
  if not nulls_merged then
    raise exception 'import_rules_match_key_idx に nulls not distinct が無い';
  end if;
end $$;
