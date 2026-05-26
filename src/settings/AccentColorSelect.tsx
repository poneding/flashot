import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCENT_OPTIONS = [
  { name: "Cyan", value: "#4ED1FF" },
  { name: "Rose", value: "#F43F5E" },
  { name: "Amber", value: "#F59E0B" },
  { name: "Emerald", value: "#10B981" },
  { name: "Violet", value: "#8B5CF6" },
] as const;

export function AccentColorSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
      {ACCENT_OPTIONS.map((option) => {
        const selected = option.value.toLowerCase() === value.toLowerCase();

        return (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Accent color: ${option.name}`}
            title={option.name}
            aria-pressed={selected}
            className={cn(
              "rounded-full p-0",
              selected && "border-foreground ring-2 ring-foreground/20",
            )}
            onClick={() => onChange(option.value)}
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-full border border-black/10"
              style={{ backgroundColor: option.value }}
            />
          </Button>
        );
      })}
    </div>
  );
}
