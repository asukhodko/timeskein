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
pnpm smoke:focus-api
pnpm --filter @timeskein/desktop build
```

Runtime smoke on macOS:

- `Timeskein.app` starts
- embedded agent creates `agent.port`
- `agent.status` returns `db_ok: true`
- `inventory.list` returns an empty list against the real SQLite-backed agent
- `focus.start`, `focus.stop`, `focus.list`, and Work Item focus switching work against the real SQLite-backed agent

Runtime smoke in browser/mock mode:

- mock server starts on localhost
- `focus.start`, `focus.stop`, `focus.list`, and Work Item focus switching work against the mock API
- `pnpm smoke:focus-api` verifies the same flow and refuses to run over an existing active focus session

## Implemented Features

- Focus Session panel
- Start focus from text by finding or creating a Work Item with that title
- Start focus session from the selected Work Item
- Set a Work Item to `active` to switch focus to it
- Reuse an existing Work Item when the typed title matches an existing title
- At most one active Work Item is kept in sync with the active focus session
- 25-minute target with elapsed contact time and overflow display
- Manual stop with optional note
- Active focus session restored from SQLite after frontend/app restart
- Today's focus blocks with total active time, entrance count, and gaps
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
- Borderless window can be moved by dragging the header
- SQLite storage through the embedded Rust agent
- Mock server for browser development

## Focus Session Data

The first Focus Session baseline is intentionally small. It stores manual contact-time blocks:

- title copied from the linked Work Item
- Work Item link
- state: `active` or `stopped`
- target seconds, currently 25 minutes by default in the UI
- start time, stop time, updated time
- optional stop note

The Rust agent stores focus sessions in SQLite. A partial unique index enforces at most one active focus session. Work Item `active` is treated as the UI marker for the currently timed item: switching it stops the old focus block and starts a new linked block, while stopping a linked focus block clears `active` from Work Items. Starting focus from typed text first searches for an existing Work Item with the same normalized title; if none exists, it creates one. The mock server exposes the same `focus.current`, `focus.start`, `focus.stop`, and `focus.list` RPC methods for browser development.

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
- Focus Session does not implement pause, resume, or cancel yet.
- Focus Session has only a compact day list, not a full reporting/export view yet.
- Automated e2e tests are not implemented yet.
- Cross-platform CI is not implemented yet.
- Settings UI is incomplete.
- Agent lifecycle is minimal: embedded startup works, but production-grade diagnostics/restart handling are not done.
- Sync, SourceNodes, Context Capture, and Evidence-Mode are future levels, not current functionality.

## Next Engineering Steps

1. Dogfood one real working day through Focus Session.
2. Add smoke/e2e tests for browser mock mode and macOS embedded-agent mode.
3. Decide whether pause/resume/cancel are needed before regular use.
4. Add export/reporting for end-of-day analysis.
5. Improve agent lifecycle diagnostics and user-visible error states.
