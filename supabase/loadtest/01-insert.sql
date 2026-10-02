-- ============================================================
-- 1. 実績を投入する
--
-- **このファイルは全部を選択してコピーし、Supabase の SQL Editor に
-- 貼って実行する。** 中から一部を切り出す必要はない。
--
-- 使い方・注意・順番は supabase/loadtest/README.md
-- ============================================================

do $$
declare
  -- ここだけ差し替える ----------------------------------------------------
  load_user_id uuid := '00000000-0000-0000-0000-000000000000';
  -- ------------------------------------------------------------------------

  -- 上の id のメールアドレス。ガードが使う
  target_email text;

  -- 作る実績の件数。**v1.0 の目標値が 3,000（§5.1）**
  row_total integer := 3000;

  -- 何日ぶんに散らすか。3,000件なら約1.5年分という §5.1 の前提に合わせる。
  -- 件数を変えてもここは変えない。1日あたりの件数のほうが変わる
  span_days integer := 550;

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

  -- **取り違えの番人。** 実在する id であることだけでは足りない。実データの
  -- 入ったアカウントの id も実在するからである。**負荷試験用のアカウントで
  -- あることをメールアドレスで確かめる**（冒頭の枠を参照）。
  select email into target_email from auth.users where id = load_user_id;
  if target_email is null or position('+loadtest' in target_email) = 0 then
    raise exception '負荷試験用アカウントではありません: %', coalesce(target_email, '(見つからない)');
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
  -- 黙って飛ばし、作った実績が他人の口座を指したまま入る。
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
  -- 実績がすべて `plan_key = null`（未判定）なので、候補照合は
  -- 件数 × 1,200 の総当たりになる。**ここが一番重い。**
  -- 3,000件なら360万回で、v1.0 は総当たりでよい（AC-48）。
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

  -- 振替3件 --------------------------------------------------------------------
  --
  -- CL-2・CL-3 に振替の分岐がある（合計残高に対して増減0、口座別には
  -- 付け替え）。**通らないまま「落ちない」と言えないので3件だけ入れる。**
  -- 件数を絞っているのは、測りたいのは所要時間ではなく通ることだから。
  insert into public.recurring_items
    (id, user_id, name, type, cost_type, category_code, amount, biz_ratio,
     account_id, to_account_id, day, months, active)
  values
    ('66666666-6666-4666-8666-000000000001', load_user_id, '負荷試験 振替 1',
     'transfer', null, 'TRF-01', 60000, 0, seikatsu, jigyou,  5, null, true),
    ('66666666-6666-4666-8666-000000000002', load_user_id, '負荷試験 振替 2',
     'transfer', null, 'TRF-02', 80000, 0, jigyou,   seikatsu, 15, null, true),
    ('66666666-6666-4666-8666-000000000003', load_user_id, '負荷試験 振替 3',
     'transfer', null, 'TRF-01', 30000, 0, seikatsu, jigyou,  31, null, true)
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

  -- 実績 ----------------------------------------------------------------------
  --
  -- 基準日から `span_days` 日ぶんに散らす。既定（3,000件 / 550日）なら
  -- 1日あたり約5.5件、月あたり約164件。
  --
  -- **分割取得（FR-47、1,000件）は3,000件で3ページに分かれるので通る。**
  -- 月内ページング（FR-42、200件）は月164件だと通らない。そちらを測る
  -- なら `span_days` を小さくして1ヶ月に200件を超えさせる。
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
    as_of + (i * span_days / row_total),   -- span_days 日ぶんに等間隔で散らす
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
  from generate_series(0, row_total - 1) as i;
end $$;
