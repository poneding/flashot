export function installGlobalContextMenuBlocker(target: EventTarget = window): () => void {
  const preventContextMenu = (event: Event) => {
    event.preventDefault();
  };

  target.addEventListener("contextmenu", preventContextMenu, true);
  return () => target.removeEventListener("contextmenu", preventContextMenu, true);
}
