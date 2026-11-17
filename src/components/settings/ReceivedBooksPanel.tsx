"use client";

/**
 * 渡されている帳（FR-23・FR-31・AC-84）
 *
 * **ここは入口であって、守りではない。** 守りはワードマークの隣の常時表示
 * （`Sidebar` の `BookBadge`）である ―― いまどの帳にいるかは、切り替えた
 * あとも全画面で読めていなければならない（AC-84）。
 *
 * **付与が0件なら何も出さない。** 共有を使わない人に語を増やさない。
 * 自分の帳しか無いとき、この画面はいまと同じに見える。
 */

import { useCallback, useEffect, useState } from "react";

import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/sakiguri/Panel";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase/client";
import { acceptInvite, fetchIncomingInvites } from "@/lib/supabase/sharing";
import { LEVEL_LABEL, type InviteRow } from "@/lib/sharing";

export function ReceivedBooksPanel() {
  const { books, activeOwnerId, setActiveOwnerId, session } = useAppData();
  const myEmail = session?.user.email ?? null;

  const [incoming, setIncoming] = useState<InviteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured() || !myEmail) return;
    try {
      const all = await fetchIncomingInvites(getSupabase());
      /* **自分宛だけ。** RLS も同じ条件で絞るが、画面側でも確かめる ――
         ここが緩むと、他人宛の招待が一覧に出る（AC-79） */
      setIncoming(all.filter((i) => i.email.toLowerCase() === myEmail.toLowerCase()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [myEmail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const shared = books.filter((b) => !b.own);

  /* **0件なら何も出さない**（AC-84）。渡されても招待されてもいない人には、
     この画面はいままでと同じに見える */
  if (shared.length === 0 && incoming.length === 0) return null;

  const accept = (id: string) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await acceptInvite(getSupabase(), id);
        await reload();
        /* 受け取った帳は次の読み込みで一覧に出る。画面を開き直さずに
           済むよう、ここでは何も選ばない ―― **既定は自分の帳**（AC-84） */
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Panel title="渡されている帳">
      <div className="flex flex-col gap-16">
        {incoming.length > 0 && (
          <div className="flex flex-col gap-8">
            <p className="t-body-sm text-muted-foreground">
              受け取っていない招待があります。
            </p>
            {incoming.map((i) => (
              <span key={i.id} className="flex flex-wrap items-center gap-12">
                <span className="t-body">
                  {LEVEL_LABEL[i.level]}の招待
                </span>
                <Button disabled={busy} onClick={() => accept(i.id)}>
                  受け取る
                </Button>
              </span>
            ))}
          </div>
        )}

        {shared.map((book) => {
          const here = book.ownerId === activeOwnerId;
          return (
            <span key={book.ownerId} className="flex flex-wrap items-center gap-12">
              <span className="t-body">{book.label}</span>
              <span className="t-label-sm text-muted-foreground">
                {book.level ? LEVEL_LABEL[book.level] : ""}
              </span>
              <Button
                variant={here ? "secondary" : "primary"}
                disabled={here}
                onClick={() => setActiveOwnerId(book.ownerId)}
              >
                {here ? "いま見ています" : "この帳を開く"}
              </Button>
            </span>
          );
        })}

        {shared.length > 0 && activeOwnerId && books[0]?.ownerId !== activeOwnerId && (
          <span>
            <Button variant="secondary" onClick={() => setActiveOwnerId(books[0].ownerId)}>
              自分の帳に戻る
            </Button>
          </span>
        )}

        {error && <p className="t-body-sm text-error">{error}</p>}
      </div>
    </Panel>
  );
}
