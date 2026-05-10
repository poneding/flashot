import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ThemeSelect({
  value,
  onChange,
}: {
  value: "system" | "light" | "dark";
  onChange: (v: "system" | "light" | "dark") => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as "system" | "light" | "dark")}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="system">System</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  );
}
