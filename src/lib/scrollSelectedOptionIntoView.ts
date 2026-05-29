export function scrollSelectedOptionIntoView(container: HTMLElement | null) {
  const selected = container?.querySelector<HTMLElement>("[data-selected='true']");
  if (typeof selected?.scrollIntoView !== "function") return;
  selected.scrollIntoView({ block: "center", inline: "nearest" });
}
