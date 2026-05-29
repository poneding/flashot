import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCENT_OPTIONS = [
  { id: "amber", name: "Amber", value: "#F59E0B" },
  { id: "cyan", name: "Cyan", value: "#4ED1FF" },
  { id: "rose", name: "Rose", value: "#F43F5E" },
  { id: "emerald", name: "Emerald", value: "#10B981" },
  { id: "violet", name: "Violet", value: "#8B5CF6" },
] as const;
type AccentName = (typeof ACCENT_OPTIONS)[number]["id"];

export function AccentColorSelect({
  value,
  onChange,
  ariaLabel = "Accent color",
  optionLabel = (name) => `Accent color: ${name}`,
  colorNames,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  optionLabel?: (name: string) => string;
  colorNames?: Partial<Record<AccentName, string>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={ariaLabel}>
      {ACCENT_OPTIONS.map((option) => {
        const selected = option.value.toLowerCase() === value.toLowerCase();
        const name = colorNames?.[option.id] ?? option.name;

        return (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={optionLabel(name)}
            title={name}
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
