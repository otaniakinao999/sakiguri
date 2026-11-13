/**
 * AC-69 摘要の差し替えの結果を1文にする
 *
 * **件数を2つ出す。** 1つの数字にすると、画面で変わった行の数と合わない
 * か、当たった行が当たらなかったように見えるかのどちらかになる（§2.12）。
 *
 * **4通りを同じ実行で測る。** 0件の組み合わせを落とすと、「0件でも
 * `0件は明細に店名が無いので…` と出す実装」に気づけない。
 */

import { describe, expect, it } from "vitest";

import { nameSourceMessage } from "@/lib/name-source-message";

describe("AC-69 件数の文", () => {
  it("どちらもあれば、2つ出す", () => {
    expect(nameSourceMessage({ replaced: 54, noName: 7 })).toBe(
      "54件の摘要を店名に置き換えました。7件は明細に店名が無いので番号のままです。",
    );
  });

  it("店名が無かった行が0件なら、そちらは出さない", () => {
    expect(nameSourceMessage({ replaced: 155, noName: 0 })).toBe(
      "155件の摘要を店名に置き換えました。",
    );
    /* **0件のときに「0件は…」と出さない** */
    expect(nameSourceMessage({ replaced: 155, noName: 0 })).not.toContain("0件");
  });

  it("置き換えが0件でも、当たったが店名が無かったことは伝える", () => {
    /* **ここが肝。** 「置き換えた行はありません」だけだと、当たっている
       7行まで「どこかに漏れている」と読まれる */
    expect(nameSourceMessage({ replaced: 0, noName: 7 })).toBe(
      "摘要を店名に置き換えた行はありません。7件は明細に店名が無いので番号のままです。",
    );
  });

  it("どちらも0件なら、置き換えが無かったことだけを言う", () => {
    expect(nameSourceMessage({ replaced: 0, noName: 0 })).toBe(
      "摘要を店名に置き換えた行はありません。",
    );
  });
});
