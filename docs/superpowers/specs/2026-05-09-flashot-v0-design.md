# Flashot V0 — Design Spec

| | |
|---|---|
| **Status** | Draft, pending user review |
| **Author** | Claude (brainstormed with the project owner) |
| **Date** | 2026-05-09 |
| **Scope** | V0 only. V1–V3 are out of scope for this document. |
| **Hand-off** | After approval, this spec feeds the writing-plans skill to produce an implementation plan. |

## 1. Goal

Build a cross-platform screenshot tool — codename **Flashot** — whose core value is *speed and feel*: hotkey to overlay in under 80 ms, instant auto-detection of the window the cursor is over, a glass floating toolbar that lets the user copy or save without ever leaving the canvas. V0 is the smallest version that proves the product can hit that bar; V1 layers annotation features on top.

## 2. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Long-term platforms | All three desktop platforms (macOS + Windows + Linux) |
| **V0 platforms** | **macOS + Windows.** Linux deferred — Wayland's `xdg-desktop-portal` constraints would force a permission prompt on every capture and block real-time element detection, breaking the product's core value. |
| **Tech stack** | **Rust + Tauri 2.0**, frontend in React + Vite + Tailwind + shadcn/ui (single TS bundle reused across overlay and settings). |
| Trigger | Global hotkey (required) + tray menu item |
| Output behavior | Copy to clipboard by default. A "Save As" button in the toolbar provides the explicit save escape hatch. No silent auto-save in V0. |
| Distribution | Open source on GitHub Releases. No code signing in V0. "Check for updates" links to the Releases page. |
| **Auto-detection granularity** | **Window-level only.** Element-level (Accessibility/UIA) is deferred — its accuracy is uneven across apps and would force a system permission prompt on first launch, hurting the "install-and-go" feel. |
| Toolbar position | Below the selection, edge-aware flip (above / inside / left / right when out of room). |
| Toolbar style | Glass / translucent, follows system theme (light or dark). |
| Selection visuals | 55% dim mask, cyan crosshair pinned to cursor, cyan border + soft glow on the detected window, W×H readout pill near cursor. |
| Architecture pattern | All-WebView, resident overlays. One always-alive hidden transparent fullscreen WebView per monitor; toolbar lives inside the same WebView document as a div. |

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  flashot — single Rust process                                │
│                                                                │
│  ┌──────────────────────────  Rust core  ─────────────────┐   │
│  │  TrayMenu        ── menu bar items                     │   │
│  │  HotkeyService   ── global-hotkey, register/conflict   │   │
│  │  CaptureService  ── xcap → frozen frames per monitor   │   │
│  │  WindowProbe     ── CGWindowList / EnumWindows + cache │   │
│  │  Clipboard       ── arboard, image clipboard           │   │
│  │  FileSaver       ── PNG write, last-dir memory         │   │
│  │  SettingsStore   ── tauri-plugin-store (JSON)          │   │
│  │  WindowMgr       ── overlay/toolbar/settings lifecycle │   │
│  └─────────────────────────────────────────────────────────┘   │
│        ▲ commands       ▲ commands              ▲ commands     │
│        │ events         │ events                │              │
│  ┌─────┴───────────┐  ┌─┴────────────┐  ┌──────┴──────────┐   │
│  │ Overlay WebView │  │ Overlay WV   │  │ Settings WV     │   │
│  │ (Display 1,     │  │ (Display 2,  │  │ (lazy-create on │   │
│  │  resident,      │  │  resident,   │  │  menu click)    │   │
│  │  hidden)        │  │  hidden)     │  │                 │   │
│  └─────────────────┘  └──────────────┘  └─────────────────┘   │
│      React + Vite + Tailwind + shadcn/ui (single bundle)       │
└───────────────────────────────────────────────────────────────┘
```

Invariants:

- Single Rust process. Tauri multi-WebView. No external helpers, no native sub-windows.
- One resident overlay WebView per monitor, created hidden + click-through-on at startup. Topology changes (monitor connect/disconnect) trigger create/destroy.
- The toolbar is a `<div>` inside the overlay document, not its own window — eliminates the cross-window alignment jitter that hurts perceived smoothness.
- The Settings WebView is lazy: created when the user opens it from the tray, destroyed on close.
- A single frontend bundle is reused across overlay and settings via URL hash routing (`#/overlay/<monitor_id>`, `#/settings`).

## 4. Components

### 4.1 Rust modules

| Module | File | Responsibility | Key dependencies |
|---|---|---|---|
| `app` | `src-tauri/src/main.rs` | Tauri startup, tray assembly, window manager init | `tauri 2`, `tauri-plugin-store`, `tauri-plugin-single-instance` |
| `hotkey` | `src-tauri/src/hotkey.rs` | Register/unregister global hotkeys, conflict detection, emit `trigger_capture` | `global-hotkey 0.6+` |
| `capture` | `src-tauri/src/capture.rs` | Async snapshot of every monitor; returns `FrozenFrame { monitor_id, png_bytes, native_size, scale_factor }` | `xcap` (ScreenCaptureKit on macOS / Windows.Graphics.Capture on Win) |
| `window_probe` | `src-tauri/src/window_probe/{mod.rs,macos.rs,windows.rs}` | Platform-specific top-level window enumeration; output `Vec<WindowRect>` ordered by z (front first) | `core-graphics`, `windows` |
| `clipboard` | `src-tauri/src/clipboard.rs` | Write cropped RGBA to system image clipboard | `arboard 3` |
| `saver` | `src-tauri/src/saver.rs` | Native save dialog, PNG encode + write, last-dir memory | `rfd 0.14`, `image 0.25` |
| `settings_store` | `src-tauri/src/settings_store.rs` | Read/write JSON config (hotkey, theme, last-dir, launch-at-login) | `tauri-plugin-store` |
| `window_mgr` | `src-tauri/src/window_mgr.rs` | Overlay/toolbar/settings lifecycle; monitor topology listener; capture-session RAII guard | Tauri runtime API |
| `commands` | `src-tauri/src/commands.rs` | `#[tauri::command]` surface: `crop_and_copy`, `crop_and_save`, `cancel_capture`, `get_settings`, `set_settings`, `open_settings_window`, `quit` | — |

### 4.2 Frontend modules

| Module | Path | Responsibility |
|---|---|---|
| `routes/Overlay.tsx` | overlay entry; subscribes to `frozen-frame-ready`, `windows-tree`; hosts the selection state machine |
| `overlay/FrozenLayer.tsx` | renders the frozen-frame PNG via `<img>` against an asset URL (avoids large strings entering React diffing) |
| `overlay/DimMask.tsx` | the 55% dim mask outside the selection; rendered as four positioned `<div>`s, not `clip-path` (more stable across GPU layers) |
| `overlay/Crosshair.tsx` | cyan crosshair that follows mousemove with a 7px center dot |
| `overlay/DetectHighlight.tsx` | the cyan rectangle that highlights the hit-tested window |
| `overlay/SelectionBox.tsx` | committed selection: border, 8 handles, position+size readout pill |
| `overlay/Toolbar.tsx` | glass toolbar with edge-aware positioning |
| `overlay/state.ts` | Zustand store: `mode: idle\|hover\|dragging\|committed`, `rect`, `windowsTree`, `frozenFrameUrl` |
| `routes/Settings.tsx` | settings page: HotkeyRecorder, theme select, launch-at-login switch |
| `lib/ipc.ts` | typed `invoke`/`listen` wrappers |
| `lib/hit-test.ts` | pure: given `Point` + `WindowRect[]`, return the top-most enclosing rect |
| `lib/geometry.ts` | toolbar flip math, handle hit-testing, DPI-aware coordinate conversion |

### 4.3 Module boundaries

- Rust holds zero UI state — mode, cursor position, and selection rect live only in the frontend store.
- The frontend never calls OS APIs — every privileged op (enumerate, capture, clipboard, save) is a command.
- Frozen-frame raw RGBA stays in Rust memory; cropping happens in Rust (frontend sends the rect), so large pixel buffers cross IPC at most once per save.

## 5. Data flow — a single capture session

```
T₀  hotkey pressed (Cmd+Shift+X / Ctrl+Shift+X)
    │
    ▼
T₀+0 HotkeyService.on_pressed → window_mgr.begin_capture()
    │
    ├─► tokio::join! ─────────────────────────────────────┐
    │     • capture.snapshot_all()  → Vec<FrozenFrame>    │
    │     • window_probe.enumerate() → Vec<WindowRect>    │
    │   typically 30–60 ms total                          │
    ◄─────────────────────────────────────────────────────┘
    │
T₁  Rust:
    • encode RGBA → PNG, expose via Tauri asset protocol (zero-copy)
    • emit "capture:start" per overlay window:
        { monitor_id, frame_url, monitor_rect, scale_factor, windows }
    • show() + setIgnoreCursorEvents(false)
    │
    ▼
T₁+δ Frontend:
    • <FrozenLayer> attaches the asset URL
    • store: mode = 'hover'
    │
    ▼ (mousemove)
    hit-test cached windows[] → top match → <DetectHighlight>
    │
    ▼ (click on detection)        ▼ (drag)
    rect = detected window         rect = drag bbox
    mode = 'committed'              mode = 'dragging' → 'committed' on mouseup
    │
    ▼
T₂  mode='committed':
    • <SelectionBox> with handles
    • <Toolbar> positions itself with flip math
    │
    ▼ (Copy / Save As / Esc / right-click)
    invoke("crop_and_copy" | "crop_and_save" | "cancel_capture")
    │
    ▼
T₃  Rust:
    crop_and_copy: frame.rgba.crop(rect) → arboard.set_image → ack
    crop_and_save: rfd.save_dialog → image::save_buffer PNG → ack
    cancel:        no-op
    Then unconditionally:
      window_mgr.end_capture():
        • all overlays hide() + setIgnoreCursorEvents(true)
        • drop frozen frames
        • emit "capture:end" → frontend store reset to idle
```

### 5.1 Performance budget

| Stage | Target | Measurement |
|---|---|---|
| hotkey → "capture:start" emit | < 60 ms | Rust tracing span |
| emit → first overlay paint | < 20 ms | RAF mark |
| **hotkey → first paint (perceived)** | **< 80 ms** | end-to-end |
| selection drag frame rate | 60 fps steady | RAF + perf trace |
| Copy → clipboard ready | < 50 ms | invoke roundtrip |
| Peak memory during a session (4K × 2 monitors) | < 200 MB | Instruments / Performance Monitor |

### 5.2 Multi-monitor

Each monitor has its own overlay and its own selection state. Cursor entering a different monitor activates that overlay's interactivity. **No cross-monitor selection in V0** — entering a new monitor cancels any in-progress drag in the previous one, restarting from the new entry point. Cross-monitor drag is a V1 candidate.

## 6. Error handling

Design principle: **the user never sees "crashed" or "stuck".** Every failure degrades to a recoverable neutral state. Critical failures surface as toasts, not modals.

### 6.1 Rust-side failures

| Failure | Handling | UX |
|---|---|---|
| `xcap` capture fails (permission denied / API unavailable) | Probe at first launch. On failure, tray shows a red dot and offers to open System Settings → Screen Recording | macOS: first hotkey press triggers the system permission grant; on deny, tray red dot stays |
| Hotkey registration fails (in use by another app) | Try preferred → fallback (`Cmd/Ctrl+Shift+1`) → none. Settings page surfaces the conflict. | Tray submenu reflects the active hotkey; settings page shows a conflict toast |
| Window enumeration fails / partial | Silent degradation — `windows: []` still works; user just loses auto-detection and drags manually | No visible error |
| Clipboard write fails (rare, system contention) | One retry, then `Copy failed, please retry` toast | Toast; capture session stays open |
| Save dialog fails | Treat as user cancel; selection state preserved | No prompt |
| Display topology change (unplug / lock / external connect) | Listen to `available_monitors()`; rebuild affected overlays. Active capture session cancels. | A capture session in progress cancels and returns to idle |
| Rust panic | `set_hook` writes to `~/.flashot/logs/`, one-shot toast, process kept alive by Tauri runtime | Toast: `Internal error, log written` |

### 6.2 Frontend failures

| Scenario | Handling |
|---|---|
| `frozen-frame-ready` event late (>200 ms) | Show light spinner placeholder; cancel session if still missing at 1 s |
| Asset URL fails to load (very rare) | One `recapture` invoke; on second failure, cancel + toast |
| Zero-size selection (single click without drag) | Use detected window if one is hovered; otherwise stay in `hover` |
| Esc key / right-click | Cancel the capture session in any state |
| Toolbar flip cannot find any position (tiny screen) | Center it at screen bottom-middle, semi-transparent |
| Cmd/Ctrl+C outside `committed` state | Ignore — do not steal the system shortcut |

### 6.3 Observability

- Rust uses `tracing` + `tracing-subscriber` writing JSON to `~/.flashot/logs/flashot-YYYYMMDD.log`, rotated at 7 days
- Key spans: `hotkey.fired`, `capture.snapshot`, `window.enumerate`, `command.crop_and_copy` — each with elapsed ms
- No remote telemetry / Sentry in V0. Open-source users attach logs to issues.

### 6.4 Lifecycle invariant

Every capture session must call `window_mgr.end_capture()` exactly once on every exit path (success, failure, cancel). Enforced via a Rust RAII guard wrapping the session — drop runs `end_capture` even on panic. This is what guarantees the screen is never "left dimmed".

## 7. Testing strategy

Honest about what is and isn't automatable: the core feel of a screenshot tool — detection accuracy, visual smoothness, cross-DPI rendering — is mostly verified by humans.

### 7.1 Pure-function unit tests (automated)

| Module | Cases | Tool |
|---|---|---|
| `lib/hit-test.ts` | top z-order match, empty list, off-screen cursor, nested windows | Vitest |
| `lib/geometry.ts` | toolbar flip across 5 positions, handle hit-testing, DPI conversion | Vitest |
| Rust `capture::crop` | RGBA + rect → correct dimensions and bytes; out-of-range rect clamps | `cargo test` |
| Rust `saver::resolve_path` | last-dir memory, timestamp filename format, conflict rename | `cargo test` |
| Rust `window_probe` parsing | platform output deserialization (fixture JSON), stable z-order | `cargo test` |

Coverage target: pure functions ≥ 90%. No global line-coverage threshold.

### 7.2 Integration tests (semi-automated)

| Case | Approach |
|---|---|
| Rust commands roundtrip | `tauri::test::mock_app` + fake capture/clipboard backends |
| Hotkey conflict fallback | `MockHotkeyManager` injecting registration failure |
| Settings store persistence | in-memory backend + restart simulation |
| Capture session lifecycle | RAII guard tests prove `end_capture` runs on every path |

### 7.3 Manual smoke matrix (gates every release)

```
□ macOS 14 Sonoma   · MBP 14" Retina   · single screen      · all buttons
□ macOS 14 Sonoma   · + 4K external    · dual screen        · cross-screen cancels correctly
□ macOS 15 Sequoia  · MBA M2           · single screen      · all buttons
□ Windows 11 23H2   · 1080p            · single screen      · all buttons
□ Windows 11 23H2   · 4K + 1080p mixed · dual screen mixed DPI
□ Windows 10 22H2   · 1080p            · single screen      · compatibility floor
```

Per row, verify: hotkey-to-overlay feel, hover detection on common apps (VSCode, Chrome, Finder/Explorer, Terminal, system settings), 60 fps drag, clipboard pastes correctly into Slack/Word/WeChat, Save As writes correct PNG and remembers the directory, toolbar flips at all four screen edges, Esc/right-click/app-switch cancel cleanly, monitor unplug / lock / desktop switch during capture does not crash.

### 7.4 Performance benchmarks (automated)

Criterion benches run in CI on every PR — regressions block.

| Bench | Threshold (p95) |
|---|---|
| `capture_snapshot_4k_single` | < 50 ms |
| `window_enumerate` | < 10 ms |
| `crop_4k_rect` | < 8 ms |
| `clipboard_set_image_2k` | < 30 ms |

### 7.5 Explicitly out of scope

- End-to-end UI automation (Playwright et al. break on always-on-top transparent windows + global hotkeys)
- Visual regression (a screenshot tool screenshotting itself is meta-circular and noisy)
- Fuzzing (V0 has no complex user-input parsing)

## 8. V0 deliverables

### 8.1 Must-have features

- Global hotkey trigger (macOS `Cmd+Shift+X` / Windows `Ctrl+Shift+X`, configurable in settings)
- Tray menu: `Capture` `Settings…` `Check for updates` `About` `Quit`
- On trigger: freeze full screen, 55% dim, cyan crosshair + W×H readout
- Hover auto-detection at the **window level** with cyan highlight
- Click on a detected window → take its rect; drag → custom rect
- Once committed: 8 handles for resize, body-drag for translate
- Glass toolbar, system-theme-aware, edge-aware positioning
- Toolbar buttons: Copy, Save As, Close
- Shortcuts: `Cmd/Ctrl+C` = Copy; `Esc` or right-click = Cancel
- Multi-monitor (per-screen overlay, no cross-screen drag)
- Settings page: hotkey edit, theme (system/light/dark), launch-at-login
- "Check for updates" opens GitHub Releases page (no in-app updater in V0)
- "About" shows version + repo link
- Single-instance enforcement (`tauri-plugin-single-instance`)
- macOS first-launch screen-recording permission flow

### 8.2 Explicit non-goals for V0

- Element-level detection (V0.5+)
- Linux (V1+)
- Annotation features — draw/arrow/text/blur/highlight (V1)
- Numbered marks / magnifier / color picker / emoji / Pin (V2)
- Grayscale / brightness adjustments / scrolling capture (V3)
- Cross-monitor selection
- Auto-save to a default directory (Save As only)
- Code signing / notarization (README documents Gatekeeper/SmartScreen bypass)
- Auto-update mechanism (Tauri Updater wired-but-disabled)
- Telemetry / crash reporting
- More than zh-CN + en localization

### 8.3 Defaults

| Item | Default |
|---|---|
| macOS hotkey | `Cmd+Shift+X` |
| Windows hotkey | `Ctrl+Shift+X` |
| Theme | follow system |
| Dim opacity | 55% (not user-configurable) |
| Selection / detection color | `#4ED1FF` |
| Toolbar corner radius | 10 px |
| Toolbar button gap | 5 px |
| Toolbar offset from selection | 8 px |
| Save As format | PNG (V0 only) |
| Save As directory | last-used; first-time = `~/Pictures/Flashot/` |
| Filename | `Flashot_YYYY-MM-DD_HH-mm-ss.png` |
| Launch at login | off |
| Single-instance | on |
| App ID | `dev.flashot.app` |
| App name | `Flashot` |
| License | MIT |

### 8.4 Project layout

```
flashot/
├── src/                       # React frontend
│   ├── routes/
│   │   ├── Overlay.tsx
│   │   └── Settings.tsx
│   ├── overlay/
│   ├── settings/
│   ├── lib/                   # ipc, hit-test, geometry
│   ├── styles/
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── hotkey.rs
│   │   ├── capture.rs
│   │   ├── window_probe/
│   │   │   ├── mod.rs
│   │   │   ├── macos.rs
│   │   │   └── windows.rs
│   │   ├── clipboard.rs
│   │   ├── saver.rs
│   │   ├── settings_store.rs
│   │   ├── window_mgr.rs
│   │   └── commands.rs
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   └── icons/
├── benches/                   # criterion benches
├── docs/superpowers/specs/
├── package.json               # pnpm
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

### 8.5 Dependency baseline

| Dependency | Version |
|---|---|
| Rust | stable 1.83+ |
| Tauri | 2.x latest stable |
| Node | 20 LTS |
| React | 18 |
| Vite | 5 |
| Tailwind | 3 |
| shadcn/ui | latest |
| xcap | latest |
| global-hotkey | 0.6+ |
| arboard | 3 |
| rfd | 0.14 |
| image | 0.25 |

### 8.6 Definition of done

1. Manual smoke matrix (six rows) all pass
2. All four criterion benches pass on CI
3. macOS 14+ / Windows 10+: install-to-first-screenshot in under five minutes against the README demo gif
4. Every shortcut, setting, and tray item reachable
5. README documents permission flow (Gatekeeper / SmartScreen / macOS screen recording)
6. Repository public on GitHub; CI green

## 9. Risks and unknowns

| Risk | Mitigation |
|---|---|
| Resident transparent WebView GPU cost on Win11 + multiple 4K monitors | Build a 1-day spike before locking the architecture: measure idle GPU%, idle VRAM, and hotkey-to-paint timing. Fall back to spawn-on-trigger overlays if idle cost > 1% GPU on a typical setup. |
| `xcap` regressions on macOS Sequoia / Sonoma | Pin to a known-good version; integration test on both during smoke matrix |
| Global hotkey conflicts with productivity tools (Raycast, PowerToys) | Conflict-tolerant fallback chain; Settings page shows the active binding clearly |
| First-launch macOS permission flow rejected by user | Tray red-dot + persistent reminder; Settings page has a "re-request" button |
| WebView2 missing on stripped-down Windows installs | Tauri ships the bootstrapper; document it in the README troubleshooting section |

## 10. What happens after this spec

1. User reviews this document and either approves it or requests edits.
2. On approval, the writing-plans skill produces a detailed task-by-task implementation plan.
3. Implementation proceeds against that plan with test-driven steps and review checkpoints.

V1 features are explicitly *not* part of this work. They become a separate spec when V0 ships.
