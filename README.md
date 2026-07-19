<div align="center">

# ❯_ Terma

**A modern desktop terminal emulator for Windows and macOS.**

Built with Electron · React · Vite · xterm.js · node-pty

</div>

---

Terma is a minimal, customizable terminal emulator: tabs, split panes, declarative themes, blurred background image, persistent sessions. Fully custom-drawn UI (title bar included), WebGL-accelerated rendering.

## Features

- **Tabs** — open, rename, duplicate, reorder, keyboard navigation.
- **Split panes** — horizontal or vertical splits, resizable binary tree, each pane runs its own shell.
- **Themes** — 6 built-in themes (Terma, Clair, Nord, Dracula, Gruvbox Dark, Solarized Dark), built-in editor, import/export as `.termatheme`. The logo and UI re-tint themselves based on the active theme's accent color.
- **Custom background** — optional image with adjustable blur (0–24 px) and terminal transparency.
- **Persistent sessions** — tab and split layout is restored on startup; per-tab export/import as `.termasession`.
- **Search** in the scrollback buffer (`Ctrl+Shift+F`), clickable links, copy/paste.
- **WebGL rendering** via xterm.js for smooth scrolling.
- **Integrations (opt-in)** — optional modules, all disabled by default. First one: Discord Rich Presence (see below).

## Integrations

Integrations live in `electron/integrations/`, one self-contained module per file, registered in `electron/integrations/index.js`. They are **always opt-in**: nothing runs until the user enables it in Settings → Intégrations.

### Discord Rich Presence

Shows "playing Terma" on your Discord profile, optionally with the active tab name (separate toggle, off by default since tab names can reveal project/host names). Implemented as a dependency-free local IPC client (`electron/integrations/discord-rpc.js`) — no data leaves your machine except what Discord itself publishes on your profile.

To make it work on your build:

1. Create an application on the [Discord Developer Portal](https://discord.com/developers/applications) named `Terma`.
2. Copy its **Application ID** into `DISCORD_APP_ID` in `electron/integrations/discord-rpc.js` (this ID is public by design, safe to commit).
3. Optional: upload an art asset named `terma` (Rich Presence → Art Assets) to display the logo.

## Tech stack

| Layer | Technology |
|---|---|
| Desktop runtime | Electron 43 |
| Main process | Unbundled CommonJS (`electron/`) |
| Renderer | React 19 + Vite 8 |
| Terminal | xterm.js 6 (+ fit, search, serialize, web-links, webgl addons) |
| Pseudo-terminal | node-pty 1.1 (native module) |
| Packaging | electron-builder (NSIS x64 on Windows, DMG arm64/x64 on macOS) |

The architecture enforces strict isolation: `contextIsolation: true`, `nodeIntegration: false`, IPC exposed through `window.terma` (contextBridge in `electron/preload.js`).

## Requirements

- **Node.js** 18+ and npm
- **Windows**: native build tools (Visual Studio Build Tools + Python) to compile node-pty
- **macOS**: Xcode Command Line Tools (`xcode-select --install`) to compile node-pty

## Installation

```bash
npm install
```

The `postinstall` step automatically applies the node-pty patches (`patch-package`) and rebuilds the native module for Electron (`electron-rebuild`).

## Development

```bash
npm run dev
```

A custom launcher (`scripts/dev.js`) starts Vite then Electron and guarantees a clean shutdown: closing the window kills Vite and frees the port. DevTools: `F12` or `Ctrl+Shift+I`.

## Build

```bash
npm run build      # build the renderer (Vite)
npm run icons      # generate build/icon.png + build/icon.ico from build/icon.svg
npm run dist       # build the installer for the current OS in release/
```

On Windows this produces an x64 NSIS `.exe` with installation-directory selection and desktop / Start-menu shortcuts. On macOS it produces a `.dmg` (Apple Silicon + Intel); the app is unsigned (no Apple Developer account), so the first launch requires right-click → Open to get past Gatekeeper.

## Keyboard shortcuts

On macOS, `Cmd` replaces `Ctrl` for app shortcuts (`Cmd+T`, `Cmd+W`, `Cmd+Shift+D`…) and copy/paste is also available as `Cmd+C` / `Cmd+V`; tab cycling stays on `Ctrl+Tab`.

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close active pane |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Shift+D` | Split horizontally |
| `Ctrl+Shift+B` | Split vertically |
| `Ctrl+Shift+F` | Search in terminal |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / Paste |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1`…`Ctrl+9` | Go to tab _n_ (9 = last) |

## Project structure

```
electron/          Main process (main, preload, pty-manager)
src/
  components/      React components (TitleBar, TabBar, PaneArea, TerminalView…)
  hooks/           useTabs, useSession, paneTree
  themes/          Built-in themes + theme host (whitelist)
  styles/          global.css
scripts/           dev.js (launcher), generate-icons.js
build/             icon.svg → icon.png / icon.ico
```

User data (session, themes, extensions) is stored in `%APPDATA%\terma` on Windows and `~/Library/Application Support/terma` on macOS. On macOS, shell integration (current-directory tracking via OSC 7) is injected through generated zsh/bash shims in that folder — your own shell config files are never modified.

## License

MIT
