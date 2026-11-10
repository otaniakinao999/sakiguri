"use client";

/**
 * CSV仕分けルール（FR-18、CL-10）
 *
 * 一次情報：docs/要件定義書.md §3.2 ImportRule・§3.3 CL-10
 *
 * **ここが唯一の、ルールを消せる場所である。** 取込の確認画面からは
 * 「このルールを使わない」までで、消せない（FR-50 の「消すと戻せないので
 * 外すだけにする」に揃えた。AC-57b）。
 *
 * **取込の確認画面の「次回もこうする」で作ったルールも、ここに行として
 * 出る。** 出ないと、利用者から見れば「覚えた覚えのないものが当たる」に
 * なり、自動学習と区別がつかない（AC-57c）。
 *
 * `type`（収支）の列は無い。収支は金額の符号で決まり、ルールはそれを
 * 変えない（§3.2 ImportRule）。
 */

import { useState } from "react";

import {
  categoriesInGroup,
  costTypeApplies,
  fitCostType,
  groupOfCategory,
} from "@/core/categories";
import { ruleConflict } from "@/core/csv";
import type { ImportRule, RuleDirection } from "@/core/types";
import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Panel } from "@/components/sakiguri/Panel";
import { track } from "@/lib/analytics/track";
import { Button } from "@/components/ui/button";
import { NumberInput, Select, TextInput } from "@/components/ui/inputs";
import { addRule, newId, removeRule, updateRule } from "@/lib/mutations";

const CELL = "border-b border-border px-cell py-8 align-top";
const HEAD =
  "border-b border-border bg-muted px-cell py-8 text-left t-label-sm text-muted-foreground whitespace-nowrap";

/** 新しいルールの初期値。費目は受け皿にしておく（§3.1.2 適用規則4） */
function blankRule(): ImportRule {
  return {
    id: newId(),
    pattern: "",
    accountId: null,
    direction: null,
    categoryCode: "EXP-20",
    costType: "variable",
    bizRatio: 0,
  };
}

/**
 * ルールの費目の選択。
 *
 * **収入・支出・資金移動をまとめて出す。** ルールは `type` を持たず、
 * 選んだ費目が符号を決める（§3.2 ImportRule）。`CategorySelect` は収支から
 * グループを絞るので、そのままでは**支出の費目から収入の費目に変えられない。**
 *
 * 自動生成される費目（カード引落 TRF-04・借入返済の元金 TRF-06）は出さない。
 * CL-2 / CL-8 が生成するので、ルールで当てると二重に乗る。
 */
function RuleCategorySelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {(["INC", "EXP", "TRF"] as const).map((group) => (
        <optgroup key={group} label={GROUP_LABEL[group]}>
          {categoriesInGroup(group)
            .filter((c) => !c.generated)
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

const GROUP_LABEL = { INC: "収入", EXP: "支出", TRF: "資金移動" } as const;

/**
 * 向きの選択を出すか。
 *
 * **資金移動の費目のときだけ。** INC / EXP は符号が費目から決まるので、
 * 選ばせると同じ規則を2箇所に持つことになる（`effectiveDirection`）。
 */
const needsDirection = (code: string) => groupOfCategory(code) === "TRF";

export function RulesTable() {
  const { data, setData, session } = useAppData();
  const [draft, setDraft] = useState<ImportRule | null>(null);

  const conflict = draft ? ruleConflict(draft) : null;

  const save = () => {
    if (!draft || conflict) return;
    const rule = { ...draft, pattern: draft.pattern.trim() };
    setData((d) => addRule(d, rule));
    track(session?.user.id, "import_rule_created", {
      patternLength: [...rule.pattern].length,
      fromImport: false,
    });
    setDraft(null);
  };

  return (
    <Panel
      title={`CSV取込の仕分けルール（${data.rules.length}件）`}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDraft((d) => (d ? null : blankRule()))}
        >
          {draft ? "やめる" : "ルールを足す"}
        </Button>
      }
    >
      <p className="t-body-sm text-muted-foreground">
        取込で<strong className="font-semibold">予定と照合できなかった行</strong>
        の費目を決めます。摘要に文字列が
        <strong className="font-semibold">含まれていれば</strong>当たり、
        複数当たったときは<strong className="font-semibold">長いほうが勝ちます</strong>
        （細かいルールをあとから足せます）。
      </p>

      {data.rules.length === 0 && !draft ? (
        <p className="py-24 text-center t-body-sm text-muted-foreground">
          ルールはまだありません。取込の確認画面で費目を直したときに
          「次回もこうする」で作れます。
        </p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={HEAD}>摘要に含まれる文字列</th>
              <th className={HEAD}>口座</th>
              <th className={HEAD}>向き</th>
              <th className={HEAD}>費目</th>
              <th className={HEAD}>固定/変動</th>
              <th className={HEAD}>事業割合</th>
              <th className={HEAD} />
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <tr key={rule.id}>
                <td className={CELL}>
                  <TextInput
                    aria-label="摘要に含まれる文字列"
                    value={rule.pattern}
                    onChange={(e) =>
                      setData((d) => updateRule(d, rule.id, { pattern: e.target.value }))
                    }
                  />
                </td>
                <td className={CELL}>
                  <Select
                    aria-label="口座"
                    value={rule.accountId ?? ""}
                    onChange={(e) =>
                      setData((d) =>
                        updateRule(d, rule.id, { accountId: e.target.value || null }),
                      )
                    }
                  >
                    <option value="">すべての口座</option>
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className={CELL}>
                  {needsDirection(rule.categoryCode) ? (
                    <Select
                      aria-label="向き"
                      value={rule.direction ?? ""}
                      onChange={(e) =>
                        setData((d) =>
                          updateRule(d, rule.id, {
                            direction: (e.target.value || null) as RuleDirection | null,
                          }),
                        )
                      }
                    >
                      <option value="">入金・出金の両方</option>
                      <option value="out">出金だけ</option>
                      <option value="in">入金だけ</option>
                    </Select>
                  ) : (
                    <span className="t-body-sm text-muted-foreground">
                      {/* 費目から決まる。選ばせない（§2.8） */}
                      {groupOfCategory(rule.categoryCode) === "INC"
                        ? "入金の行"
                        : "出金の行"}
                    </span>
                  )}
                </td>
                <td className={CELL}>
                  <RuleCategorySelect
                    label="費目"
                    value={rule.categoryCode}
                    onChange={(categoryCode) =>
                      setData((d) =>
                        updateRule(d, rule.id, {
                          categoryCode,
                          /* 固定変動は費目グループから決まる（適用規則6）。
                             資金移動では事業割合も効かない */
                          costType: fitCostType(categoryCode, rule.costType),
                          /* **資金移動でなくなったら向きを落とす。** 向きは
                             費目から決まるので、残すと「入金だけ」の支出の
                             ルールという、どの行にも当たらない組み合わせが
                             画面から見えないまま残る（AC-57d） */
                          ...(groupOfCategory(categoryCode) === "TRF"
                            ? { bizRatio: 0 }
                            : { direction: null }),
                        }),
                      )
                    }
                  />
                </td>
                <td className={CELL}>
                  {costTypeApplies(rule.categoryCode) ? (
                    <Select
                      aria-label="固定/変動"
                      value={rule.costType ?? "variable"}
                      onChange={(e) =>
                        setData((d) =>
                          updateRule(d, rule.id, {
                            costType: e.target.value === "fixed" ? "fixed" : "variable",
                          }),
                        )
                      }
                    >
                      <option value="variable">変動費</option>
                      <option value="fixed">固定費</option>
                    </Select>
                  ) : (
                    /* 費目グループが EXP でなければ意味を持たない（適用規則6） */
                    <span className="t-body-sm text-muted-foreground">—</span>
                  )}
                </td>
                <td className={CELL}>
                  {groupOfCategory(rule.categoryCode) === "TRF" ? (
                    <span className="t-body-sm text-muted-foreground">—</span>
                  ) : (
                    <NumberInput
                      aria-label="事業割合"
                      value={rule.bizRatio}
                      max={100}
                      onValueChange={(bizRatio) =>
                        setData((d) => updateRule(d, rule.id, { bizRatio }))
                      }
                    />
                  )}
                </td>
                <td className={CELL}>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setData((d) => removeRule(d, rule.id))}
                  >
                    削除
                  </Button>
                </td>
              </tr>
            ))}

            {draft ? (
              <tr className="bg-muted/50">
                <td className={CELL}>
                  <TextInput
                    autoFocus
                    aria-label="新しいルールの摘要"
                    value={draft.pattern}
                    placeholder="ﾄｳｷﾖｳﾄﾞﾝ"
                    onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
                  />
                </td>
                <td className={CELL}>
                  <Select
                    aria-label="新しいルールの口座"
                    value={draft.accountId ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, accountId: e.target.value || null })
                    }
                  >
                    <option value="">すべての口座</option>
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className={CELL}>
                  {needsDirection(draft.categoryCode) ? (
                    <Select
                      aria-label="新しいルールの向き"
                      value={draft.direction ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          direction: (e.target.value || null) as RuleDirection | null,
                        })
                      }
                    >
                      <option value="">入金・出金の両方</option>
                      <option value="out">出金だけ</option>
                      <option value="in">入金だけ</option>
                    </Select>
                  ) : (
                    <span className="t-body-sm text-muted-foreground">
                      {groupOfCategory(draft.categoryCode) === "INC"
                        ? "入金の行"
                        : "出金の行"}
                    </span>
                  )}
                </td>
                <td className={CELL}>
                  <RuleCategorySelect
                    label="新しいルールの費目"
                    value={draft.categoryCode}
                    onChange={(categoryCode) =>
                      setDraft({
                        ...draft,
                        categoryCode,
                        costType: fitCostType(categoryCode, draft.costType),
                        ...(groupOfCategory(categoryCode) === "TRF"
                          ? { bizRatio: 0 }
                          : { direction: null }),
                      })
                    }
                  />
                </td>
                <td className={CELL}>
                  {costTypeApplies(draft.categoryCode) ? (
                    <Select
                      aria-label="新しいルールの固定/変動"
                      value={draft.costType ?? "variable"}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          costType: e.target.value === "fixed" ? "fixed" : "variable",
                        })
                      }
                    >
                      <option value="variable">変動費</option>
                      <option value="fixed">固定費</option>
                    </Select>
                  ) : (
                    /* 費目グループが EXP でなければ意味を持たない（適用規則6） */
                    <span className="t-body-sm text-muted-foreground">—</span>
                  )}
                </td>
                <td className={CELL}>
                  {groupOfCategory(draft.categoryCode) === "TRF" ? (
                    <span className="t-body-sm text-muted-foreground">—</span>
                  ) : (
                    <NumberInput
                      aria-label="新しいルールの事業割合"
                      value={draft.bizRatio}
                      max={100}
                      onValueChange={(bizRatio) => setDraft({ ...draft, bizRatio })}
                    />
                  )}
                </td>
                <td className={CELL}>
                  <Button size="sm" disabled={conflict !== null} onClick={save}>
                    保存
                  </Button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {conflict ? (
        /* **弾いた理由を出す**（AC-57d）。出さないと「保存できない」だけが
           残り、どの組み合わせが駄目なのかが分からない */
        <p className="t-body-sm text-fg-warning">{conflict}</p>
      ) : null}

      {data.rules.length > 0 ? (
        <p className="t-body-sm text-muted-foreground">
          ルールは<strong className="font-semibold">自動では作られません。</strong>
          ここと、取込の確認画面の「次回もこうする」だけで増えます。
        </p>
      ) : null}
    </Panel>
  );
}
