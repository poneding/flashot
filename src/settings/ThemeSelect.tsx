import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";

type ThemeValue = "system" | "light" | "dark";

type ThemeOption = {
  value: ThemeValue;
  title: string;
};

const DEFAULT_THEME_LABELS: Record<ThemeValue, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeSelect({
  value,
  onChange,
  labels = DEFAULT_THEME_LABELS,
}: {
  value: ThemeValue;
  onChange: (v: ThemeValue) => void;
  labels?: Record<ThemeValue, string>;
}) {
  const options: ThemeOption[] = [
    { value: "system", title: labels.system },
    { value: "light", title: labels.light },
    { value: "dark", title: labels.dark },
  ];
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <Combobox<ThemeOption>
      value={selected}
      onValueChange={(option) => {
        if (option) onChange(option.value);
      }}
      itemToStringLabel={(option) => option.title}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(option, current) => option.value === current.value}
    >
      <ComboboxTrigger className="w-40">
        <ComboboxValue placeholder={labels.system}>
          {(option: ThemeOption | null) => option?.title ?? labels.system}
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
