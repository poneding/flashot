import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsSection({
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2 rounded-md border border-border/70 p-3", className)}>
      {/* <h2 className="text-sm font-semibold text-foreground">{title}</h2> */}
      {children && <div className="space-y-2.5">{children}</div>}
    </section>
  );
}
