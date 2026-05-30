import { useStoredAccentColor } from "@/settings/useStoredAccentColor";

export function ScrollOutlineRoute() {
  useStoredAccentColor();

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "var(--flashot-accent)",
      }}
    />
  );
}
