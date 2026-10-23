import * as React from "react";

import { Badge } from "@/components/ui/v06/badge";
import { cn } from "@/lib/utils";

export type Status = "予定" | "実績";

/**
 * StatusChip — Figma 2007:29。予定は破線の枠、実績は塗り。
 *
 * **同じ色相の濃淡で対にする。** 予定と実績は1つのものの2つの状態なので、
 * 別の色を当てずに、ブランド色の破線（予定）と塗り（実績）で差を付ける。
 * 枠線だけの区分タグ（振替・カード引落）とは、色と破線で見分けが付く。
 */
export function StatusChip({ status, className }: { status: Status; className?: string }) {
  return status === "実績" ? (
    <Badge variant="default" className={cn("rounded-sm", className)}>
      実績
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className={cn(
        "rounded-sm border-dashed border-border-primary-subtle text-fg-primary",
        className,
      )}
    >
      予定
    </Badge>
  );
}
