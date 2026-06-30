# Timeskein

**Manual-first, local-first work inventory system.**

A desktop application for quickly tracking work items with refs (URLs, files, issue keys) using a global hotkey palette, without any background monitoring.

## Current Status (MVP)

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend (React + Tailwind) | Working | Runs in browser via Vite |
| Mock Server | Working | Full API implementation for development |
| Rust Agent | Buildable | `cargo check -p timeskein-agent` passes |
| Tauri Desktop | Working on macOS | Embeds Rust agent and builds macOS `.app` |

**What works now:** Frontend UI with mock server in browser, and macOS `.app` with an embedded Rust agent.

**Current focus:** Browser development mode and macOS Tauri shell. Windows packaging is deferred.

## Project Structure

```
timeskein/
├── apps/
│   ├── agent/         # Rust backend with SQLite, Local API (code ready)
│   └── desktop/       # Tauri desktop app (React + Tailwind)
│       └── src-tauri/ # Tauri/Rust shell
├── packages/
│   ├── contracts/     # Shared TypeScript types/DTOs
│   └── mock-server/   # Mock API for development (Express)
└── docs/              # Project documentation
```

## Quick Start

### Prerequisites

- Node.js 24+
- pnpm 11+
- Rust (latest stable) - only needed for native desktop build

### Running in Browser (Development Mode)

```bash
# Install dependencies
CI=true pnpm install

# Build contracts package
pnpm --filter @timeskein/contracts build

# Terminal 1: Start mock server
pnpm mock-server
# → API available at http://127.0.0.1:3456/api

# Terminal 2: Start frontend dev server
pnpm --filter @timeskein/desktop dev:frontend
# → UI available at http://localhost:5173
```

### Running on macOS (Tauri Development Mode)

```bash
# Tauri starts the frontend dev server and embedded Rust agent
pnpm --filter @timeskein/desktop dev
```

### Building macOS App

```bash
pnpm --filter @timeskein/desktop build
# → target/release/bundle/macos/Timeskein.app
```

## Keyboard Shortcuts

All shortcuts work regardless of keyboard layout (Russian, etc.):

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate items |
| `T` | Touch (update last_seen) |
| `P` | Pin/unpin item |
| `S` or `1-6` | Change state menu |
| `N` | Edit note |
| `R` | Refs panel (add/remove/open) |
| `Enter` | Open primary ref in browser |
| `Shift+Delete` | Delete item (with confirmation) |
| `C` or `Alt+N` | Create new item |
| `Esc` | Close dialogs / Clear search |

**State shortcuts (in State menu):**
1. Active, 2. Blocked, 3. Waiting, 4. Someday, 5. Unknown, 6. Done

## Architecture

- **Agent** (`apps/agent`): Rust service with SQLite database, exposes Local API on a dynamic localhost port and writes a port file for discovery
- **Desktop** (`apps/desktop`): Tauri app with React frontend, global hotkey palette, and embedded agent startup on macOS
- **Mock Server** (`packages/mock-server`): Express server implementing full Local API for development
- **Contracts** (`packages/contracts`): Shared TypeScript types/DTOs between frontend and backend

## Key Features (MVP)

- Manual work item management (create/touch/edit/delete)
- Work item states: active, waiting, blocked, done, someday, unknown
- Refs: URLs, file paths, issue keys with conflict detection
- Pin items to keep them at top of list
- Search by title/note
- Keyboard-first navigation with mouse support
- Denylist for privacy protection (in Rust agent)

## Known Limitations (Current State)

- **Browser mode uses mock data** - SQLite persistence requires Rust agent integration
- **macOS packaging produces `.app` only** - DMG packaging is deferred
- **Windows packaging deferred** - current recovery baseline targets browser and macOS first

## Documentation

- [Project Overview](docs/00_project_overview.md) - architecture and principles
- [MVP Technical Spec](mvp-technical%20specifications.md) - detailed requirements
- [Glossary](docs/glossary.md) - term definitions
- [ADRs](docs/adr/) - architecture decision records
- [RFCs](docs/rfc/) - design proposals

## Privacy

Timeskein is **manual-first**: no background monitoring, no collectors, no automatic tracking. All data entry requires explicit user action. Data stored locally only.

## License

MIT
