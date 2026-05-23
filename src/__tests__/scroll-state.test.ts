import { describe, expect, it, beforeEach } from "vitest";
import { useOverlay } from "@/overlay/state";

function reset() {
  useOverlay.getState().end();
}

describe("scroll state transitions", () => {
  beforeEach(() => reset());

  it("startScroll moves committed → scrolling", () => {
    const s = useOverlay.getState();
    s.commit({ x: 0, y: 0, width: 200, height: 200 });
    expect(useOverlay.getState().mode).toBe("committed");
    s.startScroll();
    expect(useOverlay.getState().mode).toBe("scrolling");
  });

  it("startScroll is a no-op from non-committed modes", () => {
    useOverlay.getState().startScroll();
    expect(useOverlay.getState().mode).toBe("idle");
  });

  it("end() from scrolling returns to idle", () => {
    const s = useOverlay.getState();
    s.commit({ x: 0, y: 0, width: 200, height: 200 });
    s.startScroll();
    s.end();
    expect(useOverlay.getState().mode).toBe("idle");
  });
});
