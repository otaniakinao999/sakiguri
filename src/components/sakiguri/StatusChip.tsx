import * as React from "react";

import { Badge } from "@/components/ui/v06/badge";
import { cn } from "@/lib/utils";

export type Status = "予定" | "実績";

/** StatusChip — Figma 2007:29。予定は破線の枠、実績は塗り。 */
export function StatusChip({ status, className }: { status: Status; className?: string }) {
  return status === "実績" ? (
    <Badge variant="default" className={cn("rounded-sm", className)}>
      実績
    </Badge>
  ) : (
    <Badge variant="outline" className={cn("rounded-sm border-dashed", className)}>
      予定
    </Badge>
  );
}
