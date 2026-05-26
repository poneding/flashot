import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsSection({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 rounded-lg border border-border/70 p-4", className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children && <div className="space-y-3">{children}</div>}
    </section>
  );
}
