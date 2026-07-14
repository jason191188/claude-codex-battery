# 🔋 Claude & Codex Usage Battery — Windows

A **self-contained system-tray app** (single Go `.exe`, no bun/Node) that shows your
remaining Claude Code and Codex usage as a battery icon in the Windows system tray —
the Windows counterpart to the macOS SwiftBar plugin in the parent folder.

The macOS version renders a wide row of batteries in the menu bar; the Windows tray only
shows **one small icon per app**, so this app shows the **current 5-hour battery** as the
tray icon (color-coded) and puts the full breakdown in the **right-click menu**.

## What it shows

- **Tray icon** — the current 5-hour battery (`C5`, or Codex `X5`/`X`), filled and colored
  by a 5-step scale (🟢 green > 80 · 🟩 lime > 60 · 🟡 yellow > 40 · 🟠 orange > 20 · 🔴 red ≤ 20).
- **Tooltip** — one-line summary (`C5 95% · CW 70% · …`).
- **Right-click menu** — every window with % + reset countdown, a display-mode toggle
  (all five / current 5-hour only), refresh, GitHub link, quit.

Data comes from the same sources as the macOS version, read **natively in Go**:

| | Source |
|---|---|
| **Claude** | Anthropic OAuth usage API, using the token in `~/.claude/.credentials.json` (created by Claude Code login). Last good response cached at `~/.claude/swiftbar/.claude-usage.json`. |
| **Codex** | newest `~/.codex/sessions/**/*.jsonl` → `rate_limits` |

No bun, no Node, no external runtime — just the one `.exe`.

## Install

```powershell
# 1) get an exe: either build it (needs Go), or drop a released ccb-battery.exe here
#    build:  go build -ldflags "-H windowsgui" -o ccb-battery.exe .
# 2) run the installer (copies to %LOCALAPPDATA%, registers startup, launches)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

`install.ps1` will:
1. Use a prebuilt `ccb-battery.exe` in this folder if present, otherwise build from source with Go
2. Copy it to `%LOCALAPPDATA%\ClaudeCodexBattery\`
3. Register it under `HKCU\...\Run` so it starts at login
4. Launch it (find the battery in the tray; pin it out of the overflow `^` if hidden)

## Build

Requires [Go](https://go.dev/dl/) 1.22+.

```powershell
# native build for this machine
go build -ldflags "-H windowsgui" -o ccb-battery.exe .
```

Cross-compiling the Windows `.exe` from macOS/Linux works too (the tray backend is pure Go):

```bash
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-H windowsgui" -o ccb-battery.exe .
```

`-H windowsgui` produces a GUI app with **no console window**.

## Notes / limitations

- **Unsigned exe** → Windows SmartScreen may warn on first run (More info → Run anyway).
- Claude battery needs a Claude Code login on this PC; without it, only Codex (and any
  cached Claude data) shows.
- Dark/light tray tint follows the Windows theme (`AppsUseLightTheme` registry value).
- `--dump` flag renders a preview PNG + prints the gathered snapshot as JSON (dev/debug).
