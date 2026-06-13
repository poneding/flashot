# Scroll Capture

Scroll capture lets you capture content that extends beyond the visible viewport — such as long web pages, documents, or chat histories — by automatically stitching multiple frames together.

## How It Works

1. **Select a region** on the screen to capture.
2. Click the **Scroll** button in the action toolbar (note: the selected region must be at least 100px tall).
3. A translucent overlay appears, prompting you to **scroll the content**.
4. Start scrolling the target window — Flashot automatically captures frames as you scroll.
5. A progress pill shows the current **frame count** and **total height**.
6. Click the **green check button** (✓) in the bottom-right corner, or press the scroll capture finish key, to complete the capture.

The captured frames are stitched together into a single tall image, which is then saved or copied.

## Scroll Chrome UI

During a scroll session, a "scroll chrome" window appears with:

- **Live preview** — The captured frames stack vertically with smooth transitions
- **Status pill** — Shows `X frames · Y px` at the bottom center
- **Finish button** — Green check button to end the capture
- **Auto-stop** — The session automatically finishes if the maximum height is reached

## Technical Details

- Frames are captured every few hundred milliseconds as you scroll.
- Each frame is compared against the previous one using a scoring algorithm to detect new content.
- Only frames with sufficient new content are kept (deduplication).
- Frames are stitched by scanning for the optimal seam between overlapping content.
- The scroll stitching uses CPU-based NCC (Normalized Cross-Correlation) scoring for seam detection.

## Tips

- **Scroll smoothly** — Steady, moderate scrolling produces the best stitching results.
- **Select the right region** — The captured region should cover the content area but exclude fixed headers/footers if possible.
- The minimum selection height is 100px.
- The maximum stitched height depends on available memory and content.
