# Updater Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone "Check for Updates" window triggered from the tray menu, with states for checking, up-to-date, available, downloading, restart, and error.

**Architecture:** New Tauri window (`updater` label, route `#/updater`) opened via a Rust command. Frontend uses `useState` to drive a state machine that calls the existing `src/lib/updater.ts` API. Centered minimal UI with lucide-react icons.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react, @tauri-apps/plugin-updater, @tauri-apps/plugin-process, Rust/Tauri

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/routes/Updater.tsx` | Create | Updater window UI + state machine |
| `src/App.tsx` | Modify | Add `updater` route |
| `src-tauri/src/commands.rs` | Modify | Add `open_updater_window` command |
| `src-tauri/src/lib.rs` | Modify | Register command in `generate_handler!` |
| `src-tauri/src/tray.rs` | Modify | Call `open_updater_window` instead of emitting event |
| `src/__tests__/updater-window.test.tsx` | Create | Unit tests for Updater route |

---

### Task 1: Rust — Add `open_updater_window` command

**Files:**
- Modify: `src-tauri/src/commands.rs` (add constant + function after `open_about_window`)
- Modify: `src-tauri/src/lib.rs:193` (register in `generate_handler!`)

- [ ] **Step 1: Add the updater window constant and command to commands.rs**

In `src-tauri/src/commands.rs`, add after line 12 (after `SETTINGS_WINDOW_HEIGHT`):

```rust
const UPDATER_WINDOW_WIDTH: f64 = 360.0;
const UPDATER_WINDOW_HEIGHT: f64 = 280.0;
```

Then add after the `open_about_window` function (after line 173):

```rust
#[tauri::command]
pub fn open_updater_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("updater") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/updater".into());
    tauri::WebviewWindowBuilder::new(&app, "updater", url)
        .title("Check for Updates")
        .inner_size(UPDATER_WINDOW_WIDTH, UPDATER_WINDOW_HEIGHT)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Register the command in generate_handler!**

In `src-tauri/src/lib.rs`, add `commands::open_updater_window,` to the `generate_handler!` macro (after `commands::open_about_window,`):

```rust
.invoke_handler(tauri::generate_handler![
    commands::crop_and_copy,
    commands::crop_and_save,
    commands::cancel_capture,
    commands::get_settings,
    commands::set_settings,
    commands::open_settings_window,
    commands::begin_text_input_session,
    commands::end_text_input_session,
    commands::open_about_window,
    commands::open_updater_window,
    commands::quit_app,
    commands::list_system_fonts,
])
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add open_updater_window command"
```

---

### Task 2: Tray menu — Wire "Check for updates" to open the window

**Files:**
- Modify: `src-tauri/src/tray.rs:38-39` (change event handler)

- [ ] **Step 1: Replace the event emit with a direct command call**

In `src-tauri/src/tray.rs`, change the `"updates"` match arm (line 38-39) from:

```rust
"updates" => {
    let _ = app.emit("updater:check", ());
}
```

to:

```rust
"updates" => {
    let _ = crate::commands::open_updater_window(app.clone());
}
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/tray.rs
git commit -m "feat: tray 'Check for updates' opens updater window"
```

---

### Task 3: Frontend routing — Add updater route to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the updater route**

Replace the entire `src/App.tsx` with:

```typescript
import { AboutRoute } from "@/routes/About";
import { OverlayRoute } from "@/routes/Overlay";
import { SettingsRoute } from "@/routes/Settings";
import { UpdaterRoute } from "@/routes/Updater";

function parseRoute(): "about" | "overlay" | "settings" | "updater" {
  const h = window.location.hash || "";
  if (h.startsWith("#/about")) return "about";
  if (h.startsWith("#/settings")) return "settings";
  if (h.startsWith("#/updater")) return "updater";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "about") return <AboutRoute />;
  if (route === "settings") return <SettingsRoute />;
  if (route === "updater") return <UpdaterRoute />;
  return <OverlayRoute />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add updater route to App.tsx"
```

---

### Task 4: Frontend — Implement the Updater route

**Files:**
- Create: `src/routes/Updater.tsx`

- [ ] **Step 1: Create the Updater component**

Create `src/routes/Updater.tsx`:

```typescript
import { useEffect, useState, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CircleCheckIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  XCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkForUpdate, downloadAndInstall, type UpdateInfo, type UpdateProgress } from "@/lib/updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdaterState =
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "restart"
  | "error";

export function UpdaterRoute() {
  const [state, setState] = useState<UpdaterState>("checking");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null });
  const [errorMsg, setErrorMsg] = useState("");
  const [version, setVersion] = useState("");

  const doCheck = useCallback(async () => {
    setState("checking");
    setErrorMsg("");
    try {
      const info = await checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        setState("available");
      } else {
        setState("up-to-date");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
    doCheck();
  }, [doCheck]);

  const handleDownload = async () => {
    setState("downloading");
    try {
      await downloadAndInstall((p) => setProgress(p));
      setState("restart");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const handleRestart = () => {
    relaunch();
  };

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center select-none">
      {state === "checking" && (
        <>
          <LoaderCircleIcon size={36} className="animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Checking for updates…</p>
        </>
      )}

      {state === "up-to-date" && (
        <>
          <CircleCheckIcon size={36} className="text-green-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">You're up to date</p>
            <p className="text-sm text-muted-foreground">Version {version}</p>
          </div>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </>
      )}

      {state === "available" && updateInfo && (
        <>
          <ArrowUpCircleIcon size={36} className="text-blue-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">A new version is available</p>
            <p className="text-sm text-muted-foreground">v{updateInfo.version}</p>
          </div>
          {updateInfo.body && (
            <div className="max-h-[100px] w-full overflow-y-auto rounded-md bg-muted/50 p-3 text-left text-xs text-muted-foreground">
              {updateInfo.body}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Later
            </Button>
            <Button onClick={handleDownload}>Download &amp; Install</Button>
          </div>
        </>
      )}

      {state === "downloading" && (
        <>
          <ArrowDownCircleIcon size={36} className="text-blue-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Downloading…</p>
          </div>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
            {progress.total ? (
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                style={{ width: `${Math.round((progress.downloaded / progress.total) * 100)}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
            )}
          </div>
          {progress.total && (
            <p className="text-xs text-muted-foreground">
              {Math.round((progress.downloaded / progress.total) * 100)}%
            </p>
          )}
        </>
      )}

      {state === "restart" && (
        <>
          <CircleCheckIcon size={36} className="text-green-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Ready to restart</p>
            <p className="text-sm text-muted-foreground">Restart to finish updating</p>
          </div>
          <Button onClick={handleRestart}>Restart Now</Button>
        </>
      )}

      {state === "error" && (
        <>
          <XCircleIcon size={36} className="text-red-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Update check failed</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={doCheck}>
              Retry
            </Button>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `pnpm lint`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/Updater.tsx
git commit -m "feat: implement updater window UI with state machine"
```

---

### Task 5: Tests — Unit tests for the Updater route

**Files:**
- Create: `src/__tests__/updater-window.test.tsx`

- [ ] **Step 1: Create the test file**

Create `src/__tests__/updater-window.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdaterRoute } from "@/routes/Updater";

// Mock dependencies
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.2.1"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

const mockCheckForUpdate = vi.fn();
const mockDownloadAndInstall = vi.fn();

vi.mock("@/lib/updater", () => ({
  checkForUpdate: (...args: unknown[]) => mockCheckForUpdate(...args),
  downloadAndInstall: (...args: unknown[]) => mockDownloadAndInstall(...args),
}));

describe("UpdaterRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows checking state on mount", () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {})); // never resolves
    render(<UpdaterRoute />);
    expect(screen.getByText("Checking for updates…")).toBeInTheDocument();
  });

  it("shows up-to-date when no update available", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("You're up to date")).toBeInTheDocument();
    });
    expect(screen.getByText("Version 0.2.1")).toBeInTheDocument();
  });

  it("shows available state with version info", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: "Bug fixes and improvements",
      date: "2026-05-19",
    });
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("A new version is available")).toBeInTheDocument();
    });
    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
    expect(screen.getByText("Bug fixes and improvements")).toBeInTheDocument();
  });

  it("shows available state without release notes when body is empty", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: undefined,
      date: undefined,
    });
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("A new version is available")).toBeInTheDocument();
    });
    expect(screen.queryByText("Bug fixes")).not.toBeInTheDocument();
  });

  it("shows error state when check fails", async () => {
    mockCheckForUpdate.mockRejectedValue(new Error("Network error"));
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Update check failed")).toBeInTheDocument();
    });
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("retry button re-checks for updates", async () => {
    mockCheckForUpdate.mockRejectedValueOnce(new Error("Network error"));
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Update check failed")).toBeInTheDocument();
    });

    mockCheckForUpdate.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(screen.getByText("You're up to date")).toBeInTheDocument();
    });
  });

  it("download button transitions to downloading state", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: null,
      date: null,
    });
    mockDownloadAndInstall.mockReturnValue(new Promise(() => {})); // never resolves

    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Download & Install")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Download & Install"));
    expect(screen.getByText("Downloading…")).toBeInTheDocument();
  });

  it("close button calls window close", async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const mockClose = vi.fn();
    vi.mocked(getCurrentWindow).mockReturnValue({ close: mockClose } as any);

    mockCheckForUpdate.mockResolvedValue(null);
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Close")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Close"));
    expect(mockClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test -- --run src/__tests__/updater-window.test.tsx`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/updater-window.test.tsx
git commit -m "test: add unit tests for updater window"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full frontend test suite**

Run: `pnpm test -- --run`
Expected: all tests pass

- [ ] **Step 2: Run Rust checks**

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: no warnings or errors

- [ ] **Step 3: Run frontend type check**

Run: `pnpm lint`
Expected: no type errors
