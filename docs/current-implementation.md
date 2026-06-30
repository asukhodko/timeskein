# Current Implementation

## Status

Last updated: 2026-06-30.

This document describes what the repository actually runs today. Target architecture and future plans remain in RFCs and roadmap documents.

## Runtime Baseline

- Node.js 24+
- pnpm 11+
- Rust latest stable
- macOS is the only native desktop target currently verified

The root package declares `packageManager: pnpm@11.7.0` and requires Node 24 / pnpm 11.

## Working Modes

### Browser Development Mode

Browser mode is for UI development. It uses the mock server and does not persist data to SQLite.

```bash
CI=true pnpm install
pnpm --filter @timeskein/contracts build
pnpm mock-server
pnpm --filter @timeskein/desktop dev:frontend
```

- UI: `http://localhost:5173`
- Mock API: `http://127.0.0.1:3456/api`

### macOS Desktop App

The macOS Tauri app embeds the Rust agent in the same process.

```bash
pnpm --filter @timeskein/desktop dev
```

For release-style local build:

```bash
pnpm --filter @timeskein/desktop build
```

Build output:

```text
target/release/bundle/macos/Timeskein.app
```

## Agent Integration

The Rust agent is still a separate crate (`apps/agent`), but the macOS desktop shell starts it as an embedded runtime.

Startup flow:

1. Tauri setup starts the embedded agent.
2. The agent opens SQLite in the user data directory.
3. The agent binds `127.0.0.1:0`, so the OS chooses a free local port.
4. The agent writes the selected port to `agent.port`.
5. The frontend calls the Tauri command `get_api_url`.
6. The frontend sends Local API RPC requests to the returned URL.

Data path on macOS:

```text
~/Library/Application Support/Timeskein/
```

Important files:

```text
timeskein.db
agent.port
agent.lock
```

Browser mode does not use this embedded agent. It keeps using the mock server at `127.0.0.1:3456`.

## Verified Checks

The current local baseline has been verified with:

```bash
CI=true pnpm install --frozen-lockfile
pnpm --filter @timeskein/contracts build
pnpm --filter @timeskein/desktop build:frontend
pnpm typecheck
cargo check -p timeskein-agent
cargo check -p timeskein-desktop
pnpm --filter @timeskein/desktop build
```

Runtime smoke on macOS:

- `Timeskein.app` starts
- embedded agent creates `agent.port`
- `agent.status` returns `db_ok: true`
- `inventory.list` returns an empty list against the real SQLite-backed agent

## Implemented Features

- Manual Work Item inventory UI
- Search
- Create Work Item
- Touch
- State changes
- Notes
- Pin/unpin
- Refs UI and Local API methods
- Delete with confirmation
- Global shortcut registration with fallback candidates
- Tray/menu bar entry point on macOS
- SQLite storage through the embedded Rust agent
- Mock server for browser development

## Global Shortcut and Tray

The desktop app tries these global shortcut candidates:

1. `Ctrl+Shift+Space`
2. `Ctrl+Option+Space`
3. `Cmd+Option+Space`

If macOS rejects all candidates, the app still starts and remains available through the menu bar/tray item.

On multi-monitor macOS setups, the tray/status item is controlled by the system menu bar behavior. Timeskein creates one status item; macOS decides on which menu bar it appears.

## Known Limitations

- Windows packaging is deferred.
- Android is not implemented.
- macOS build currently produces `.app` only; DMG packaging is deferred.
- Browser mode uses mock data only.
- Automated e2e tests are not implemented yet.
- Cross-platform CI is not implemented yet.
- Settings UI is incomplete.
- Agent lifecycle is minimal: embedded startup works, but production-grade diagnostics/restart handling are not done.
- Sync, SourceNodes, Context Capture, and Evidence-Mode are future levels, not current functionality.

## Next Engineering Steps

1. Add smoke/e2e tests for browser mock mode and macOS embedded-agent mode.
2. Improve agent lifecycle diagnostics and user-visible error states.
3. Add a simple reset/open-data-folder troubleshooting flow.
4. Decide whether macOS should behave as a tray-only utility or a normal Dock app.
5. Start Focus Session / Session replacement as a separate feature on top of the stable local baseline.
