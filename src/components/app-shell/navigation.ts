/**
 * 画面の一覧
 *
 * 一次情報：docs/要件定義書.md §4.1 画面一覧
 * v2.0 の画面（SC-08〜SC-12）は含めない。
 */

export interface NavItem {
  /** 要件定義書 §4.1 の画面ID */
  id: string;
  href: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "SC-02", href: "/", label: "ダッシュボード" },
  { id: "SC-03", href: "/cashflow", label: "キャッシュフロー" },
  { id: "SC-04", href: "/pl", label: "年月別 収支" },
  { id: "SC-05", href: "/entry", label: "実績入力" },
  { id: "SC-06", href: "/import", label: "CSV取込" },
  { id: "SC-07", href: "/settings", label: "予定の設定" },
];
