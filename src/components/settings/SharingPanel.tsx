"use client";

/**
 * 共有の一覧（FR-67・AC-83）
 *
 * 一次情報：docs/要件定義書.md FR-23・FR-31・FR-67、AC-77〜AC-84
 *
 * **間違った相手を招待することは技術では防げない。** 防ぐのではなく、
 * **気づいて取り消せる距離に置く**のが唯一の守りである（AC-83）。
 * だからこの画面の中心は「いま誰に何を渡しているか」で、失効はその
 * 一覧からできる。
 *
 * **未受諾も出す。** 招待が迷惑メールに入ると、相手は「来ない」と言い、
 * 持ち主は「送った」と言う。どちらが起きているかを持ち主が見られるように
 * する。
 *
 * **0011 が未適用でも開ける。** 読み書きが「テーブルが無い」で落ちたら
 * 空として扱う（`lib/supabase/sharing.ts`）。
 */

import { useCallback, useEffect, useState } from "react";

import { useAppData } from "@/components/app-shell/AppDataProvider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/sakiguri/Panel";
import { Select, TextInput } from "@/components/ui/inputs";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase/client";
import {
  createInvite,
  deleteInvite,
  fetchInvites,
  revokeGrant,
} from "@/lib/supabase/sharing";
import {
  LEVEL_LABEL,
  LEVEL_NOTE,
  inviteStatus,
  looksLikeEmail,
  type GrantLevel,
  type InviteRow,
} from "@/lib/sharing";

const CELL = "border-b border-border px-cell py-8 align-middle";
const HEAD =
  "border-b border-border bg-muted px-cell py-8 text-left t-label-sm text-muted-foreground whitespace-nowrap";

export function SharingPanel() {
  const { session, activeOwnerId } = useAppData();
  const myId = session?.user.id ?? null;
  const myEmail = session?.user.email ?? null;

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<GrantLevel>("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!myId || !isSupabaseConfigured()) return;
    try {
      setInvites(await fetchInvites(getSupabase(), myId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [myId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* **他人の帳を見ているあいだは出さない。** 渡す権限は帳の持ち主のもので、
     客がここから誰かを呼べると AC-78 を破る */
  if (!myId || (activeOwnerId && activeOwnerId !== myId)) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = () => {
    if (!myEmail) {
      setError("自分のアドレスが分からないので招待できません");
      return;
    }
    void run(async () => {
      await createInvite(getSupabase(), { id: myId, email: myEmail }, email, level);
      setEmail("");
    });
  };

  return (
    <Panel title={`共有（${invites.length}件）`}>
      <div className="flex flex-col gap-16">
        <p className="t-body-sm text-muted-foreground">
          帳を渡す相手を招待します。渡したあとに取り消せます ――
          間違った相手に渡したことは、ここで気づいて失効してください。
          渡していない人には、この帳は見えません。
        </p>

        {/* ---------- 招待する ---------- */}
        <div className="flex flex-wrap items-end gap-12">
          <div className="flex min-w-0 flex-col gap-4">
            <label className="t-label-sm text-muted-foreground" htmlFor="invite-email">
              相手のメールアドレス
            </label>
            <TextInput
              id="invite-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tax@example.com"
            />
          </div>

          <div className="flex flex-col gap-4">
            <label className="t-label-sm text-muted-foreground" htmlFor="invite-level">
              渡す権限
            </label>
            <Select
              id="invite-level"
              value={level}
              onChange={(e) => setLevel(e.target.value as GrantLevel)}
            >
              <option value="view">{LEVEL_LABEL.view}</option>
              <option value="edit">{LEVEL_LABEL.edit}</option>
            </Select>
          </div>

          <Button onClick={invite} disabled={busy || !looksLikeEmail(email)}>
            招待する
          </Button>
        </div>

        {/* **渡す前に読ませる。** 段の名前だけでは何ができるか分からない */}
        <p className="t-body-sm text-muted-foreground">
          {LEVEL_LABEL[level]}：{LEVEL_NOTE[level]}
        </p>

        {error && <p className="t-body-sm text-error">{error}</p>}

        {/* ---------- いま誰に何を渡しているか ---------- */}
        {invites.length === 0 ? (
          <p className="t-body-sm text-muted-foreground">
            いま誰にも渡していません。
          </p>
        ) : (
          <table className="w-max min-w-full border-collapse text-left wide:w-full">
            <thead>
              <tr>
                <th className={HEAD}>相手</th>
                <th className={HEAD}>権限</th>
                <th className={HEAD}>状態</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody>
              {invites.map((row) => (
                <tr key={row.id}>
                  <td className={CELL}>{row.email}</td>
                  <td className={CELL}>{LEVEL_LABEL[row.level]}</td>
                  <td className={CELL}>{inviteStatus(row)}</td>
                  <td className={CELL}>
                    <span className="flex gap-8">
                      {row.acceptedAt === null && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              createInvite(
                                getSupabase(),
                                { id: myId, email: myEmail ?? "" },
                                row.email,
                                row.level,
                              ),
                            )
                          }
                        >
                          再送
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            row.acceptedAt === null
                              ? deleteInvite(getSupabase(), myId, row.id)
                              : revokeGrant(getSupabase(), myId, row),
                          )
                        }
                      >
                        {row.acceptedAt === null ? "取り消す" : "失効する"}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="t-body-sm text-muted-foreground">
          失効しても、その人が代理で入れた実績は残ります ――
          記帳はこの帳への行為であって、代行者の持ち物ではありません。
        </p>
      </div>
    </Panel>
  );
}
