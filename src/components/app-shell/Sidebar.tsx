"use client";

/**
 * 左ナビゲーション
 *
 * 一次情報：docs/design/components.md「SideNav」（Figma 2008:19 / 2008:18）
 *   幅 224px、外側に 8px の余白、bg-primary、rounded-lg。
 *   選択中は bg-background に text-fg-primary で反転させる。
 *
 * **900px 未満の横並びは v0.6.0 に記述がない**（decisions.md 未決5）。
 * 非機能要件 5.5（375px 以上に対応）を落とさないため、既存の切り替えを
 * そのまま残し、色と角丸だけ新しいトークンに寄せている。
 *
 * 基準日の下にある防衛ライン・サインアウトも Figma にはないが、
 * ほかに導線がないため残す。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpTrayIcon,
  Cog6ToothIcon,
  HomeIcon,
  PencilSquareIcon,
  PresentationChartLineIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";

import { useAppData } from "./AppDataProvider";
import { formatYen } from "@/lib/format";
import { NAV_ITEMS } from "./navigation";

/** アイコンは表示の都合なので navigation.ts（画面の一覧）には持たせない。 */
const ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  "/": HomeIcon,
  "/cashflow": PresentationChartLineIcon,
  "/pl": TableCellsIcon,
  "/entry": PencilSquareIcon,
  "/import": ArrowUpTrayIcon,
  "/settings": Cog6ToothIcon,
};

export function Sidebar() {
  const pathname = usePathname();
  const { data, session, signOut } = useAppData();

  return (
    <aside
      className="
        flex shrink-0 flex-col gap-12 bg-primary px-16 pt-12
        wide:h-full wide:w-sidenav wide:gap-24 wide:rounded-lg wide:px-16 wide:py-24
      "
    >
      <div className="flex items-baseline gap-12 wide:flex-col wide:items-start wide:gap-4 wide:px-12">
        <span className="wordmark text-primary-foreground">SAKIGURI</span>
        <span className="t-body-sm text-primary-foreground/70">個人事業主の資金繰り帳</span>
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
            const Icon = ICONS[item.href];
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`
                    flex items-center gap-12 border-b-2 px-12 py-8 t-label whitespace-nowrap
                    transition-colors
                    wide:rounded-md wide:border-b-0
                    focus-visible:outline-primary-foreground
                    ${
                      current
                        ? "border-b-primary-foreground text-primary-foreground wide:bg-background wide:text-fg-primary"
                        : "border-b-transparent text-primary-foreground/80 hover:text-primary-foreground wide:hover:bg-white/10"
                    }
                  `}
                >
                  {Icon ? <Icon aria-hidden className="hidden size-24 shrink-0 wide:block" /> : null}
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 狭いときは残高ヘッダーを優先するので隠す */}
      <div className="mt-auto hidden border-t border-border-primary-subtle px-12 pt-16 text-primary-foreground wide:block">
        <div className="t-label-sm text-primary-foreground/70">基準日</div>
        <div className="num t-body">{data.asOf}</div>

        <div className="mt-12 t-label-sm text-primary-foreground/70">生活防衛ライン</div>
        <div className="num t-body">{formatYen(data.reserveLine)}</div>

        {session && (
          <div className="mt-16 t-body-sm text-primary-foreground/70">
            <span className="block truncate" title={session.user.email ?? ""}>
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-4 text-primary-foreground underline focus-visible:outline-primary-foreground"
            >
              サインアウト
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
