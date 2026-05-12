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

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", title: "System" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
];

export function ThemeSelect({
  value,
  onChange,
}: {
  value: ThemeValue;
  onChange: (v: ThemeValue) => void;
}) {
  const selected = THEME_OPTIONS.find((option) => option.value === value) ?? THEME_OPTIONS[0];

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
        <ComboboxValue placeholder="System">
          {(option: ThemeOption | null) => option?.title ?? "System"}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent>
        {THEME_OPTIONS.map((option) => (
          <ComboboxItem key={option.value} value={option}>
            {option.title}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}
