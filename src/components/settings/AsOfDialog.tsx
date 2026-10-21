"use client";

import * as React from "react";

import type { DateStr } from "@/core/types";
import { Callout } from "@/components/sakiguri/Callout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/v06/alert-dialog";
import { Button } from "@/components/ui/v06/button";
import { formatYearMonthDay } from "@/lib/format";

/**
 * 基準日の確認ダイアログ（06b）
 *
 * 一次情報：docs/design/screens.md 06b（Figma 2034:1204）
 *
 * **止めるためではなく、気づくために出す。** 変更そのものは通す。
 * OI-6（締め処理として基準日を前に進める操作を許すか）が未決なので、
 * 仕組みで禁じると後で外すことになる。
 *
 * **変更前の日付を本文に入れる。** 元に戻すには何日だったかが要るが、
 * 変えたあとの画面にはどこにも残らない。screens.md の本文には無いが、
 * 落とすと取り消せなくなる（ADR-0023）。
 */
export function AsOfDialog({
  current,
  next,
  onConfirm,
  onCancel,
}: {
  current: DateStr;
  /** 変更しようとしている日付。null ならダイアログを出さない */
  next: DateStr | null;
  onConfirm: (next: DateStr) => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={next !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="w-dialog">
        <AlertDialogTitle>基準日を変更しますか</AlertDialogTitle>

        {/* 変更内容のボックス（screens.md 06b） */}
        <dl className="flex flex-col gap-8 rounded-md bg-muted p-16">
          <div className="flex items-baseline justify-between gap-16">
            <dt className="t-body-sm text-muted-foreground">いまの基準日</dt>
            <dd className="num t-label-lg font-semibold text-foreground">
              {formatYearMonthDay(current)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-16">
            <dt className="t-body-sm text-muted-foreground">変更後</dt>
            <dd className="num t-label-lg font-semibold text-foreground">
              {next ? formatYearMonthDay(next) : ""}
            </dd>
          </div>
        </dl>

        <AlertDialogDescription asChild>
          <div className="flex flex-col gap-8">
            <p>この日付より前の実績は、残高の計算から外れます。</p>
            <p>
              口座の残高は「{next ? formatYearMonthDay(next) : ""}
              時点の残高」として読み直されます。
            </p>
          </div>
        </AlertDialogDescription>

        <Callout tone="caution">
          入力済みの金額の意味が変わるため、口座とカードの残高を入れ直す必要があります。
        </Callout>

        {/* **変更前の日付をもう一度出す。** 変更後の画面には残らない */}
        <p className="t-body-sm text-muted-foreground">
          元に戻すには、基準日を{" "}
          <span className="num t-label text-foreground">
            {formatYearMonthDay(current)}
          </span>{" "}
          に設定し直してください。この日付は変更後の画面に残りません。
        </p>

        <AlertDialogFooter>
          {/* 初期フォーカスは「やめる」。取り返しのつかない操作なので */}
          <AlertDialogCancel asChild>
            <Button variant="outline" autoFocus>
              やめる
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onClick={() => next && onConfirm(next)}>
              基準日を変更する
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
