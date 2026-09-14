"use client";

/**
 * 左ナビゲーション
 *
 * 一次情報：docs/designsystem.md §5 レイアウト規約
 *   デスクトップではサイドバー 216px を固定し、blue-100 で塗る。
 *   選択中の項目は白背景に blue-100 の文字で反転させる。
 *   900px 未満では上部の横並びに切り替える。横スクロールのタブ列になる。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAppData } from "./AppDataProvider";
import { formatYen } from "@/lib/format";

import { NAV_ITEMS } from "./navigation";

export function Sidebar() {
  const pathname = usePathname();
  const { data } = useAppData();

  return (
    <aside
      className="
        bg-surface-base-primary-inverse flex shrink-0 flex-col gap-12
        px-16 pt-12
        wide:sticky wide:top-0 wide:h-screen wide:w-[var(--layout-sidebar-width)]
        wide:gap-24 wide:px-12 wide:py-24
      "
    >
      {/* ワードマーク。狭いときは横並びにして高さを稼ぐ */}
      <div className="flex items-baseline gap-12 wide:flex-col wide:items-start wide:gap-4 wide:px-8">
        <span className="font-display-en text-object-base-high-inverse text-headline-md tracking-wide leading-none font-bold">
          SAKIGURI
        </span>
        <span className="font-display-jp text-object-base-mid-inverse text-body-xxs leading-normal">
          個人事業主の資金繰り帳
        </span>
      </div>

      <nav aria-label="画面">
        <ul
          className="
            -mx-16 flex gap-4 overflow-x-auto px-16
            wide:mx-0 wide:flex-col wide:overflow-visible wide:px-0
          "
        >
          {NAV_ITEMS.map((item) => {
            const current = pathname === item.href;
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`
                    block border-b-2 px-12 py-8 text-body-sm leading-normal whitespace-nowrap
                    wide:rounded-base wide:border-b-0
                    focus-visible:outline-object-base-high-inverse
                    ${
                      current
                        ? "border-b-object-base-high-inverse text-object-base-high-inverse font-semibold wide:bg-surface-base-primary wide:text-object-accent-dim"
                        : "text-object-base-mid-inverse border-b-transparent hover:text-object-base-high-inverse"
                    }
                  `}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 基準日と防衛ライン。狭いときは残高ヘッダーが優先なので隠す */}
      <div className="text-object-base-mid-inverse mt-auto hidden border-t border-t-white/20 px-8 pt-12 text-body-xxs leading-loose wide:block">
        基準日 {data.asOf}
        <br />
        防衛ライン {formatYen(data.reserveLine)}
      </div>
    </aside>
  );
}
