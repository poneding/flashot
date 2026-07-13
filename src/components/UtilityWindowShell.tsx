import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type UtilityWindowName = "settings" | "about" | "updater" | "flashot";

export function UtilityWindowShell({
  windowName,
  children,
  className,
  contentClassName,
}: {
  windowName: UtilityWindowName;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <main
      data-utility-window-shell={windowName}
      className={cn("h-full bg-background p-4 text-foreground", className)}
    >
      <div
        data-utility-window-content
        className={cn("mx-auto h-full w-full", contentClassName)}
      >
        {children}
      </div>
    </main>
  );
}
