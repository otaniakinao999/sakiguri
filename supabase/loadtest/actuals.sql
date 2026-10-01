-- 負荷試験用データ投入（AC-28b / AC-34 / AC-48）
--
-- 実績を1ユーザーにまとめて作る。**件数は下の `row_total` で決める。**
--
-- | 目的 | 件数 | 根拠 |
-- |---|---|---|
-- | v1.0 の目標値（既定） | 3,000 | §5.1。約1.5年分 |
-- | v1.5 の目標値 | 24,000 | §5.1。約12年分 |
--
-- **AC-34 に10万件は要らない。** AC-34 が見るのは「API の1回あたり返却
-- 上限（1,000）を超える件数で、重複と欠落が起きないこと」である。3,000件
-- あれば3ページに分かれるので、上限をまたぐ経路はそれで通る。
--
-- 以前は10万件を入れていたが、§5.1 の件数要件が v1.19 で 10万 →
-- 3,000 / 24,000 に書き換わったため、10万件は要件ではなくなった
-- （10万件は50年相当。個人事業主の利用期間として想定しない）。
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ 使い方                                                         │
-- │                                                                │
-- │ 1. 負荷試験用のアカウントを作る（アプリでサインアップ）         │
-- │ 2. その id を調べる                                            │
-- │      select id, email from auth.users order by created_at desc;│
-- │ 3. 下の load_user_id を、その id に差し替える                   │
-- │    **3箇所ある**（投入の DO ブロック／後片付けの DO ブロック／  │
-- │    最後の確認クエリ）。確認クエリは2行に書いてあるので計4箇所   │
-- │ 4. 件数を変えるなら `row_total` を直す（既定 3,000）            │
-- │ 5. Supabase ダッシュボードの SQL Editor に貼って実行する        │
-- │ 6. 測り終わったらアカウントごと削除する。actuals も             │
-- │    usage_events も on delete cascade で一緒に消える             │
-- └──────────────────────────────────────────────────────────────┘
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ **次回の負荷試験では `+loadtest` を含むメールアドレスで         │
-- │   アカウントを作る。**                                         │
-- │                                                                │
-- │     otani.akinao+loadtest1@showtime.design                     │
-- │                                                                │
-- │ このファイルの後片付けブロックは6テーブルから行を消す。        │
-- │ **実データの入ったアカウントの id をここに入れて実行すると、    │
-- │ その利用者のデータが消える。** 取り違えを id の見た目だけで     │
-- │ 防ぐのは無理なので、メールアドレスで止める。投入側と削除側の    │
-- │ 両方の先頭に、`+loadtest` を含まなければ例外にするガードを      │
-- │ 入れてある。                                                   │
-- │                                                                │
-- │ Gmail 形式の `+` 付きアドレスは同じ受信箱に届くので、新しい    │
-- │ メールアドレスを用意する必要はない。                           │
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

-- 確認 -----------------------------------------------------------------------
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

-- 後片付け -------------------------------------------------------------------
--
-- **行を先に消してから、アカウントを消すこと。**
--
-- accounts / actuals などは on delete cascade なのでアカウント削除だけでも
-- 消えるが、**行数が多いと cascade delete が1トランザクションで走って
-- タイムアウトしうる。** 途中で失敗すると中途半端な状態が残り、原因が
-- 分かりにくくなる。先に行を消しておけば、アカウント削除は軽い操作になる。
--
-- LOAD_USER_ID は投入時と同じものに差し替える。

do $$
declare
  load_user_id uuid := '00000000-0000-0000-0000-000000000000';
  removed integer;
  -- 上の id のメールアドレス。ガードが使う
  target_email text;

  -- 作る実績の件数。**v1.0 の目標値が 3,000（§5.1）**
  row_total integer := 3000;

  -- 何日ぶんに散らすか。3,000件なら約1.5年分という §5.1 の前提に合わせる。
  -- 件数を変えてもここは変えない。1日あたりの件数のほうが変わる
  span_days integer := 550;
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

  -- 1万行ずつ消す。件数が多いときに1トランザクションで消すのを避ける
  loop
    delete from public.actuals
    where id in (
      select id from public.actuals
      where user_id = load_user_id
      limit 10000
    );
    get diagnostics removed = row_count;
    raise notice '% 行削除', removed;
    exit when removed = 0;
  end loop;

  delete from public.oneoff_items   where user_id = load_user_id;
  delete from public.recurring_items where user_id = load_user_id;
  delete from public.overrides      where user_id = load_user_id;
  delete from public.accounts       where user_id = load_user_id;
  delete from public.settings       where user_id = load_user_id;
  -- usage_events はイベント記録。ここでは消さず、アカウント削除の cascade に任せる
end $$;

-- 残っていないことを確認してから、ダッシュボードの
-- Authentication → Users でアカウントを削除する。
--
-- **上の DO ブロックで消したテーブルを全部数える。** 2つだけ確認して
-- 「0件だった」と読むと、消し忘れたテーブルが残ったままアカウントを
-- 消すことになる。消す側と数える側は同じ集合でなければならない
-- （CLAUDE.md §2.8）。usage_events は意図して残し、cascade に任せる。
select
  (select count(*) from public.actuals        where user_id = '00000000-0000-0000-0000-000000000000') as 実績,
  (select count(*) from public.oneoff_items   where user_id = '00000000-0000-0000-0000-000000000000') as 単発予定,
  (select count(*) from public.recurring_items where user_id = '00000000-0000-0000-0000-000000000000') as 定期項目,
  (select count(*) from public.overrides      where user_id = '00000000-0000-0000-0000-000000000000') as 変更,
  (select count(*) from public.accounts       where user_id = '00000000-0000-0000-0000-000000000000') as 口座,
  (select count(*) from public.settings       where user_id = '00000000-0000-0000-0000-000000000000') as 設定,
  (select count(*) from public.usage_events   where user_id = '00000000-0000-0000-0000-000000000000') as イベント残;
