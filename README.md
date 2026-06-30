# Timeskein

**Manual-first, local-first focus and work inventory system.**

A desktop application for quickly tracking focus sessions and work items with refs (URLs, files, issue keys), without background monitoring.

## Current Status (MVP)

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend (React + Tailwind) | Working | Runs in browser via Vite |
| Focus Session | Working baseline | Start, live timer, manual stop, day list, total active time |
| Mock Server | Working | Full API implementation for development |
| Rust Agent | Working | SQLite-backed Local API, embedded in macOS app |
| Tauri Desktop | Working on macOS | Embeds Rust agent and builds macOS `.app` |

**What works now:** Focus Session tracking and Work Item inventory in browser mock mode and in the macOS `.app` with an embedded Rust agent.

**Current focus:** Browser development mode and macOS Tauri app. Windows packaging is deferred.

See [Current Implementation](docs/current-implementation.md) for the exact state of what runs today.

The current execution roadmap is maintained as an opskarta v3 plan set:
[Timeskein opskarta roadmap](docs/roadmap/opskarta.md).

## Project Structure

```
timeskein/
├── apps/
│   ├── agent/         # Rust backend with SQLite and Local API
│   └── desktop/       # Tauri desktop app (React + Tailwind)
│       └── src-tauri/ # Tauri/Rust shell with embedded agent startup
├── packages/
│   ├── contracts/     # Shared TypeScript types/DTOs
│   └── mock-server/   # Mock API for development (Express)
├── plans/             # opskarta roadmap source files
├── tools/opskarta/    # vendored opskarta v3 validation/render tools
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

### macOS Data Path

```text
~/Library/Application Support/Timeskein/
```

The app stores SQLite data in `timeskein.db` and writes the current embedded-agent port to `agent.port`.

### Roadmap Tools

```bash
# Install opskarta Python dependencies
python3 -m pip install -r tools/opskarta/specs/v3/tools/requirements.txt

# Validate the roadmap plan set
cd tools/opskarta
python3 -m specs.v3.tools.cli validate ../../plans/timeskein/*.plan.yaml

# Render the current Gantt view
python3 -m specs.v3.tools.cli render gantt ../../plans/timeskein/*.plan.yaml --view current-gantt
```

### Focus Session API Smoke

With the mock server running:

```bash
pnpm mock-server
pnpm smoke:focus-api
```

Against a running Rust agent or desktop app:

```bash
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:focus-api
```

The smoke refuses to run if there is already an active focus session.

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

Focus Session controls are mouse-first for now:

| Control | Action |
|---------|--------|
| Focus input + `Start` | Find or create a Work Item by title, then start focus on it |
| `Start Item` | Start or continue focus on the selected Work Item |
| `Stop` | Stop the active focus session and optionally save a note |

**State shortcuts (in State menu):**
1. Active, 2. Blocked, 3. Waiting, 4. Someday, 5. Unknown, 6. Done

## Architecture

- **Agent** (`apps/agent`): Rust service with SQLite database, exposes Local API on a dynamic localhost port and writes a port file for discovery
- **Desktop** (`apps/desktop`): Tauri app with React frontend, global hotkey palette, and embedded agent startup on macOS
- **Mock Server** (`packages/mock-server`): Express server implementing full Local API for development
- **Contracts** (`packages/contracts`): Shared TypeScript types/DTOs between frontend and backend

## Key Features (MVP)

- Manual work item management (create/touch/edit/delete)
- Manual focus sessions with 25-minute target and overflow tracking
- Running focus session restored from SQLite after frontend/app restart
- Focus sessions are linked to Work Items; typed titles reuse existing Work Items instead of creating duplicates
- Setting a Work Item to `active` starts or switches the linked focus session; stopping it clears `active`
- Day panel with focus blocks, total active time, entrance count, and gaps
- Work item states: active, waiting, blocked, done, someday, unknown
- Refs: URLs, file paths, issue keys with conflict detection
- Pin items to keep them at top of list
- Search by title/note
- Keyboard-first navigation with mouse support
- Denylist for privacy protection (in Rust agent)

## Known Limitations (Current State)

- **Browser mode uses mock data** - SQLite persistence is available in the macOS app, not in browser dev mode
- **Focus Session has no pause/resume/cancel yet** - the current baseline is start/stop only
- **macOS packaging produces `.app` only** - DMG packaging is deferred
- **Windows packaging deferred** - current recovery baseline targets browser and macOS first
- **Automated e2e tests are not implemented yet** - current validation is manual smoke plus build/type checks

## Documentation

- [Project Overview](docs/00_project_overview.md) - architecture and principles
- [Current Implementation](docs/current-implementation.md) - what runs today
- [opskarta Roadmap](docs/roadmap/opskarta.md) - current machine-checkable roadmap
- [MVP Technical Spec](mvp-technical%20specifications.md) - detailed requirements
- [Glossary](docs/glossary.md) - term definitions
- [ADRs](docs/adr/) - architecture decision records
- [RFCs](docs/rfc/) - design proposals

## Privacy

Timeskein is **manual-first**: no background monitoring, no collectors, no automatic tracking. All data entry requires explicit user action. Data stored locally only.

## License

MIT
