# OCR — Design Spec

- **Date**: 2026-05-24
- **Status**: Draft, awaiting review
- **Owner**: TBD
- **Target branch**: `feat/ocr`

## 1. Goal

Add offline OCR (text extraction) to Flashot so users can convert any captured
region into editable text. The feature must work on macOS, Windows, and Linux
without any network call at recognition time, must integrate cleanly with the
existing capture/overlay/Toolbar architecture, and must not regress the current
screenshot, scrolling-screenshot, or color-picker flows.

Recognition quality and latency are first-class concerns: typical screenshots
should produce results within ~250ms on accelerated hardware (CoreML on macOS,
DirectML on Windows) and ~500ms on CPU-only fallback.

## 2. Non-goals

- No third-party plugin SDK, no extension marketplace, no sandboxing. OCR is a
  built-in feature; only its model assets are downloaded on demand.
- No general "Features Tab" abstraction in Settings. The download prompt is
  inline, triggered the first time the user clicks the OCR button.
- No language other than Chinese + English in v1. Switching to other PaddleOCR
  multilingual models is left for a future iteration.
- No translation, no scan-code recognition, no handwriting recognition.
- No bounding-box overlay UI ("click a recognized line to copy just that line").
  v1 surfaces a single concatenated text buffer; per-line `bbox` is computed and
  retained in the result struct, but not yet rendered.
- No live OCR during selection drag. OCR runs only after the user has committed
  a selection.
- No history of past OCR results, no shareable link, no export beyond plain text.

## 3. User flow

1. User triggers capture (existing hotkey) and draws a selection — i.e. enters
   `committed` mode in `useOverlay`.
2. The vertical `Toolbar` now shows an additional **Extract text** icon button
   next to Copy. It is enabled whenever the existing `selectionTooSmall` check
   (≥ 60×20 logical px) passes.
3. User clicks the OCR button:
   - The frontend invokes `ocr_status`. The result determines the next state.
   - **Not installed**: an `ocr-chrome` window opens anchored to the selection
     and displays a confirmation panel:
     "OCR needs a ~15 MB model file (downloaded once). Continue?" with
     `Download` / `Cancel` buttons.
   - **Installed**: the same `ocr-chrome` window opens and displays a spinner
     while recognition runs.
4. If the user confirms the download, the panel switches to a progress view
   (`X.X / 15.0 MB`) with a `Cancel` button. Cancel deletes the partial file
   and returns to the confirmation panel.
5. When recognition completes, the panel switches to the result view: an
   editable, auto-focused, fully-selected `<textarea>` containing the
   concatenated text. The footer shows `Copy` and `Save as .txt`. The window
   header shows the elapsed time (e.g. `147 ms`).
6. Closing the chrome window (Esc, ✕, `Cmd+Enter`, or starting a new capture
   session) destroys it. `SessionGuard::drop` is responsible for tearing it
   down so it never outlives the originating session.

If the user re-clicks the OCR button on the same committed selection without
the chrome window already open, the previous result is re-displayed without
running inference again.

## 4. Architecture overview

```
existing flow (unchanged):
   hotkey → freeze all monitors → spawn overlays → user selects
          → crop_and_copy / crop_and_save / scroll / pin

new flow (OCR):
   committed mode → user clicks OCR button → ocr_status()
                  → spawn ocr-chrome window (per session)
                  ├── not installed → download confirm UI
                  │                  → ocr_install() streams ocr:download-progress
                  │                  → on success, fall through to recognize
                  └── installed    → ocr_recognize(monitor_id, rect)
                                   → backend looks up frozen frame, crops,
                                     spawns blocking task: Engine::recognize
                                   → returns OcrResult to chrome window
                                   → chrome window renders editable textarea
```

OCR runs strictly post-commit, off the main capture critical path. The
`SessionGuard` RAII pattern is extended to also close any OCR chrome window
when the session ends, mirroring how it already cleans up overlays and frozen
frames.

## 5. Backend design

### 5.1 New module: `src-tauri/src/ocr/`

```
src-tauri/src/ocr/
├── mod.rs           // public API, OcrError, OcrResult, OcrLine, TextBox
├── model.rs         // ort::Session lazy load, warm-up, install paths
├── download.rs      // one-shot model download + sha256 + atomic install
├── detector.rs      // DBNet text detection: image → Vec<TextBox>
├── recognizer.rs    // CRNN text recognition: crop → (String, confidence)
├── postprocess.rs   // reading-order sort, line concat, low-conf filter
└── types.rs         // serde-serializable structs exposed via IPC
```

The module is pure Rust with no Tauri dependency except `tauri::command`
wrappers (which live in `commands.rs`). Everything in `ocr/` is unit-testable
in isolation.

### 5.2 Core data structures

```rust
// types.rs
#[derive(Serialize, Clone)]
pub struct OcrResult {
    pub full_text: String,
    pub lines: Vec<OcrLine>,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct OcrLine {
    pub text: String,
    pub bbox: TextBox,
    pub confidence: f32,
}

#[derive(Serialize, Clone)]
pub struct TextBox {
    pub points: [(f32, f32); 4],   // four-point polygon, image-local pixels
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OcrInstallStatus {
    NotInstalled,
    Installed { size_bytes: u64 },
}

#[derive(Debug, thiserror::Error)]
pub enum OcrError {
    #[error("model not installed")]
    ModelNotInstalled,
    #[error("model load failed: {0}")]
    ModelLoadFailed(String),
    #[error("inference failed: {0}")]
    InferenceFailed(String),
    #[error("cancelled by user")]
    Cancelled,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
```

### 5.3 Engine lifecycle

```rust
// mod.rs
pub struct Engine {
    det: OnceCell<ort::Session>,
    rec: OnceCell<ort::Session>,
    rec_keys: OnceCell<Vec<String>>,
    inference_lock: Mutex<()>,
}

impl Engine {
    pub fn global() -> &'static Engine { /* OnceLock singleton */ }

    pub fn is_ready(&self) -> bool;

    /// Loads the models from disk. Idempotent. Errors with ModelNotInstalled
    /// if files are missing.
    pub async fn ensure_loaded(&self) -> Result<(), OcrError>;

    /// Synchronous, CPU-bound. Callers must invoke via tokio::task::spawn_blocking.
    pub fn recognize(&self, rgba: &[u8], width: u32, height: u32)
        -> Result<OcrResult, OcrError>;
}
```

Key invariants:

- `ort` runtime is a process-wide singleton. Sessions are loaded lazily on first
  use and kept resident (~50 MB RAM).
- `inference_lock: Mutex<()>` serializes recognition calls. `ort` is not
  thread-safe and concurrent OCR is not a real use case.
- `recognize` is intentionally blocking. The IPC command wraps it in
  `tokio::task::spawn_blocking` so the Tokio runtime stays responsive.

### 5.4 Inference pipeline

Input: a cropped RGBA buffer (the user's selection, already extracted from the
frozen frame with scale factor applied).

```
1. preprocess
   - clamp long edge to 960 px (det model input range)
   - NCHW float32, normalize: (pixel/255 - 0.5) / 0.5

2. detector::detect(image) -> Vec<TextBox>
   - run det.onnx (DBNet)
   - probability map → binarize → connected components → polygons
   - filter polygons with short edge < 3 px
   - sort polygons by reading order (top-to-bottom, then left-to-right
     within a row tolerance)

3. for each TextBox:
   - perspective-warp the polygon out of the source image into a straight
     (3, 48, W) crop where W is proportional
   - recognizer::recognize(crop) -> (text, confidence) via CRNN + CTC
     greedy decode against rec_keys character table

4. postprocess
   - concatenate into full_text with line breaks between rows
   - trim leading/trailing whitespace per line
   - drop lines with confidence < 0.5
```

Direction classification (`cls`) is **not** loaded. Screenshot text is
overwhelmingly upright; skipping cls saves 10–30% latency.

### 5.5 Model download

```rust
// download.rs
pub const MODEL_VERSION: &str = "1.0.0";

pub struct AssetSpec {
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

pub const ASSETS: &[AssetSpec] = &[
    AssetSpec { name: "det.onnx", url: "...", sha256: "...", size_bytes: ... },
    AssetSpec { name: "rec.onnx", url: "...", sha256: "...", size_bytes: ... },
    AssetSpec { name: "ppocr_keys_v1.txt", url: "...", sha256: "...", size_bytes: ... },
];

pub fn install_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap()
        .join("ocr")
        .join(MODEL_VERSION)
}

pub async fn download_all(app: &AppHandle, on_progress: impl Fn(u64, u64))
    -> Result<(), OcrError>;
```

Behaviour:

- Each asset is downloaded into a `*.partial` file under a temp directory, then
  sha256-verified, then atomically renamed into `install_dir()`.
- On any failure (network, checksum mismatch, cancel), partial files are
  removed.
- Progress is reported in bytes across all assets so the UI can show one
  combined progress bar.
- Cancellation: an `Arc<AtomicBool>` is passed through; checked between chunk
  reads and between asset downloads.
- Old versions: after successful install, asynchronously remove sibling
  directories under `{app_data}/ocr/` that are not `MODEL_VERSION`. Failure to
  clean up is non-fatal.

Asset URLs and sha256 hashes are hardcoded in this file; they bind a Flashot
binary to a specific model release. Bumping the model means a new
`MODEL_VERSION`, fresh URLs/hashes, and a new app release.

### 5.6 Tauri commands

```rust
// commands.rs additions

#[tauri::command]
async fn ocr_status(app: AppHandle) -> OcrInstallStatus;

#[tauri::command]
async fn ocr_install(app: AppHandle, window: Window) -> Result<(), String>;
// emits "ocr:download-progress" { progress: f32, downloaded_bytes: u64,
//                                total_bytes: u64 }

#[tauri::command]
async fn ocr_recognize(state: State<Arc<WindowMgr>>, monitor_id: u32, rect: Rect)
    -> Result<OcrResult, String>;
```

`ocr_recognize` takes monitor + rect rather than a base64 image so it can reuse
the existing frozen-frame storage in `WindowMgr`. The crop and scale-factor
math mirrors `crop_and_copy` / `crop_and_save`.

### 5.7 SessionGuard integration

`WindowMgr` gains an `ocr_chrome: Option<WebviewWindow>` field. `SessionGuard::end()`
closes it alongside overlays. The chrome window is registered with the
session immediately on creation so it cannot leak even if recognition or
download is in flight.

### 5.8 Dependencies (new)

```toml
[dependencies]
ort = { version = "2", features = ["coreml", "directml", "load-dynamic"] }
ndarray = "0.16"
sha2 = "0.10"
reqwest = { version = "0.12", features = ["stream"] }
imageproc = "0.25"  # perspective warp; scoped to ocr/ only
```

`ort`'s `load-dynamic` feature means onnxruntime is loaded at runtime from a
shared library that we ship in the Tauri bundle. This avoids the need to
statically link onnxruntime and keeps cross-compilation simple.

## 6. Frontend design

### 6.1 State

`src/overlay/state.ts` does **not** change its main state machine
(`idle / hover / dragging / committed`). OCR is a sub-state that runs only in
`committed`:

```ts
export type OcrPhase =
  | { kind: "idle" }
  | { kind: "confirming-download"; sizeBytes: number }
  | { kind: "downloading"; progress: number; downloadedBytes: number;
      totalBytes: number }
  | { kind: "recognizing" }
  | { kind: "result"; result: OcrResult }
  | { kind: "error"; message: string };
```

The store exposes actions: `triggerOcr()`, `confirmOcrDownload()`,
`cancelOcrDownload()`, `dismissOcr()`. Phase transitions live entirely in the
store; UI components are thin renderers.

### 6.2 Toolbar entry

`src/overlay/Toolbar.tsx` adds one new button next to `Copy`:

```tsx
<ToolbarButton
  label="Extract text (OCR)"
  icon={<TypeIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
  disabled={selectionTooSmall}
  onClick={triggerOcr}
/>
```

The button is always enabled when the selection is large enough; install
status is checked only on click.

### 6.3 New route: `src/routes/OcrChrome.tsx`

A dedicated chrome window route, mirroring the existing `ScrollChrome` pattern
but with its own state and presentation. It is opened by the backend with a
label of the form `ocr-chrome-{session_id}`.

Window geometry, anchoring, and always-on-top behaviour are shared with
`ScrollChrome` via a new helper:

- `src/lib/chrome-anchor.ts` — pure function `computeChromeAnchor(selection,
  monitor, preferredSize)` returning `{ x, y, width, height, side }`. Used by
  both routes.

#### Layout

```
┌─────────────────────────────────────┐
│ ▎ Extracted text         147 ms  ✕ │  header
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ <phase-specific body>           │ │  body
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│              [Copy]   [Save as .txt]│  footer (result phase only)
└─────────────────────────────────────┘
```

Body content per phase:

| Phase | Body |
|---|---|
| `confirming-download` | Icon + "OCR needs a ~15 MB model file. Continue?" + `Download` (primary) + `Cancel` |
| `downloading` | Progress bar + `X.X / 15.0 MB` + `Cancel` |
| `recognizing` | Spinner + "Recognizing…" |
| `result` | Editable `<textarea>` auto-focused, fully selected |
| `error` | Error message + `Retry` |

Footer buttons are visible/enabled only in the `result` phase.

### 6.4 Keyboard shortcuts (inside OcrChrome window)

- `Esc` — close the window. In `downloading` phase this also cancels the download.
- `Cmd/Ctrl+C` — copy `full_text` (works even when no selection inside the textarea).
- `Cmd/Ctrl+Enter` — copy and close.
- `Cmd/Ctrl+S` — save as `.txt`.

### 6.5 IPC wrapper

`src/lib/ipc.ts` additions:

```ts
export const ocr = {
  status: () => invoke<OcrInstallStatus>("ocr_status"),
  install: () => invoke<void>("ocr_install"),
  recognize: (monitorId: number, rect: Rect) =>
    invoke<OcrResult>("ocr_recognize", { monitorId, rect }),
  onDownloadProgress: (cb: (p: {
    progress: number; downloadedBytes: number; totalBytes: number;
  }) => void) => listen("ocr:download-progress", cb),
};
```

### 6.6 Toast messages

Reuse the existing toast channel (already used by ScrollChrome) for:

- "OCR model installed" (after successful download)
- "OCR engine failed to initialize" (rare; native library load failure)
- "Copied to clipboard" (on Copy click)

## 7. Performance characteristics

Target measurements (typical 1080p selection with ~20 lines of text):

| Configuration | Expected elapsed |
|---|---|
| macOS CoreML execution provider | 100–250 ms |
| Windows DirectML execution provider | 100–250 ms |
| CPU-only (any platform) | 200–500 ms |
| First call (cold load + warm-up) | +200–500 ms |

Optimizations applied:

- Background warm-up: on app startup, after a 2-second delay, kick off
  `Engine::ensure_loaded()` and run inference on a 1×1 dummy image to prime
  caches. Failures here are silent — they will surface again on real use.
- `cls` (direction classification) not loaded; saves 10–30%.
- Long edge capped at 960 px during preprocessing.
- Selection smaller than 60×20 px is rejected in the UI; no inference attempt.
- Mobile model variants (not server) — accuracy delta < 5%, latency ~3× better.

Subjective targets:

- Time from clicking OCR to text appearing: < 500 ms on accelerated hardware
  for typical screenshots. Above that, a spinner masks the wait.

## 8. Testing strategy

### 8.1 Rust unit tests (`cargo test`, runs in CI)

| Target | Coverage |
|---|---|
| `ocr::download` | sha256 mismatch handling, atomic-rename success, partial-file cleanup on cancel, URL/hash table consistency. Network is mocked. |
| `ocr::postprocess` | Pure functions: reading-order sort with overlapping rows, line concat with empty boxes, confidence filter. |
| `ocr::types` | Serde round-trip of `OcrResult`, `OcrInstallStatus`, `OcrError` — guards against IPC contract drift. |

### 8.2 Rust integration tests (`#[ignore]`, manual)

Location: `src-tauri/tests/ocr_integration.rs`. Require the model files
installed locally; CI skips them.

```rust
#[test]
#[ignore]
fn recognize_english_code_screenshot() { ... }

#[test]
#[ignore]
fn recognize_chinese_ui_screenshot() { ... }

#[test]
#[ignore]
fn recognize_mixed_zh_en() { ... }
```

Fixtures: three PNGs under `src-tauri/tests/fixtures/ocr/`, generated once and
committed.

### 8.3 Rust benchmarks (`cargo bench`, manual)

`src-tauri/benches/ocr_bench.rs`:

- `bench_inference_small` — 600×400, a few lines
- `bench_inference_medium` — 1080p, ~20 lines
- `bench_inference_large` — 4K, dense document

Same `#[ignore]` style as integration tests; CI does not run OCR benches.

### 8.4 Frontend tests (`vitest`)

- `src/__tests__/ocr-state.test.ts` — phase transitions:
  `idle → confirming-download → downloading → recognizing → result`,
  cancel paths, error paths.
- `src/__tests__/chrome-anchor.test.ts` — anchor math: below / above /
  overlap fallback positions across monitor edges.

### 8.5 Manual smoke-test matrix

| Scenario | macOS | Windows | Linux |
|---|---|---|---|
| First click → download → recognize | ☐ | ☐ | ☐ |
| Already installed → recognize Chinese UI | ☐ | ☐ | ☐ |
| Long multi-column code screenshot | ☐ | ☐ | ☐ |
| Selection too small → button disabled | ☐ | ☐ | ☐ |
| Cancel mid-download → partial files cleaned up | ☐ | ☐ | ☐ |
| Network failure → error + Retry | ☐ | ☐ | ☐ |
| Esc / Cmd+Enter / Cmd+S shortcuts | ☐ | ☐ | ☐ |
| New capture triggered while OCR open → chrome window closes | ☐ | ☐ | ☐ |
| Second OCR on same selection → cached result, no re-inference | ☐ | ☐ | ☐ |
| Concurrent recognize calls serialized correctly | ☐ | ☐ | ☐ |

## 9. CI / Build / Release

### 9.1 CI

No new CI jobs. The OCR module compiles in CI (`cargo check`, `cargo clippy`,
`cargo test`), but integration tests and benches are `#[ignore]`d so they
don't try to load models that aren't present.

Risk: `ort` with `load-dynamic` may emit build-time complaints if no
onnxruntime path is configured. Mitigation: set `ORT_DYLIB_PATH` to a dummy
path in the CI workflow if needed. Investigate during implementation.

### 9.2 Bundling

Each platform ships an onnxruntime shared library inside the Tauri bundle:

| Platform | File | Bundle location |
|---|---|---|
| macOS | `libonnxruntime.dylib` (~10 MB) | `Frameworks/` |
| Windows | `onnxruntime.dll` (~8 MB) | next to `flashot.exe` |
| Linux | `libonnxruntime.so` | bundle `lib/` |

Configured via `tauri.conf.json` `bundle.resources`. At startup we set
`ORT_DYLIB_PATH` to the bundled file before any OCR code runs.

Total app increment: ~10 MB. Model files (~15 MB) are downloaded at first use,
not bundled.

### 9.3 Model release process

A one-time release pipeline, repeated whenever `MODEL_VERSION` bumps:

```bash
# 1. Export PP-OCRv4 Chinese+English mobile models to ONNX, or use a
#    pre-converted set from a trusted source (e.g. the RapidOCR repo).
# 2. Validate locally with the integration tests.
# 3. Compute hashes.
sha256sum det.onnx rec.onnx ppocr_keys_v1.txt

# 4. Publish a dedicated GitHub Release.
gh release create ocr-models-v1.0.0 \
    det.onnx rec.onnx ppocr_keys_v1.txt \
    --title "OCR Models v1.0.0 (PP-OCRv4 zh+en mobile)" \
    --notes "..."

# 5. Update src-tauri/src/ocr/download.rs ASSETS[] with the new URLs and
#    sha256 values, bump MODEL_VERSION, and ship a new Flashot release.
```

The model release is decoupled from the Flashot app release, but the Flashot
binary always pins exactly one MODEL_VERSION.

### 9.4 Documentation

- `CLAUDE.md`: add `src-tauri/src/ocr/` module description, document
  `src/routes/OcrChrome.tsx` and the `ocr-chrome-{session_id}` window label
  convention, note the SessionGuard extension.
- `README.md`: add OCR to the feature list with the "offline, Chinese+English,
  ~15 MB one-time download" details.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| GitHub Release downloads are slow for users in mainland China | Out of scope for v1. Future: add a mirror (jsDelivr-wrapped Release, or self-hosted CDN). |
| `ort` fails to load `libonnxruntime` on some Linux distros | Surface a clear toast with the underlying error. OCR on Linux is best-effort; the rest of the app remains functional. |
| PaddleOCR struggles with handwriting or stylized fonts | README explicitly scopes OCR to "screen text". No promise of universal accuracy. |
| Stale model directories accumulate across version bumps | `download.rs` asynchronously prunes sibling versions after a successful install. |
| User cancels download mid-stream | Cancel flag plus `.partial` file naming ensures no half-written models become installed. |
| Concurrent OCR triggered (e.g. user re-clicks while inference is running) | Inference mutex serializes; UI ignores duplicate triggers while in `recognizing` phase. |
| Large screenshots (4K densely packed) exceed reasonable latency | Long edge cap at 960 px; large inputs show a spinner and complete within 600–1200 ms in the worst case. |

## 11. Out of scope (future iterations)

- Per-line bbox-aware UI (click a line, copy that line; visual highlight on
  hover).
- Additional language packs (Japanese, Korean, multilingual).
- Server-quality model variants for higher accuracy.
- Translation built on top of recognized text.
- Per-image OCR caching across sessions.
- Offline mirror / alternate download source.
