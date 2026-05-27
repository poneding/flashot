import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import type { Settings } from "@/lib/types";

type Language = Settings["language"];

type LanguageOption = {
  value: Language;
  title: string;
};

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
  const options: LanguageOption[] = [
    { value: "system", title: labels.system },
    { value: "en", title: labels.en },
    { value: "zh-CN", title: labels["zh-CN"] },
  ];

  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <Combobox<LanguageOption>
      value={selected}
      onValueChange={(option) => {
        if (option) onChange(option.value);
      }}
      itemToStringLabel={(option) => option.title}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(option, current) => option.value === current.value}
    >
      <ComboboxTrigger className="w-40" aria-label={ariaLabel}>
        <ComboboxValue placeholder={labels.system}>
          {(option: LanguageOption | null) => option?.title ?? labels.system}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent>
        {options.map((option) => (
          <ComboboxItem key={option.value} value={option}>
            {option.title}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}
