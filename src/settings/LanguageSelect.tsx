import type { Settings } from "@/lib/types";

type Language = Settings["language"];

const DEFAULT_LANGUAGE_LABELS: Record<Language, string> = {
  system: "System",
  en: "English",
  "zh-CN": "Simplified Chinese",
};

export function LanguageSelect({
  value,
  onChange,
  ariaLabel = "Language",
  labels = DEFAULT_LANGUAGE_LABELS,
}: {
  value: Language;
  onChange: (value: Language) => void;
  ariaLabel?: string;
  labels?: Record<Language, string>;
}) {
  const options: Array<{ value: Language; label: string }> = [
    { value: "system", label: labels.system },
    { value: "en", label: labels.en },
    { value: "zh-CN", label: labels["zh-CN"] },
  ];

  return (
    <select
      id="settings-language"
      aria-label={ariaLabel}
      className="h-8 w-40 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      value={value}
      onChange={(event) => onChange(event.target.value as Language)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
