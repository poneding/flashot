import { describe, it, expect, beforeEach } from "vitest";
import { useOverlay } from "@/overlay/state";

describe("ocr phase state", () => {
  beforeEach(() => {
    useOverlay.getState().setOcrPhase({ kind: "idle" });
    useOverlay.getState().setLastOcrResult(null);
  });

  it("starts in idle phase", () => {
    expect(useOverlay.getState().ocr).toEqual({ kind: "idle" });
  });

  it("transitions through download -> recognize -> result", () => {
    const s = useOverlay.getState();
    s.setOcrPhase({ kind: "confirming-download", sizeBytes: 15_000_000 });
    expect(useOverlay.getState().ocr.kind).toBe("confirming-download");
    s.setOcrPhase({ kind: "downloading", progress: 0.3, downloadedBytes: 4_500_000, totalBytes: 15_000_000 });
    expect(useOverlay.getState().ocr.kind).toBe("downloading");
    s.setOcrPhase({ kind: "recognizing" });
    expect(useOverlay.getState().ocr.kind).toBe("recognizing");
    s.setOcrPhase({
      kind: "result",
      result: { full_text: "hi", lines: [], elapsed_ms: 100 },
    });
    expect(useOverlay.getState().ocr.kind).toBe("result");
  });
});
