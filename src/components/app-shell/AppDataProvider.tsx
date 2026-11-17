"use client";

/**
 * アプリのデータの読み込み・保持・保存
 *
 * 一次情報：docs/要件定義書.md FR-17、§5.2
 *   保存は変更から400msのデバウンス後に自動実行し、失敗時は画面上に
 *   明示する。**保存失敗時もセッション中のデータは失わないこと。**
 *
 * 保存に失敗しても手元の状態はそのまま持ち続け、次の変更でまとめて
 * 送り直す。前回保存に成功した状態を更新しないことで自然にそうなる。
 */

import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DateStr } from "@/core/types";
import { emptyAppData, type AppData } from "@/lib/app-data";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { diffAppData } from "@/lib/supabase/diff";
import { IncompleteLoadError } from "@/lib/supabase/fetch-all";
import { loadAppData, saveDiff } from "@/lib/supabase/storage";
import { fetchBooks } from "@/lib/supabase/sharing";
import { ownBookOnly, type Book } from "@/lib/sharing";
import { todayStr } from "@/lib/today";
import { track } from "@/lib/analytics/track";

/** 保存のデバウンス（要件定義書 §5.2）。 */
const SAVE_DEBOUNCE_MS = 400;

/** 今日が定まるまでの仮の基準日。マウント直後に実際の日付へ差し替える。 */
const PLACEHOLDER_DATE = "1970-01-01";

/**
 * 保存の状態。
 *
 * `seq` は状態が切り替わるたびに増える。トーストは「保存しました」を
 * 2秒で自動的に消すが、消したあと**同じ状態へもう一度入った**ことを
 * 検知できないと2回目以降が出ない。値が同じでも別の出来事だと分かる
 * ようにするための連番である。
 */
export type SaveStatePayload =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export type SaveState = SaveStatePayload & { seq: number };

export interface AppDataStore {
  data: AppData;
  setData: (update: (previous: AppData) => AppData) => void;
  /** 端末のローカル時刻から求めた今日。マウントするまでは null */
  today: DateStr | null;
  session: Session | null;
  /** 認証の確認とデータの読み込みが終わったか */
  ready: boolean;
  saveState: SaveState;
  /** 失敗した保存をもう一度試す。デバウンスを待たずに即座に送る */
  retrySave: () => void;
  /**
   * 読み込みに失敗した理由。成功していれば null（FR-47）。
   *
   * **これが立っているあいだはアプリを出さない。** 一部だけ取得できた
   * データで計算すると、残高も防衛ラインの警告も静かに狂う（§5.1.2）。
   */
  loadError: string | null;
  /** 読み込みをやり直す */
  retryLoad: () => void;
  signOut: () => Promise<void>;
  /**
   * 見られる帳の一覧（AC-84）。**自分の帳が必ず先頭にある。**
   * 付与が0件なら長さ1で、画面はいまと同じに見える。
   */
  books: Book[];
  /** いま見ている帳。**既定は自分の帳**（AC-84） */
  activeOwnerId: string | null;
  setActiveOwnerId: (ownerId: string) => void;
}

/**
 * **開発用のページが差し替えるために export してある。**
 * 本番では AppDataProvider だけが値を入れる。/dev/screens/* は
 * Supabase に到達できない環境でも画面を開けるよう、ここに固定値を
 * 流し込む（AppDataProvider 自身は自分で取得してしまうため）。
 */
export const AppDataContext = createContext<AppDataStore | null>(null);

export function useAppData(): AppDataStore {
  const store = useContext(AppDataContext);
  if (!store) {
    throw new Error("AppDataProvider の外で useAppData を呼んでいます");
  }
  return store;
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  /**
   * 今日はマウント後に求める。
   *
   * ビルド時に静的生成されるため、サーバー側で `new Date()` を読むと
   * ビルド日が焼き込まれ、クライアントとずれてハイドレーションが壊れる。
   */
  const [today, setToday] = useState<DateStr | null>(null);
  const [data, setDataState] = useState<AppData>(() =>
    emptyAppData(PLACEHOLDER_DATE),
  );
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle", seq: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 増やすと読み込みをやり直す */
  const [loadAttempt, setLoadAttempt] = useState(0);

  /** 前回保存に成功した状態。これとの差分だけを送る */
  const savedRef = useRef<AppData | null>(null);
  /** 読み込みが終わるまでは保存しない。空のデータで上書きしないため */
  const loadedRef = useRef(false);
  /** 再試行は「いま画面にある最新」を送る。保存中に加わった変更も拾う */
  const dataRef = useRef(data);
  dataRef.current = data;

  /**
   * 読み込み・保存が見る「誰か」。**セッションのオブジェクトではなく id。**
   *
   * `session` を依存に置くと、中身が同じでもオブジェクトが別なら
   * `Object.is` が false になって effect が再実行される。起動時は
   * `getSession()` と `onAuthStateChange` が別々にセッションを渡すので
   * それだけで複数回走り、さらに **supabase-js がトークンを定期更新する
   * たびに `TOKEN_REFRESHED` で新しいオブジェクトが来る。**
   *
   * 実測で、実績10万件の利用者が起動時に3回・24.4秒かけて同じデータを
   * 取り直していた。トークン更新でも同じことが起き、そちらは**画面を
   * 触っている最中に起きる。**
   *
   * id なら、別の利用者でサインインし直したときだけ変わる。
   */
  const userId = session?.user.id ?? null;

  /* ---------- 見られる帳（AC-84） ----------

     **既定は自分の帳。** 付与が0件なら長さ1のままで、画面はいまと
     同じに見える。共有を使わない人に語を増やさない。

     **選んだ帳は利用者と対で持つ。** `activeOwnerId` だけを状態にすると、
     **利用者が変わった瞬間に前の人の帳を指したまま1回読む**（検査が
     3回目の読み込みとして捉えた）。対で持って、利用者が違えば自分の帳に
     読み替えると、遅れが出ない。

     **`grants` が無くても落ちない**（0011 が未適用のとき）。
     `fetchBooks` が「テーブルが無い」だけを見分けて自分の帳を返す */
  const [chosen, setChosen] = useState<{ userId: string; ownerId: string } | null>(
    null,
  );
  const [bookState, setBookState] = useState<{ userId: string; list: Book[] } | null>(
    null,
  );

  /* **`useMemo` で包む。** 毎回新しい配列を返すと、これを依存に持つ
     効果が毎描画で走る */
  const books = useMemo<Book[]>(
    () =>
      userId
        ? bookState?.userId === userId
          ? bookState.list
          : ownBookOnly(userId)
        : [],
    [userId, bookState],
  );

  const activeOwnerId = userId
    ? chosen?.userId === userId
      ? chosen.ownerId
      : userId
    : null;

  const setActiveOwnerId = useCallback(
    (ownerId: string) => {
      if (userId) setChosen({ userId, ownerId });
    },
    [userId],
  );

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return;
    let cancelled = false;
    void (async () => {
      try {
        const got = await fetchBooks(getSupabase(), userId);
        if (!cancelled) setBookState({ userId, list: got });
      } catch {
        /* **共有の一覧が読めなくても、自分の帳は開ける。** ここで投げると
           付与と関係の無い利用者まで画面を開けなくなる */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /* **失効されたら自分の帳に戻す**（AC-82「失効したら見えなくなる」）。
     指したままだと、読めない帳を見続けることになる */
  useEffect(() => {
    if (!userId || !chosen || chosen.userId !== userId) return;
    if (!books.some((b) => b.ownerId === chosen.ownerId)) setChosen(null);
  }, [books, chosen, userId]);

  const seqRef = useRef(0);
  const toState = useCallback(
    (next: SaveStatePayload) => setSaveState({ ...next, seq: ++seqRef.current }),
    [],
  );

  useEffect(() => {
    setToday(todayStr());
  }, []);

  /* 今日が決まったら、まだ読み込んでいない状態の基準日を今日にする */
  useEffect(() => {
    if (!today) return;
    setDataState((previous) =>
      previous.asOf === PLACEHOLDER_DATE ? { ...previous, asOf: today } : previous,
    );
  }, [today]);

  /* ---------- 認証 ---------- */
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setReady(true);
      return;
    }
    const supabase = getSupabase();

    void supabase.auth.getSession().then(({ data: got }) => {
      setSession(got.session);
      if (!got.session) setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((authEvent, next) => {
      setSession(next);
      if (authEvent === "SIGNED_IN" && next) {
        track(next.user.id, "signed_in", {});
      }
      if (!next) {
        /* サインアウト。この端末から消す */
        loadedRef.current = false;
        savedRef.current = null;
        setDataState(emptyAppData(todayStr()));
        toState({ status: "idle" });
        setReady(true);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [toState]);

  /* ---------- 読み込み ---------- */
  useEffect(() => {
    if (!userId || !today || !activeOwnerId) return;
    let cancelled = false;

    setLoadError(null);

    void (async () => {
      try {
        /* **いま見ている帳を読む**（AC-84）。RLS は渡された帳の行も
           返すので、どの帳を見るかは必ず呼ぶ側が決める（AC-82） */
        const loaded = await loadAppData(getSupabase(), today, activeOwnerId);
        if (cancelled) return;
        setDataState(loaded);
        savedRef.current = loaded;
        loadedRef.current = true;
        toState({ status: "idle" });
      } catch (e) {
        if (cancelled) return;
        /* 読み込めなかったので保存もさせない。空のデータで上書きしないため */
        loadedRef.current = false;
        savedRef.current = null;
        setLoadError(e instanceof Error ? e.message : String(e));

        /* 分割取得のバグを検知するカナリア（§5.1.2）。件数だけを残す。
           金額・費目名・口座名は入れない（ADR-0013） */
        if (e instanceof IncompleteLoadError) {
          track(userId, "load_incomplete", {
            expected: e.expected,
            received: e.received,
          });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    /* **`session` を入れない。** 上の `userId` のコメントを読むこと */
  }, [userId, today, activeOwnerId, toState, loadAttempt]);

  const retryLoad = useCallback(() => setLoadAttempt((n) => n + 1), []);

  /* ---------- 保存 ---------- */

  /**
   * いま溜まっている差分を送る。
   *
   * デバウンス後の自動保存と、失敗したあとの再試行の両方から呼ぶ。
   * 送る対象は `dataRef.current`（＝最新）で、呼ばれた時点で差分が
   * 無ければ何もしない。
   */
  const runSave = useCallback(async () => {
    if (!userId || !loadedRef.current) return;

    const target = dataRef.current;
    const diff = diffAppData(savedRef.current, target);
    if (diff.empty) return;

    toState({ status: "saving" });
    try {
      await saveDiff(getSupabase(), userId, diff, target);
      /* 成功したときだけ基準を進める。失敗したら次回まとめて送り直す */
      savedRef.current = target;
      toState({ status: "saved" });
    } catch (e) {
      toState({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [userId, toState]);

  /* 400ms デバウンス（要件定義書 §5.2） */
  useEffect(() => {
    if (!userId || !loadedRef.current) return;
    if (diffAppData(savedRef.current, data).empty) return;

    const timer = setTimeout(() => void runSave(), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [data, userId, runSave]);

  const retrySave = useCallback(() => void runSave(), [runSave]);

  const setData = useCallback((update: (previous: AppData) => AppData) => {
    setDataState(update);
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) await getSupabase().auth.signOut();
  }, []);

  const store = useMemo(
    () => ({
      data,
      setData,
      today,
      session,
      ready,
      saveState,
      retrySave,
      loadError,
      retryLoad,
      signOut,
      books,
      activeOwnerId,
      setActiveOwnerId,
    }),
    [
      data,
      setData,
      today,
      session,
      ready,
      saveState,
      retrySave,
      loadError,
      retryLoad,
      signOut,
      books,
      activeOwnerId,
      setActiveOwnerId,
    ],
  );

  return (
    <AppDataContext.Provider value={store}>{children}</AppDataContext.Provider>
  );
}
