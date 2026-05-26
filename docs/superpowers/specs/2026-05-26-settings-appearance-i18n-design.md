# Settings, Appearance, Accent Color, And i18n Design

**Status:** Draft
**Date:** 2026-05-26
**Related TODO:** `tmp/TODO.md` item 8

## Problem

The settings window is currently simple but cramped as features grow. The app also needs a coherent appearance system: theme, accent color, localized UI strings, and a less divided title/body treatment for menu-bar-opened utility windows. Accent color should drive screenshot-related highlights such as selection borders, size labels, selected annotation tools, primary buttons, and pin shadows.

## Scope

In scope:

- Refactor settings into compact groups.
- Preserve existing settings: capture hotkey, fullscreen hotkey, active-window hotkey, theme, launch-at-login, last save dir, corner radius.
- Add accent color setting.
- Add language setting with `system`, English, and Simplified Chinese.
- Apply accent color to key screenshot UI surfaces.
- Apply the title/body visual merge to Settings, About, and Updater windows.
- Add a lightweight frontend i18n layer.

Out of scope:

- Translating release notes downloaded from GitHub.
- Runtime downloading of language packs.
- Deep OS-native menu localization in the first pass.

## User-Facing Design

Settings layout uses grouped sections:

- Shortcuts
- Capture
- Appearance
- General

The layout should be denser than a landing page and fit a utility app: compact rows, predictable controls, no marketing-style cards. Theme is a segmented/select control with System, Light, Dark. Accent color is a swatch list plus custom color if already supported by shared color controls. Language is a select.

Settings, About, and Updater should share a cohesive utility-window surface where title and body feel visually connected instead of separated into hard bands.

Accent color applies to:

- screenshot selection border;
- toolbar active button bottom border;
- top-left width-by-height label text;
- primary buttons in Settings, Updater, and About;
- Pin image border/shadow;
- similar primary highlights introduced by future tools.

## Data Model

Extend shared settings:

```ts
type Settings = {
  theme: "system" | "light" | "dark";
  accentColor: string;
  language: "system" | "en" | "zh-CN";
};
```

Rust settings mirror the same fields with serde defaults.

## Architecture

Add:

- `src/i18n/index.ts` - locale detection, dictionary lookup, and hook.
- `src/i18n/en.ts`
- `src/i18n/zh-CN.ts`
- `src/settings/AccentColorSelect.tsx`
- `src/settings/LanguageSelect.tsx`
- optional `src/settings/SettingsSection.tsx`

Apply accent through CSS variables on `document.documentElement`, then replace hard-coded selection color usage with variable-aware helpers where possible. Keep Rust-independent UI color logic in the frontend. Extract shared window-shell styling only where it reduces duplication across Settings, About, and Updater.

## Testing

- Settings tests for grouped controls and save payload.
- i18n tests for fallback behavior.
- Accent tests for CSS variable application.
- Toolbar/pin tests for accent-aware styling where practical.
