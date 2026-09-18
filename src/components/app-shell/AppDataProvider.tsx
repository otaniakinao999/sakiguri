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
import { loadAppData, saveDiff } from "@/lib/supabase/storage";
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
  signOut: () => Promise<void>;
}

const AppDataContext = createContext<AppDataStore | null>(null);

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

  /** 前回保存に成功した状態。これとの差分だけを送る */
  const savedRef = useRef<AppData | null>(null);
  /** 読み込みが終わるまでは保存しない。空のデータで上書きしないため */
  const loadedRef = useRef(false);
  /** 再試行は「いま画面にある最新」を送る。保存中に加わった変更も拾う */
  const dataRef = useRef(data);
  dataRef.current = data;

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
    if (!session || !today) return;
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await loadAppData(getSupabase(), today);
        if (cancelled) return;
        setDataState(loaded);
        savedRef.current = loaded;
        loadedRef.current = true;
        toState({ status: "idle" });
      } catch (e) {
        if (cancelled) return;
        toState({
          status: "error",
          message: `読み込めませんでした：${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, today, toState]);

  /* ---------- 保存 ---------- */

  /**
   * いま溜まっている差分を送る。
   *
   * デバウンス後の自動保存と、失敗したあとの再試行の両方から呼ぶ。
   * 送る対象は `dataRef.current`（＝最新）で、呼ばれた時点で差分が
   * 無ければ何もしない。
   */
  const runSave = useCallback(async () => {
    if (!session || !loadedRef.current) return;

    const target = dataRef.current;
    const diff = diffAppData(savedRef.current, target);
    if (diff.empty) return;

    toState({ status: "saving" });
    try {
      await saveDiff(getSupabase(), session.user.id, diff, target);
      /* 成功したときだけ基準を進める。失敗したら次回まとめて送り直す */
      savedRef.current = target;
      toState({ status: "saved" });
    } catch (e) {
      toState({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [session, toState]);

  /* 400ms デバウンス（要件定義書 §5.2） */
  useEffect(() => {
    if (!session || !loadedRef.current) return;
    if (diffAppData(savedRef.current, data).empty) return;

    const timer = setTimeout(() => void runSave(), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [data, session, runSave]);

  const retrySave = useCallback(() => void runSave(), [runSave]);

  const setData = useCallback((update: (previous: AppData) => AppData) => {
    setDataState(update);
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) await getSupabase().auth.signOut();
  }, []);

  const store = useMemo(
    () => ({ data, setData, today, session, ready, saveState, retrySave, signOut }),
    [data, setData, today, session, ready, saveState, retrySave, signOut],
  );

  return (
    <AppDataContext.Provider value={store}>{children}</AppDataContext.Provider>
  );
}
