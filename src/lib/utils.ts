import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * クラス名の結合。shadcn/ui の部品が前提にしている関数。
 *
 * tailwind-merge は Tailwind 既定のクラス名を知っているため、
 * このリポジトリの px 名スケール（p-16 ＝ 16px）では衝突の解決が
 * 効かない組み合わせがある。**同じ性質のクラスを2箇所から渡さない。**
 * 上書きしたいときは、渡す側で片方を落とす。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
