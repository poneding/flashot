# Full English And Chinese i18n Design

**Status:** Approved
**Date:** 2026-05-28

## Problem

Flashot currently has a lightweight frontend i18n layer, but it only covers part of Settings. Most user-facing strings remain hard-coded in English across screenshot controls, annotation controls, pin windows, the updater, About, scrolling screenshot chrome, and Rust-native UI such as tray menu labels and window titles.

The language selector also exposes `system`, which makes behavior harder to reason about across frontend and Rust. The new requirement is explicit language selection only: English by default, Simplified Chinese, and Traditional Chinese with Taiwan wording.

## Goals

- Replace the language setting with `en`, `zh-CN`, and `zh-TW`.
- Default to English.
- Treat legacy `system` settings as English.
- Localize frontend user-visible strings for the main utility windows, overlay tools, annotation controls, pin controls, updater, About, color picker, and scrolling screenshot chrome.
- Localize Rust-native visible strings for tray menu labels and window titles.
- Keep the implementation lightweight and testable without introducing a full i18n dependency.

## Non-Goals

- Translating remote release notes from GitHub.
- OS locale auto-detection.
- Runtime language packs.
- Localizing developer logs or test names.

## Language Model

The persisted settings value becomes:

```ts
type Language = "en" | "zh-CN" | "zh-TW";
```

Rust mirrors this as:

```rust
enum Language {
    En,
    ZhCn,
    ZhTw,
}
```

`Settings::default()` uses English. Deserializing old JSON with `"language": "system"` should not fail; it maps to English. Missing `language` also defaults to English.

## Frontend Architecture

The existing lightweight dictionary approach stays. `src/i18n/en.ts` is the source of truth for keys; `zh-CN.ts` and `zh-TW.ts` must satisfy the same key shape. `createTranslator(language)` returns the requested translation and falls back to English for defensive runtime behavior.

Add a small React-facing helper so routes and floating controls can resolve current language from settings:

- Settings reads its local draft directly.
- Utility windows use stored appearance/settings hooks.
- Overlay, pin, and scroll chrome can either load stored language once or use a shared hook that subscribes to `settings:changed`.

Keep shortcut formatting platform-aware. Only the action label is localized:

- `Copy (Cmd+C)`
- `复制 (Cmd+C)`
- `複製 (Cmd+C)`

## Rust Architecture

Add `src-tauri/src/i18n.rs` with:

- a `Language` import from settings;
- a `NativeTextKey` enum or small match-based functions;
- `text(language, key) -> &'static str`.

Use it for:

- tray menu labels;
- Settings/About/Updater window titles;
- any short native dialog labels introduced in touched code paths.

When settings change, tray rebuild already receives settings-driven hotkeys. It should also read the current language and rebuild labels in that language.

## UI Coverage

Frontend coverage includes:

- Settings tabs, labels, controls, save/reset states.
- About route version state and GitHub button.
- Updater route states and buttons.
- Screenshot toolbar labels and tooltips.
- Corner radius panel labels.
- Image adjustment toggles, sliders, and reset.
- Color picker hints and copied feedback.
- Annotation toolbar tool names and undo/redo.
- Annotation property panel labels and dropdown labels.
- Pin image alt text, controls, scale labels, and feedback.
- Scroll screenshot chrome status, toast, and buttons.

Rust coverage includes:

- tray menu: capture region, capture screen, capture window, settings, updates, about, quit;
- utility window titles.

## Testing

Frontend tests should prove:

- dictionaries have complete matching keys;
- default language is English and `system` is no longer a valid frontend option;
- Settings renders no System language option;
- Settings can save `zh-TW`;
- representative routes render zh-CN and zh-TW strings;
- shortcut labels preserve platform modifiers while localizing action words.

Rust tests should prove:

- default language is English;
- legacy `"system"` deserializes to English;
- `zh-TW` serializes as `"zh-TW"`;
- native i18n returns Taiwan wording for tray labels and window titles.

## Migration

No explicit migration file is needed. Serde deserialization handles legacy values, and the next save writes the new language value.
