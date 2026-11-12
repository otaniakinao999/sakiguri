"use client";

/**
 * CSV取込の確認（開発用）
 *
 * **実際の CSV を parseCsv → detectColumns → buildImportRows に通す。**
 * 照合の列（自動で照合 / 要対応2種）は本物の照合結果から出る。
 * 認証の外に置いてある。
 */

import { useState } from "react";

import { buildBalanceSeries, depositIdsOf } from "@/core/balance";
import { buildForecast, recurringKey } from "@/core/forecast";
import { checkImportBalance } from "@/core/balance-check";
import {
  buildImportRows,
  detectColumns,
  parseCsv,
  redecideWithoutRule,
  ruleFromImport,
  type ColumnMapping,
  type HistoryEntry,
  type ImportRow,
} from "@/core/csv";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_ASOF,
  FIXTURE_ACTUALS,
  FIXTURE_ONEOFFS,
  FIXTURE_RECURRING,
  FIXTURE_TODAY,
} from "@/components/dashboard/dashboard-fixture";
import type { Actual, ImportRule } from "@/core/types";
import { ImportView } from "@/components/import/ImportView";
import { balanceCheckMessage } from "@/lib/balance-check-message";
import { buildHeaderStats } from "@/lib/header-stats";
import { forecastEnd } from "@/lib/period";

/**
 * 照合の3種類が全部出るように作ってある。
 *   9/25 330,000 → 売上入金の予定と完全一致（自動で照合）
 *   10/1 10,230 → 通信費の予定は 9,800。金額だけ違う（要対応）
 *   10/10 入金 200,000 → 12日以内に同じ向きの予定が無い（候補なし）
 *
 * **4件目の日付と向きは選んである。** 出金だと a1 の費用の予定
 * （1日・5日・27日）がどこかの12日以内に入ってしまい、必ず
 * 「金額が一致しません」になる。入金の予定は25日だけなので、
 * そこから13日以上離れた10/10にした。
 *
 * **5件目は「何行に当たるか」のために足した**（AC-57e）。4件だと、
 * どう縮めても当たるのは1行だけで、**数が増えるところを一度も見られない。**
 * 1行しか当たらないデータでは、数え方が違っても 1 と出る
 * （CLAUDE.md §2.11）。`ﾌﾘｺﾐ` で複数行に当たる状態を作っている。
 *
 * ## 残高の列（FR-61・AC-68）
 *
 * **列を足さないと、この画面は検算を一度も出せない。** 残高の列が無い
 * CSVでは何も出さないのが条項なので、列の無いデータでは「出さない」側
 * しか見られない（CLAUDE.md §2.11「無いことを測る条項は、同じ実行で
 * 在ることも測る」）。
 *
 * **4件目（ﾁｲｷｼﾝｷﾝ 77,777）は、検算が当てる当のものを出すために足した。**
 * この額は `FIXTURE_ACTUALS` に「△△信金へ移動」として**手入力で既に
 * 入っている。** 摘要が漢字なので重複判定には当たらず（AC-64 の原文が
 * 一致しない）、取込のチェックは入ったままになる。つまり既定の状態は
 * **同じ取引が二重に入る**状態で、検算がそれを 77,777 と出す。
 *
 * **その行のチェックを外すと一致する。** 1クリックで「差額が出る」と
 * 「黙る」の両方を見られるようにしてある ―― 片方しか出せないデータだと、
 * 出っぱなしの実装とも、常に黙る実装とも区別が付かない。
 *
 * 残高は 9/25 の直前を 2,127,300（a1 の基準日残高 2,145,300 から 9/24 の
 * 備品 18,000 を引いた額）として、各行の増減で繋いである。
 */
const CSV = `お取引日,お取引内容,お預入額,お引出額,残高
2026/09/25,ﾌﾘｺﾐ ｼﾖｳｶｲ,330000,,2457300
2026/09/27,ｼﾞﾑｼﾖﾔﾁﾝ,,95000,2362300
2026/10/01,ﾂｳｼﾝﾋ,,10230,2352070
2026/10/09,ﾌﾘｺﾐ ﾁｲｷｼﾝｷﾝ,,77777,2274293
2026/10/10,ﾌﾘｺﾐ ﾀﾅｶ,200000,,2474293
2026/10/11,ﾌﾘｺﾐ ｽｽﾞｷ,150000,,2624293`;

/**
 * 既に保存されている実績（FR-50 の重複検出の相手）。
 *
 * **`FIXTURE_ACTUALS` だけでは重複が1件も出ない。** あちらの「備品」は
 * 手入力なので摘要が漢字で、銀行CSVの摘要（半角カナ）とは一致しない。
 * 重複が起きるのは「前にCSVから入れた行」と突き合わせたときなので、
 * **CSVと同じ摘要の実績を1件足して、その状況を作る。**
 *
 * 足さないと、この画面は本番と違う見え方になる（重複の列がいつも空）。
 * **確認用の画面が、確かめたいものを出せないのでは意味がない**
 * （CLAUDE.md §2.11）。
 */
const ALREADY_IMPORTED: Actual[] = [
  ...FIXTURE_ACTUALS,
  {
    id: "dev-imported-1",
    /* **消し込み済みにする。** 取り込んだ行は照合先の予定のキーを持つ
       （`ImportScreen` の `key: r.matchedKey`）。null のままにすると、
       既に取り込んだはずの行の予定が候補に残り、2行目が「自動で照合」
       かつ「登録済み」という、実際には起きない見え方になる */
    key: recurringKey("r2", "2026-09-27"),
    date: "2026-09-27",
    name: "ｼﾞﾑｼﾖﾔﾁﾝ",
    type: "expense",
    costType: "fixed",
    categoryCode: "EXP-01",
    amount: 95_000,
    bizRatio: 100,
    accountId: "a1",
  },
];

/**
 * 仕分けルールと履歴（FR-18・AC-57a）。
 *
 * **「ルールで決まった行」と「推定で決まった行」を同じ画面に出すために
 * 両方を入れてある。** どちらかが0件だと、確認画面の「決まり方」の
 * 書き分けを一度も見られない（CLAUDE.md §2.11 の3つ目の形）。
 *
 *   3行目 ﾂｳｼﾝﾋ   → ルールが当たる（長さ違いの2件のうち長いほうが勝つ）
 *   4行目 ﾌﾘｺﾐ ﾀﾅｶ → ルールは当たらず、履歴からの推定が当たる
 */
const DEV_RULES: ImportRule[] = [
  { id: "d1", pattern: "ﾂｳ", accountId: null, direction: null, categoryCode: "EXP-20", costType: "variable", bizRatio: 0 },
  { id: "d2", pattern: "ﾂｳｼﾝﾋ", accountId: null, direction: null, categoryCode: "EXP-03", costType: "fixed", bizRatio: 50 },
];

/** `historyKeyOf` は先頭4文字。`ﾌﾘｺﾐ` が4行目の摘要に当たる */
const DEV_HISTORY: HistoryEntry[] = [
  { name: "ﾌﾘｺﾐ ﾀﾅｶｻﾝ", categoryCode: "INC-01", costType: null, bizRatio: 100 },
];

const to = forecastEnd(FIXTURE_ASOF);
const forecast = buildForecast(
  { recurring: FIXTURE_RECURRING, oneoffs: FIXTURE_ONEOFFS, overrides: {} },
  FIXTURE_ASOF,
  to,
);
/* **残高も同じ実績で組む。** 片方だけ足すと、2行目が「自動で照合」かつ
   「登録済み」になる。既に取り込んだ行なら、その予定はもう消し込まれて
   いるはずで、候補には残らない。
   なお2行目の照合は「候補がありません」ではなく**「金額が一致しません」**
   になる。9/27 の家賃の予定は消し込み済みだが、10/1 通信費（9,800）と
   10/5 外注費（140,000）が12日以内の同じ口座・同じ向きにあるため */
const series = buildBalanceSeries(
  { accounts: FIXTURE_ACCOUNTS, asOf: FIXTURE_ASOF, forecast, actuals: ALREADY_IMPORTED },
  to,
  FIXTURE_TODAY,
);
const rows = parseCsv(CSV);

export default function DevImportWiredPage() {
  const [mapping, setMapping] = useState<ColumnMapping>(detectColumns(rows));
  const [rules, setRules] = useState<ImportRule[]>(DEV_RULES);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportRow[]>(() =>
    buildImportRows({
      rows,
      mapping: detectColumns(rows),
      accountId: "a1",
      candidates: series.unmatchedForecast,
      history: DEV_HISTORY,
      existing: ALREADY_IMPORTED,
      rules: DEV_RULES,
    }),
  );

  return (
    <>
        <ImportView
          stats={buildHeaderStats(series, FIXTURE_ACCOUNTS, FIXTURE_TODAY)}
          steps={[
            { label: "口座を選ぶ", state: "done" },
            { label: "ファイルを選ぶ", state: "done" },
            { label: "列の割り当てを確かめる", state: "done" },
            { label: "一括登録", state: "current" },
          ]}
          accounts={FIXTURE_ACCOUNTS.map((a) => ({
            id: a.id,
            label: `${a.name}${a.kind === "card" ? "（カード）" : ""}`,
          }))}
          accountId="a1"
          fileName="○○銀行_2026-09.csv"
          mapping={mapping}
          columns={rows[0].map((cell, i) => ({
            value: i,
            label: `${String.fromCharCode(65 + i)}：${cell}`,
          }))}
          onMappingChange={setMapping}
          preview={preview}
          onPreviewChange={setPreview}
          /* **本番と同じ関数で組む**（§2.8）。写し取ると、本番を直しても
             この画面は古いまま動く */
          balanceCheck={balanceCheckMessage(
            checkImportBalance({
              rows: preview,
              existing: ALREADY_IMPORTED,
              accountId: "a1",
              deposits: new Set(depositIdsOf(series)),
            }),
          )}
          disabledRules={rules.filter((r) => disabled.includes(r.id))}
          onDisableRule={(id) => {
            const remaining = rules.filter(
              (r) => r.id !== id && !disabled.includes(r.id),
            );
            setDisabled((ids) => [...ids, id]);
            setPreview((p) => redecideWithoutRule(p, id, remaining, DEV_HISTORY));
          }}
          /* **組み立ては本番と同じ `ruleFromImport`。** ここで写し取ると、
             本番の `accountId` を変えてもこの画面は古いまま動き、**本番と
             違うものを確かめることになる**（CLAUDE.md §2.8） */
          onCreateRule={(draft) =>
            setRules((rs) => [...rs, ruleFromImport(draft, "a1", `d${rs.length + 1}`)])
          }
        />
      {/* **開発用の覗き窓。** 「次回もこうする」で作ったルールの `accountId`
          が取込先の口座になることは、確認画面のどこにも出ない（AC-57e）。
          設定のルール表まで行かないと見えないので、ここに出しておく */}
      <pre className="t-body-sm text-muted-foreground">
        {rules
          .map(
            (r) =>
              `${r.id}  pattern=${r.pattern}  accountId=${r.accountId ?? "（すべての口座）"}  費目=${r.categoryCode}`,
          )
          .join("\n")}
      </pre>
    </>
  );
}
