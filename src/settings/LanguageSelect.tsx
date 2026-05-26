import type { Settings } from "@/lib/types";

type Language = Settings["language"];

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "system", label: "System" },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "Simplified Chinese" },
];

export function LanguageSelect({
  value,
  onChange,
}: {
  value: Language;
  onChange: (value: Language) => void;
}) {
  return (
    <select
      id="settings-language"
      aria-label="Language"
      className="h-8 w-40 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      value={value}
      onChange={(event) => onChange(event.target.value as Language)}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
