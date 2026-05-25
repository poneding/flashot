import { describe, expect, it } from "vitest";
import {
  formatConfirmDownloadMessage,
  formatDownloadProgressLabel,
} from "@/routes/OcrChrome";

describe("OCR chrome download copy", () => {
  it("does not invent a package size before manifest metadata arrives", () => {
    expect(formatConfirmDownloadMessage(null)).toBe(
      "OCR needs model files. Downloaded once.",
    );
    expect(formatDownloadProgressLabel(0, null)).toBe("Preparing download...");
  });

  it("uses manifest-provided package size when available", () => {
    expect(formatConfirmDownloadMessage(15_629_724)).toBe(
      "OCR needs a ~16 MB model package. Downloaded once.",
    );
    expect(formatDownloadProgressLabel(4_745_517, 15_629_724)).toBe(
      "4.7 / 15.6 MB",
    );
  });
});
