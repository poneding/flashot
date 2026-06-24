/** @vitest-environment jsdom */
import { installGlobalContextMenuBlocker } from "@/lib/context-menu";
import { afterEach, describe, expect, it } from "vitest";

let cleanup: (() => void) | null = null;

describe("global context menu blocking", () => {
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("prevents the default WebView context menu anywhere in the app", () => {
    cleanup = installGlobalContextMenuBlocker(window);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
