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
  QueueListIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";

import { Wordmark } from "@/components/sakiguri/Wordmark";
import { useAppData } from "./AppDataProvider";
import { activeBook, bookBadge } from "@/lib/sharing";
import { formatYearMonthDay } from "@/lib/format";
import { NAV_ITEMS } from "./navigation";

/** アイコンは表示の都合なので navigation.ts（画面の一覧）には持たせない。 */
const ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  "/": HomeIcon,
  "/cashflow": PresentationChartLineIcon,
  "/pl": TableCellsIcon,
  "/entry": PencilSquareIcon,
  "/actuals": QueueListIcon,
  "/import": ArrowUpTrayIcon,
  "/settings": Cog6ToothIcon,
};

/**
 * いまどの帳にいるか（AC-84）。
 *
 * **切り替え器ではない。常時表示が守りである** ―― 防ぎたいのは
 * 「代行者が別の顧客の帳に実績を入れてしまう」ことで、**入れたあとに
 * 気づくのでは遅い。** 間違った相手を招待するのは取り消せるが（AC-83）、
 * 間違った帳に入れた記帳は取り消しにくい。
 *
 * **自分の帳では何も出さない。** 付与が0件の利用者には、いまの画面と
 * 同じに見える ―― 共有を使わない人に語を増やさない。
 *
 * **ワードマークの隣に置く。** 親が狭い幅では横並び、広い幅では縦積みに
 * なるので、どちらの幅でも識別と一緒に動く。口座の切り替えの隣には
 * 置かない ―― **口座は帳の中にあり、兄弟ではない。**
 */
function BookBadge() {
  const { books, activeOwnerId } = useAppData();
  if (!activeOwnerId) return null;

  const label = bookBadge(activeBook(books, activeOwnerId));
  if (!label) return null;

  return (
    <span
      className="
        min-w-0 truncate rounded-md bg-primary-foreground/15 px-8 py-4
        t-label text-primary-foreground
      "
    >
      {label} の帳
    </span>
  );
}

export function Sidebar({ currentHref }: { currentHref?: string } = {}) {
  const pathname = usePathname();
  /* /dev/screens/* から本番の現在地を渡すための口。本番では使わない */
  const active = currentHref ?? pathname;
  const { data, session, signOut } = useAppData();

  return (
    <aside
      className="
        flex shrink-0 flex-col gap-12 bg-primary px-16 pt-12
        wide:h-full wide:w-sidenav wide:gap-24 wide:rounded-lg wide:px-16 wide:py-24
      "
    >
      {/* ロゴだけ。説明文は v0.6.0 の SideNav（2008:19）に無い。
          **仮置きの SAKIGURI から支給されたロゴに差し替え**（2026-11-13）。
          色はここで渡す ―― ロゴ側は `currentColor`（§2.6） */}
      <div className="flex items-baseline gap-12 wide:flex-col wide:items-start wide:px-12">
        <Wordmark className="h-40 text-primary-foreground" />
        <BookBadge />
      </div>

      <nav aria-label="画面">
        <ul
          className="
            -mx-16 flex gap-4 overflow-x-auto px-16
            wide:mx-0 wide:flex-col wide:overflow-visible wide:px-0
          "
        >
          {NAV_ITEMS.map((item) => {
            const current = active === item.href;
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

      {/* フッター。**基準日だけ**（components.md §2 SideNav の構成4）。
          生活防衛ラインは予定の設定とグラフの凡例に出ているので外した。
          メールアドレスも外した。サインアウトはほかに置き場が無いので残す。
          狭いときは残高ヘッダーを優先するので隠す */}
      <div className="mt-auto hidden border-t border-border-primary-subtle px-12 pt-16 text-primary-foreground wide:block">
        <div className="t-label-sm text-primary-foreground/70">基準日</div>
        {/* Figma 2030:98 は「2026年9月1日」。ISO のまま出さない */}
        <div className="num t-body">{formatYearMonthDay(data.asOf)}</div>

        {session && (
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-16 t-body-sm text-primary-foreground/70 underline underline-offset-2 hover:text-primary-foreground focus-visible:outline-primary-foreground"
          >
            サインアウト
          </button>
        )}
      </div>
    </aside>
  );
}
