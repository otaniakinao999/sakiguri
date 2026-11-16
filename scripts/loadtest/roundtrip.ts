/**
 * AC-64・AC-66 の往復を、本番の Supabase で確かめる
 *
 *     pnpm loadtest:roundtrip     （終わったら pnpm loadtest:teardown）
 *
 * ## なぜ要るか
 *
 * `source_name`（取込時の摘要の原文。FR-58）と `replace_name`（仕分け
 * ルールの置き換え先。FR-59）は、**保存されて初めて意味を持つ値**である。
 * 落ちると、取込の判定が次に開いたときだけ変わる ―― 画面では分からない。
 *
 * **`/dev/screens/live` では測れない。** あれは記憶上の `setData` までで、
 * `diffAppData` → `saveDiff` を通らない。列が実在するかも分からない。
 *
 * ## 写し取らない（CLAUDE.md §2.8）
 *
 * 書くのも読むのも**本番の関数をそのまま呼ぶ** ―― `diffAppData` →
 * `saveDiff`、`loadAppData`。手で `upsert` と `select` を書くと、本番の
 * 保存経路を直したときにこのスクリプトが古いまま残り、**本番と違うものを
 * 測っていることに気づけない。**
 *
 * そのために `storage.ts` と `diff.ts` の import に拡張子を付けてある。
 * `pnpm check:node-import` が外れていないかを検査する。
 *
 * ## 測りたい差がこのデータで出るか（CLAUDE.md §2.11）
 *
 * **表示名と原文を別の文字列にする。** 同じにすると、`source_name` を
 * 落として `name` で代用する実装でも通る（`matchNameOf` が実際にその
 * 代用をするので、空振りが「正しい結果」の顔で出る）。
 * 置き換え先も `pattern` と別の文字列にする。
 *
 * **「在ること」と「無いこと」を同じ実行で測る。** 原文を持つ実績と
 * 持たない実績、置き換えのあるルールと無いルールを両方入れる。片方だけ
 * だと、**全部 null にする実装**とも**null を空文字にする実装**とも
 * 区別が付かない。
 *
 * ## 本番に書く（CLAUDE.md §2.5.3）
 *
 * 入るのは**負荷試験アカウント**だけ。番人が2つある ―― RLS（本人
 * セッションなので自分の行しか触れない）と、`+loadtest` を含まない
 * アカウントを弾くメールの検査（`client.ts`）。
 */

import { arg, fail, signInAsLoadtest, type LoadtestSession } from "./client.ts";
import { emptyAppData } from "../../src/lib/app-data.ts";
import { diffAppData } from "../../src/lib/supabase/diff.ts";
import { loadAppData, saveDiff } from "../../src/lib/supabase/storage.ts";
import type { AppData } from "../../src/lib/app-data.ts";

const AS_OF = "2026-11-01";

/* 消す目印。`teardown` は全行を消すが、取り違えたときに目で分かるよう
   名前にも入れておく */
const TAG = "roundtrip";

/* id は固定の UUID。**列は uuid 型なので "rt-acc" のような文字列は入らない**
   （`seed.ts` と同じ作り。読み直した行を id で引けるようにする） */
const ID = {
  account: "a0a0a0a0-0000-4000-8000-000000000001",
  edited: "a0a0a0a0-0000-4000-8000-000000000002",
  plain: "a0a0a0a0-0000-4000-8000-000000000003",
  replace: "a0a0a0a0-0000-4000-8000-000000000004",
  noReplace: "a0a0a0a0-0000-4000-8000-000000000005",
} as const;

/* ---------- 測るデータ ---------- */

/** 取込で入り、あとから表示名を直した実績。**ここが本題** */
const EDITED = {
  source: "デビット　４１２６６９",
  display: `${TAG} 店舗A（直した表示名）`,
};

/** 置き換えのあるルール。**当たる条件と置き換え先を別の文字列にする** */
const RULE = {
  pattern: `${TAG} 振込手数料`,
  replace: `${TAG} 銀行手数料ABC`,
};

function build(): AppData {
  const data = emptyAppData(AS_OF);
  data.reserveLine = 100_000;

  data.accounts = [
    { id: ID.account, name: `${TAG} 試験口座`, kind: "bank", balance: 500_000 },
  ];

  data.actuals = [
    {
      /* 原文を持つ。**表示名と違う** */
      id: ID.edited,
      key: null,
      date: "2026-11-05",
      name: EDITED.display,
      type: "expense",
      costType: "variable",
      categoryCode: "EXP-07",
      amount: 1_280,
      bizRatio: 0,
      accountId: ID.account,
      sourceName: EDITED.source,
    },
    {
      /* 原文を持たない（手入力・0009 より前のデータ）。
         **これが無いと、全部に値を入れる実装と区別が付かない** */
      id: ID.plain,
      key: null,
      date: "2026-11-06",
      name: `${TAG} 手入力の支出`,
      type: "expense",
      costType: "variable",
      categoryCode: "EXP-07",
      amount: 2_400,
      bizRatio: 0,
      accountId: ID.account,
    },
  ];

  data.rules = [
    {
      id: ID.replace,
      pattern: RULE.pattern,
      accountId: null,
      direction: null,
      categoryCode: "EXP-34",
      costType: "variable",
      bizRatio: 0,
      replaceName: RULE.replace,
    },
    {
      /* 置き換えないルール。**null が null のまま戻るか** */
      id: ID.noReplace,
      pattern: `${TAG} 置き換えない`,
      accountId: null,
      direction: null,
      categoryCode: "EXP-34",
      costType: "variable",
      bizRatio: 0,
      replaceName: null,
    },
  ];

  return data;
}

/* ---------- 突き合わせ ---------- */

interface Check {
  name: string;
  want: unknown;
  got: unknown;
}

function report(checks: Check[]): void {
  let bad = 0;
  for (const c of checks) {
    const ok = JSON.stringify(c.want) === JSON.stringify(c.got);
    if (!ok) bad++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${c.name}\n` +
        (ok ? "" : `      期待 ${JSON.stringify(c.want)}\n      実際 ${JSON.stringify(c.got)}\n`),
    );
  }
  console.log("");
  if (bad > 0) fail(`${bad}件 合いません。上の ✗ を見てください`);
  console.log(`${checks.length}件すべて一致しました。`);
}

/* ---------- 番人の確認（書く前に一度だけ） ---------- */

/* **アカウントの同一性の検査は `client.ts` に移した。** 枠が2つに
   なったので、「どちらの枠に入ったか」まで見る必要がある。ここに
   残すと、2つ目を使う検査が同じ判定を書き直すことになる（§2.8）。 */

/**
 * RLS が効いているか。**他人の行が1行でも見えたら止める。**
 *
 * **0行だと何も測れない**（CLAUDE.md §2.11 の3つ目の形）。空だったことを
 * そのまま出して、この確認が空振りだったと分かるようにする。
 */
async function checkRls(
  { supabase, userId }: LoadtestSession,
  when: string,
): Promise<number> {
  const tables = ["settings", "accounts", "actuals", "import_rules"];
  let seen = 0;
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("user_id").limit(50);
    if (error) fail(`${table} を読めません: ${error.message}`);
    const foreign = (data ?? []).filter((r) => r.user_id !== userId);
    seen += (data ?? []).length;
    if (foreign.length > 0) {
      fail(
        `RLS が効いていません。${table} に他の利用者の行が ${foreign.length}件 見えます。\n` +
          `  **ここで止めます。**`,
      );
    }
  }
  console.log(
    seen === 0
      ? `RLS（${when}）**空振り。** 見えた行が0 ―― 他人の行が無いのか、` +
          `そもそもこのアカウントが空なのか区別できない`
      : `RLS（${when}）${seen}行 見えて、すべて自分の user_id`,
  );
  return seen;
}

/* ---------- 本体 ---------- */

async function main(): Promise<void> {
  const session = await signInAsLoadtest();
  console.log(`サインイン ${session.email}`);

  /* **書く前。** 他人の行が見えたらここで止める。ただし空だと空振りなので、
     書いたあとにもう一度見る（§2.11「在ることを先に見る」） */
  const before = await checkRls(session, "書く前");
  console.log("");

  const next = build();

  /* **測りたい差がこのデータで出るか**（§2.11）。先に確かめる */
  const edited = next.actuals[0];
  if (edited.sourceName === edited.name) {
    fail("表示名と原文が同じです。これでは source_name を落としても通ります");
  }
  const rule = next.rules[0];
  if (rule.replaceName === rule.pattern) {
    fail("置き換え先と pattern が同じです。これでは replace_name を落としても通ります");
  }
  console.log("投入するデータ");
  console.log(`  実績（原文あり）  表示名 ${edited.name}`);
  console.log(`                    原文   ${edited.sourceName}  ← 別の文字列`);
  console.log(`  実績（原文なし）  ${next.actuals[1].name}`);
  console.log(`  ルール（置換あり）${rule.pattern} → ${rule.replaceName}`);
  console.log(`  ルール（置換なし）${next.rules[1].pattern} → null`);
  console.log("");

  /* ---------- 書く。**本番の保存経路をそのまま通す** ---------- */
  const diff = diffAppData(emptyAppData(AS_OF), next);
  if (diff.empty) fail("差分が空です。投入するものがありません");
  await saveDiff(session.supabase, session.userId, diff, next);
  console.log("saveDiff 完了");

  /* ---------- 読む。**本番の読み込み経路をそのまま通す** ---------- */
  const back = await loadAppData(session.supabase, AS_OF, session.userId);
  console.log("loadAppData 完了");
  console.log("");

  const got = {
    edited: back.actuals.find((a) => a.id === ID.edited),
    plain: back.actuals.find((a) => a.id === ID.plain),
    replace: back.rules.find((r) => r.id === ID.replace),
    noReplace: back.rules.find((r) => r.id === ID.noReplace),
  };

  if (!got.edited || !got.plain || !got.replace || !got.noReplace) {
    fail(
      `読み直した行が足りません\n` +
        `  actuals ${back.actuals.length}件 / rules ${back.rules.length}件`,
    );
  }

  console.log("AC-64 source_name");
  report([
    {
      name: "原文が、保存して読み直しても残る",
      want: EDITED.source,
      got: got.edited.sourceName,
    },
    {
      name: "表示名は直したまま（原文に上書きされない）",
      want: EDITED.display,
      got: got.edited.name,
    },
    {
      name: "原文と表示名が別のまま戻る",
      want: false,
      got: got.edited.sourceName === got.edited.name,
    },
    {
      name: "原文を持たない実績は、持たないまま戻る（空文字にしない）",
      want: undefined,
      got: got.plain.sourceName,
    },
  ]);

  console.log("");
  console.log("AC-66 replace_name");
  report([
    {
      name: "置き換え先が、保存して読み直しても残る",
      want: RULE.replace,
      got: got.replace.replaceName,
    },
    {
      name: "当たる条件（pattern）は置き換わらない",
      want: RULE.pattern,
      got: got.replace.pattern,
    },
    {
      name: "置き換えないルールは null のまま戻る",
      want: null,
      got: got.noReplace.replaceName,
    },
  ]);

  console.log("");

  /* **ここでは行が在る。** 書く前が0件だったときの空振りを埋める ――
     RLS が無ければ、この時点で実データのアカウントの行も見えるはずである */
  const after = await checkRls(session, "書いたあと");
  if (before === 0 && after === 0) {
    fail("書いたあとも0行。読めていません");
  }

  console.log("");
  console.log("**本番に行が残っています。pnpm loadtest:teardown で消してください。**");
  if (arg("keep", 0) === 0) {
    console.log("  （このスクリプトは消しません。消す経路を1つにするため）");
  }
}

await main();
