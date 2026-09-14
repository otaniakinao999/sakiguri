"use client";

/**
 * アプリのデータをメモリ上に持つ。
 *
 * 保存とクラウド同期は PoC開発計画 フェーズ3・タスク#12（Supabase）。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { DateStr } from "@/core/types";
import { emptyAppData, type AppData } from "@/lib/app-data";
import { todayStr } from "@/lib/today";

export interface AppDataStore {
  data: AppData;
  setData: (update: (previous: AppData) => AppData) => void;
  /** 端末のローカル時刻から求めた今日。マウントするまでは null */
  today: DateStr | null;
}

const AppDataContext = createContext<AppDataStore | null>(null);

export function useAppData(): AppDataStore {
  const store = useContext(AppDataContext);
  if (!store) {
    throw new Error("AppDataProvider の外で useAppData を呼んでいます");
  }
  return store;
}

/** 今日が定まるまでの仮の基準日。マウント直後に実際の日付へ差し替える。 */
const PLACEHOLDER_DATE = "1970-01-01";

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

  useEffect(() => {
    const now = todayStr();
    setToday(now);
    setDataState((previous) =>
      previous.asOf === PLACEHOLDER_DATE ? { ...previous, asOf: now } : previous,
    );
  }, []);

  const setData = useCallback((update: (previous: AppData) => AppData) => {
    setDataState(update);
  }, []);

  const store = useMemo(
    () => ({ data, setData, today }),
    [data, setData, today],
  );

  return (
    <AppDataContext.Provider value={store}>{children}</AppDataContext.Provider>
  );
}
