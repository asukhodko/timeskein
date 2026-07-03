# Timeskein

**Manual-first, local-first focus and work inventory system.**

A desktop application for quickly tracking focus sessions and work items with refs (URLs, files, issue keys), without background monitoring.

## Current Status (MVP)

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend (React + Tailwind) | Working | Runs in browser via Vite |
| Focus Session | Working baseline | Start, live timer, manual stop, post-factum correction, day list, tracked/work totals |
| Activity Zones | Basic | `work`, `coordination`, `recovery`, `idle`, `personal` zones with per-focus-block snapshots and day-report totals |
| Capture Inbox | Working baseline | Quick incoming-event capture without interrupting the active focus block |
| Work Item List | Working baseline | `Recent`, `Today`, `Pinned`, and `All` modes keep a multi-day inventory navigable |
| Work Item Events | Working baseline | Timestamped notes linked to Work Items and optionally to focus blocks |
| Dogfood Telemetry | Working baseline | Local app-event journal and CLI metrics for tracking UX friction |
| Mock Server | Working | Full API implementation for development |
| Rust Agent | Working | SQLite-backed Local API, embedded in macOS app |
| Tauri Desktop | Working on macOS | Embeds Rust agent and builds macOS `.app` |

**What works now:** Focus Session tracking, Capture Inbox, and Work Item inventory in browser mock mode and in the macOS `.app` with an embedded Rust agent.

**Current focus:** The macOS dogfood release baseline was accepted on 2026-07-03 after three real tracked days, including one day with Capture Inbox used during active focus. Post-factum focus correction is now implemented; the next slice is entry/window polish and richer day review. Windows packaging is deferred.

See [Current Implementation](docs/current-implementation.md) for the exact state of what runs today.
Use [Dogfood Day Protocol](docs/dogfood-day.md) when testing Timeskein as a Session replacement for a real workday.
Use [Dogfood Release Candidate](docs/dogfood-release-candidate.md) as the gate for deciding whether the current macOS baseline is good enough to replace Session in daily use.
See [Dogfood Release Baseline](docs/dogfood-release-baseline.md) for the accepted 2026-07-03 verdict and known limitations.

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

### Starting a Dogfood Day on macOS

```bash
pnpm dogfood:start
```

The start gate first checks the real local SQLite database for active sessions, active Work Items, duplicate titles, and existing blocks for today. If the real day is clean, it checks that no old `timeskein-desktop` process is running, runs the dogfood preflight, opens `Timeskein.app`, and waits for the embedded agent to respond.
It refuses to open the app if `timeskein-desktop` is already running, so the dogfood day does not accidentally reuse an older process after a rebuild.

For a clean trial that moves the current SQLite database aside first:

```bash
pnpm dogfood:start:clean
```

Preview the clean start without moving files or opening the app:

```bash
pnpm dogfood:start:clean:preview
```

Expanded form:

```bash
pnpm dogfood:ready
pnpm open:macos-app -- --check-running-only
pnpm dogfood:preflight
pnpm open:macos-app
pnpm dogfood:status
```

If `dogfood:ready` reports old test data and you want a clean trial database, follow its exact next commands. Usually that means first quitting Timeskein, then dry-running and applying the reset:

```bash
pnpm dogfood:reset-db
pnpm dogfood:reset-db -- --apply
pnpm dogfood:ready
```

The one-command version is `pnpm dogfood:start:clean`.
Use `pnpm dogfood:start:clean:preview` to preview the reset plan first.

If the readiness report shows existing blocks for today and you want a clean trial, prefer the reset path. If only an active focus block is stuck, close that block without moving the database aside:

```bash
pnpm dogfood:stop-active
pnpm dogfood:stop-active -- --apply
pnpm dogfood:ready
```

The command writes a stop note (`closed by dogfood:stop-active` by default). Override it with `--note`.
When Timeskein is already running and the agent responds, the applied stop uses the local agent API. If the app process is still alive but the agent is not responsive, it refuses direct SQLite changes unless `--force` is passed.

At the end of the day, export the analysis note:

```bash
pnpm dogfood:finish:save
```

This writes `timeskein-dogfood-report-YYYY-MM-DD.md` in the current directory. The report includes focus blocks, Work Item totals, Activity Zone totals, Work Item notes and timestamped Work Item Events for items touched that day, Capture Activity for the day, open Capture Inbox entries, and local app telemetry: starts, switches, stops, Capture Inbox actions, API errors, show/hide events, copy failures, and likely friction points.
Saved dogfood reports and RC checks can contain personal or internal work context, so they are ignored by git.
To print the report to stdout instead:

```bash
pnpm dogfood:finish > timeskein-dogfood-report.md
```

Inspect the telemetry separately when debugging the test day:

```bash
pnpm dogfood:metrics
pnpm export:app-events
```

For the Dogfood Release Candidate gate, run the evidence check after saving the report:

```bash
pnpm dogfood:rc-check:save
```

The RC check exits with code 1 for hard blockers such as active state, duplicate Work Item titles, or an empty day. Review items still require human judgment against the release-candidate criteria.

### macOS Data Path

```text
~/Library/Application Support/Timeskein/
```

The app stores SQLite data in `timeskein.db` and writes the current embedded-agent port to `agent.port`.
On startup the macOS app checks an existing `agent.port` with `agent.status`; if the recorded agent is gone, stale `agent.lock` / `agent.port` files are removed and a fresh embedded agent is started.

The local SQLite database also stores `captures`, the small inbox for incoming events, and `app_events`, an append-only technical event journal used for dogfood analysis. Telemetry payloads are intentionally limited to safe technical metadata; raw Work Item titles, notes, URLs, search text, and free-form user text are not written to telemetry payloads.

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

Fast local test suite:

```bash
pnpm test
```

This runs contracts build, TypeScript typecheck, Rust agent tests, mock-store
tests, Work Item list mode tests, mock API smoke, and key SQLite/report smoke
checks.

Full dogfood preflight, including macOS `.app` build and packaged-app smoke:

```bash
pnpm test:full
```

With the mock server running:

```bash
pnpm mock-server
pnpm smoke:focus-api
pnpm smoke:corrections-api
pnpm smoke:capture-api
```

Against a running Rust agent or desktop app:

```bash
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:focus-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:corrections-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:capture-api
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
| `Enter` | Open primary ref in browser, or edit the selected item when it has no refs |
| `E` | Edit selected Work Item |
| `Shift+Delete` | Delete item (with confirmation) |
| `C` or `Alt+N` | Create new item |
| `Esc` | Close dialogs; hide the macOS window when no dialog is open |

Focus Session controls:

| Control | Action |
|---------|--------|
| Focus input + `Start` | Find or create a Work Item by title, then start focus on it |
| Focus input + `Switch` | Stop the current block and start a new block by title |
| Capture input + `Capture` | Save an incoming event without stopping or switching focus |
| Empty focus input + `Space` | Start or switch focus to the selected Work Item |
| `Start Item` / `Switch Item` | Start or continue focus on the selected Work Item |
| Double-click Work Item | Start or switch focus to that Work Item |
| Stop note + `Enter` or `Stop` | Stop the active focus session and optionally save a note |
| Today row `Edit` | Correct a stopped focus block or split it into two blocks |

**State shortcuts (in State menu):**
1. Active, 2. Blocked, 3. Waiting, 4. Someday, 5. Unknown, 6. Done

## Architecture

- **Agent** (`apps/agent`): Rust service with SQLite database, exposes Local API on a dynamic localhost port and writes a port file for discovery
- **Desktop** (`apps/desktop`): Tauri app with React frontend, global hotkey palette, and embedded agent startup on macOS
- **Mock Server** (`packages/mock-server`): Express server implementing full Local API for development
- **Contracts** (`packages/contracts`): Shared TypeScript types/DTOs between frontend and backend

## Key Features (MVP)

- Manual work item management (create/edit/touch/note/state/pin/refs/delete)
- Manual focus sessions with 25-minute target and overflow tracking
- Post-factum correction for stopped focus blocks: edit time/note/Work Item/Activity Zone or split the block
- Capture Inbox for incoming events that should be handled later without interrupting the current focus block
- Timestamped Work Item Events for observations during the day, with edit/delete cleanup for user-authored notes
- Open captures can be edited, deleted, resolved, converted to Work Items, or appended as timestamped Work Item Events
- Running focus session restored from SQLite after frontend/app restart
- Focus sessions are linked to Work Items; typed titles reuse existing Work Items instead of creating duplicates
- Setting a Work Item to `active` starts or switches the linked focus session; stopping it clears `active`
- Day panel with focus blocks, total tracked time, work focus, non-work tracked time, entrance count, zones, and gaps
- Open gap warning when no focus block is running and the time since the last stopped block is significant
- Day totals count the part of each focus block that overlaps the selected local day
- Review checklist in Today and copied dogfood reports: active-state blockers, open captures, significant gaps, open gap, capture coverage, and timestamped-event coverage
- Markdown dogfood report from the Today panel or CLI, with focus data, Work Item totals, Activity Zone totals, Work Item notes and timestamped events for touched items, significant gaps, Capture Activity, open captures, review checklist/prompts, and draft warning while a focus block or Work Item is active
- macOS menu bar item shows the active focus duration as a short `12m Focus` status while a block is running, and today's total when no block is active
- Work item states: active, waiting, blocked, done, someday, unknown
- Work Item activity zones: work, coordination, recovery, idle, personal; focus blocks keep their own zone snapshot for report correction
- Work Item list shows last touched time plus today/total tracked time when available
- Work Item list can be narrowed to `Recent`, `Today`, `Pinned`, or `All`; typed search scans the matching inventory regardless of the current mode
- Refs: URLs, file paths, issue keys with conflict detection
- Pin items to keep them at top of list
- Search by title/note
- Keyboard-first navigation with mouse support
- macOS app opener refuses to reuse an already running `timeskein-desktop` process during dogfood start
- macOS app recovers from stale embedded-agent lock/port files on startup
- Denylist for privacy protection (in Rust agent)

## Known Limitations (Current State)

- **Browser mode uses mock data** - SQLite persistence is available in the macOS app, not in browser dev mode
- **Focus Session has no pause/resume/cancel yet** - the current baseline is start/stop only
- **Post-factum correction is basic** - stopped focus blocks can be edited and split, but there is not yet a drag timeline or multi-step correction wizard
- **Capture Inbox is still compact** - proven in one full dogfood day, with edit/delete for open captures; a fuller capture history screen is not implemented yet
- **Work Item Events are basic** - user-authored `note_added` events can be appended, promoted from captures, edited, deleted, and reported; generated system events are not exposed as an editable history yet
- **Work Item notes remain mutable descriptions** - timestamped observations should use Work Item Events instead
- **Activity zone correction is basic** - new focus blocks snapshot the Work Item zone and stopped blocks can be corrected, but there is no bulk zone editor yet
- **macOS window restore and menu bar counter are newly fixed** - the packaged app now avoids always-on-top/task-switcher hiding, handles macOS reopen, and updates the menu bar title from the native shell; verify this in the next dogfood day
- **macOS packaging produces `.app` only** - DMG packaging is deferred
- **Windows packaging deferred** - current recovery baseline targets browser and macOS first
- **Automated e2e tests are not implemented yet** - current validation is manual smoke plus build/type checks

## Documentation

- [Project Overview](docs/00_project_overview.md) - architecture and principles
- [Current Implementation](docs/current-implementation.md) - what runs today
- [Dogfood Day Protocol](docs/dogfood-day.md) - one-day Session replacement trial
- [opskarta Roadmap](docs/roadmap/opskarta.md) - current machine-checkable roadmap
- [MVP Technical Spec](mvp-technical%20specifications.md) - detailed requirements
- [Glossary](docs/glossary.md) - term definitions
- [ADRs](docs/adr/) - architecture decision records
- [RFCs](docs/rfc/) - design proposals

## Privacy

Timeskein is **manual-first**: no background monitoring, no collectors, no automatic tracking. All data entry requires explicit user action. Data stored locally only.

## License

MIT
