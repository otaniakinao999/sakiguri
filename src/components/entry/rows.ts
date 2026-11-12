/**
 * 実績入力（SC-05）と実績一覧の行の型
 *
 * **2つの画面が同じ行の形を使う。** やること（`EntryView`）と
 * 実績一覧（`ActualsView`）は別のページだが（FR-54）、行の中身は
 * 同じ ―― 日付・内容・金額・区分。整形は `entry-view-model.ts` が
 * 1箇所で行う。
 *
 * **部品のファイルに置かない。** 以前は `EntryView` が持っていたので、
 * ページを分けたときに一覧の側が「やることの画面」を import する形に
 * なってしまう。
 */

import type * as React from "react";

import type { Yen } from "@/core/types";
import type { AmountView } from "@/components/sakiguri/amount-view";
import type { Category } from "@/components/sakiguri/CategoryTag";
import type { MonthTabState } from "@/components/sakiguri/MonthTab";

export interface RowBase {
  id: string;
  /** 整形済み。例：9/27 */
  date: string;
  title: string;
  /** 行の金額（正の額）。［実際の金額］の初期値にも使う */
  amount: Yen;
  /** 画面に出す値・符号・色。`amountView` が1箇所で決める（AC-58b） */
  display: AmountView;
  /**
   * 資金移動の向き（「現金 → ○○銀行」）。向きを持たない行では undefined。
   *
   * **符号では足りない**（FR-63・AC-70）。合計で見ているときは閉じる
   * 振替の delta が0なので符号が付かない。`formatTransferDirection` が
   * 1箇所で決める。
   */
  direction?: string;
  category: Category | null;
}

/** 消し込まれていない予定（行の種類 A） */
export interface EntryPlanRow extends RowBase {
  kind: "plan";
}

/** 照合されていない実績（行の種類 B。CSV由来） */
export interface EntryCandidateRow extends RowBase {
  kind: "candidate";
  candidates: RowBase[];
}

export type EntryTodoRow = EntryPlanRow | EntryCandidateRow;

export interface EntryActualRow extends RowBase {
  /** 編集・削除（FR-41）。Figma には無い */
  actions?: React.ReactNode;
}

export interface EntryMonth {
  value: string;
  label: string;
  state: MonthTabState;
}
