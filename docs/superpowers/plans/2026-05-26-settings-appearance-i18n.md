# Settings Appearance And i18n Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the settings window, add accent color and language settings, introduce a lightweight i18n layer, and unify the title/body treatment for menu-bar-opened utility windows.

**Architecture:** Extend persisted settings in Rust and TypeScript, add frontend i18n dictionaries, apply appearance settings through document-level CSS variables, refactor the settings route into compact reusable sections, and share cohesive window-shell styling across Settings, About, and Updater.

**Tech Stack:** React, TypeScript, Tauri settings store, CSS variables, Vitest, React Testing Library, Rust serde tests.

---

## File Structure

- Modify: `src/lib/types.ts`
- Modify: `src-tauri/src/settings_store.rs`
- Modify: `src/routes/Settings.tsx`
- Create: `src/settings/AccentColorSelect.tsx`
- Create: `src/settings/LanguageSelect.tsx`
- Create: `src/settings/SettingsSection.tsx`
- Create or modify: shared utility-window shell/style for Settings, About, and Updater if it reduces duplication.
- Create: `src/i18n/index.ts`
- Create: `src/i18n/en.ts`
- Create: `src/i18n/zh-CN.ts`
- Modify: `src/styles/globals.css`
- Modify: `src/lib/colors.ts`
- Modify: `src/routes/Pin.tsx`
- Modify: `src/routes/About.tsx`
- Modify: `src/routes/Updater.tsx`
- Modify: `src/overlay/SelectionBox.tsx`
- Modify: `src/overlay/DetectHighlight.tsx`
- Test: `src/__tests__/settings.test.tsx`
- Test: `src/__tests__/color-picker.test.ts` if shared color helpers change.
- Test: `src/__tests__/toolbar.test.tsx`
- Test: Rust tests in `src-tauri/src/settings_store.rs`

## Chunk 1: Settings Schema

### Task 1: Extend settings model

- [ ] **Step 1: Write failing Rust and TypeScript tests**

Assert missing `accentColor` defaults to the current cyan and missing `language` defaults to `system`.

- [ ] **Step 2: Update TypeScript settings type**

Add `accentColor` and `language` to `src/lib/types.ts` and local defaults in `Settings.tsx`.

- [ ] **Step 3: Update Rust settings store**

Add serde-defaulted fields in `src-tauri/src/settings_store.rs`.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test src/__tests__/settings.test.tsx
cd src-tauri && cargo test settings_store
```

Expected: PASS.

## Chunk 2: i18n Foundation

### Task 2: Add dictionaries and translation hook

- [ ] **Step 1: Write failing i18n tests**

Create tests for direct lookup, missing-key fallback, and `system` language resolution.

- [ ] **Step 2: Implement dictionaries**

Add `src/i18n/en.ts` and `src/i18n/zh-CN.ts` with settings labels first. Keep keys stable and namespaced, for example `settings.shortcuts.title`.

- [ ] **Step 3: Implement `src/i18n/index.ts`**

Expose `resolveLocale`, `createTranslator`, and a React hook if needed.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/settings.test.tsx`

Expected: PASS.

## Chunk 3: Settings UI Refactor

### Task 3: Rebuild settings layout

- [ ] **Step 1: Write failing UI tests**

Assert settings renders Shortcuts, Capture, Appearance, and General groups; saving includes all fields; Settings uses the cohesive title/body surface.

- [ ] **Step 2: Create section components**

Implement `SettingsSection`, `AccentColorSelect`, and `LanguageSelect`.

- [ ] **Step 3: Refactor `SettingsRoute`**

Keep current behavior for hotkeys, theme, launch-at-login, reset, and save.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/settings.test.tsx`

Expected: PASS.

## Chunk 4: Accent Application

### Task 4: Replace hard-coded accent usage

- [ ] **Step 1: Write failing accent tests**

Assert selecting an accent color updates a document CSS variable and save payload.

- [ ] **Step 2: Add CSS variables**

In `globals.css`, expose accent variables used by screenshot border, labels, annotation active states, and pin shadow.

- [ ] **Step 3: Update consumers**

Replace hard-coded `SELECTION_COLOR` usage where practical with CSS-variable-aware styles in `SelectionBox`, `DetectHighlight`, annotation toolbar active bottom border, top-left width-by-height label, primary buttons in Settings/Updater/About, and `PinRoute` border/shadow.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test src/__tests__/settings.test.tsx src/__tests__/toolbar.test.tsx src/__tests__/pin-route.test.tsx
pnpm test
```

Expected: PASS.

## Chunk 5: Utility Window Title/Body Merge

### Task 5: Apply cohesive window shell to menu-bar windows

- [ ] **Step 1: Write failing UI tests**

Assert Settings, About, and Updater use the shared utility-window shell/style and no longer render a hard title/body split.

- [ ] **Step 2: Implement shared shell/style**

Use a compact single-surface layout for menu-bar-opened utility windows. Keep headings visible but visually connected to the body content.

- [ ] **Step 3: Update routes**

Apply the shell/style to `src/routes/Settings.tsx`, `src/routes/About.tsx`, and `src/routes/Updater.tsx`.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/settings.test.tsx src/__tests__/about.test.tsx src/__tests__/updater-window.test.tsx`

Expected: PASS.
