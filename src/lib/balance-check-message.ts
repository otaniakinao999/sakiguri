/**
 * 残高の検算を画面の文にする（FR-61・AC-68）
 *
 * 計算は `core/balance-check.ts`。ここは金額の書式だけを足す（`formatYen` は
 * core に置けないので lib にある）。
 *
 * **文はここだけが持つ。** 確認画面の知らせと、登録後の知らせの両方が
 * 同じ結果を言う。別々に書くと、**登録の前と後で違う文が出る**
 * （CLAUDE.md §2.8）。
 */

import type { BalanceCheck } from "@/core/balance-check";

import { formatYen } from "./format";

export interface BalanceCheckMessage {
  tone: "info" | "caution" | "error";
  text: string;
}

/**
 * 検算の結果の文。**出すものが無ければ null。**
 *
 * `noColumn`（残高の列が無い）では null を返す ―― AC-68 の
 * 「残高の列が無いCSVでは出さないこと」。
 */
export function balanceCheckMessage(
  check: BalanceCheck | null,
): BalanceCheckMessage | null {
  if (!check) return null;

  switch (check.status) {
    case "noColumn":
      return null;

    case "broken":
      return {
        tone: "caution",
        text:
          "残高の列が前の行と繋がっていないので、検算できません。" +
          "列の割り当てを確かめてください（読み取れなかった行があると繋がりません）。",
      };

    case "ok":
      return {
        tone: "info",
        text:
          `残高が一致しました（${check.to.replace(/-/g, "/")}時点で${formatYen(check.expected)}）。` +
          "取り落としも二重計上もありません。",
      };

    case "differs":
      /**
       * **符号から原因を言わない。**
       *
       * `recorded − expected` が負になるのは「入金の行を取り落とした」
       * ときと「出金の行を二重に入れた」ときの両方である。正も同じく
       * 両方ある。**符号は残高がどちらにずれたかしか表していない。**
       * 原因を決めつけると、利用者は無い行を探すことになる。
       */
      return {
        tone: "error",
        text:
          `登録される残高が、CSVの残高より${formatYen(Math.abs(check.diff))}` +
          (check.diff > 0 ? "多い" : "少ない") +
          `です（${check.to.replace(/-/g, "/")}時点で、CSVは${formatYen(check.expected)}、` +
          `登録されるのは${formatYen(check.recorded)}）。` +
          "取り込めていない行か、同じ行を二重に入れている行があります。" +
          `${check.from.replace(/-/g, "/")}〜${check.to.replace(/-/g, "/")}の範囲で見ています。`,
      };
  }
}
