# Timeskein

**Manual-first, local-first focus and work inventory system.**

A desktop application for quickly tracking focus sessions and work items with refs (URLs, files, issue keys), without background monitoring.

## Current Status (MVP)

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend (React + Tailwind) | Working | Runs in browser via Vite |
| Focus Session | Working baseline | Start, live timer, manual stop, post-factum edit/split/add-missed-block correction, day list, tracked/work totals |
| Activity Zones | Basic | `work`, `coordination`, `recovery`, `idle`, `personal` zones with per-focus-block snapshots and day-report totals |
| Capture Inbox | Working baseline | Quick incoming-event capture without interrupting the active focus block |
| Work Item List | Working baseline | `Recent`, `Today`, `Pinned`, and `All` modes keep a multi-day inventory navigable |
| Work Item Events | Working baseline | Timestamped notes linked to Work Items and optionally to focus blocks |
| Day Events | Working baseline | Timestamped day-level notes for buffers, recovery, tracking corrections, and review context |
| Dogfood Telemetry | Working baseline | Local app-event journal and CLI metrics for tracking UX friction |
| Mock Server | Working | Full API implementation for development |
| Rust Agent | Working | SQLite-backed Local API, embedded in macOS app |
| Tauri Desktop | Working on macOS | Embeds Rust agent and builds macOS `.app` |

**What works now:** Focus Session tracking, Capture Inbox, and Work Item inventory in browser mock mode and in the macOS `.app` with an embedded Rust agent.

**Current focus:** The post-baseline daily-control gate passed on 2026-07-06 after a full real workday: 7:30:36 tracked, 19 entrances, Activity Zones, Day/Work Item Events, Capture Inbox conversion, Work Item today/total evidence, and a green `pnpm dogfood:goal-check`. The active goal now is narrower: prove that evening closure is cheap enough. The next dogfood day must start closure from the review panel, copy the final report, and show `Day closure duration measured` at 10 minutes or less without Codex explaining the next action. Windows packaging is deferred.

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

For dogfood days, prefer the guarded commands below over opening the app directly.

### Starting a Dogfood Day on macOS

```bash
pnpm dogfood:start
```

The start gate first checks the real local SQLite database for active sessions, active Work Items, duplicate titles, and existing blocks for today. If the real day is clean, it checks that no old `timeskein-desktop` process is running, runs the dogfood preflight, opens `Timeskein.app`, and waits for the embedded agent to respond.
It refuses to open the app if `timeskein-desktop` is already running, so the dogfood day does not accidentally reuse an older process after a rebuild.
When readiness is clean, `dogfood:ready` also prints the next start command and the daily-control checklist for the next dogfood day: window entrypoints, new and existing Work Item starts, Work Item today/total time visibility with explicit review acceptance, Activity Zones, Day Events, Work Item Events, Capture Inbox, tracking correction/review, measured evening closure, and following the exact next command printed by `dogfood:finish:save`.

If Timeskein was quit during an already started dogfood day, reopen it through the continue gate:

```bash
pnpm dogfood:continue
```

This uses readiness continue mode, so existing blocks for today and one coherent active focus block are allowed, while duplicate titles and active-state split brain still block reopening.

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

`pnpm dogfood:macos` is kept as a low-level rebuild-and-open helper for development/manual debugging. It is not the normal dogfood start or continue path because it does not inspect the real day state before opening the app.

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

This writes `timeskein-dogfood-report-YYYY-MM-DD.md` in the current directory. The report includes focus blocks, Work Item totals, Activity Zone totals, Day Events, Work Item notes and timestamped Work Item Events for items touched that day, Russian focus-data labels, Russian interruption history for the day, open Capture Inbox entries, a Russian review checklist, a Russian daily-closure audit, and human-readable local app telemetry: starts, switches, stops, typed and selected/list entry paths, start/stop failures, Capture Inbox actions, accepted review decisions for Activity Zones, Capture usage, entry paths, window entrypoints, Work Item today/total badges, focus corrections, measured day-closure duration, API errors, show/hide events, show/hide requests from window entrypoints, copy failures, and likely friction points.
It also writes `timeskein-dogfood-rc-check-YYYY-MM-DD.md`, so the evening evidence package contains both the readable day report and the requirement-by-requirement RC audit.
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

For the Dogfood Release Candidate gate, rerun the evidence check explicitly when you want to inspect it without re-saving the day report:

```bash
pnpm dogfood:rc-check:save
```

The RC check exits with code 1 for hard blockers such as active state, duplicate Work Item titles, or an empty day. Its Russian `Сводка доказательств` includes total tracked time, work focus, non-work tracked time, Activity Zone coverage, Work Item notes/events, accepted review decisions, Capture Inbox coverage, typed entry and selected/list continuation evidence, correction telemetry, measured day-closure duration, window telemetry including both show and hide request evidence, and product-friction counters. It also includes an `Аудит закрытия дня` table that maps the current day to the active daily-control objective. The Work Item totals audit row is marked for review when touched-item time badges were not explicitly accepted from the UI checklist. The Activity Zone, Capture usage, entry path, and window-entrypoint rows can be cleared by real evidence or by explicit accepted review telemetry. The day-closure audit row is marked for review when closure was not measured or took more than 10 minutes. Copying a draft report, or a report that still has pending review items, can start the closure timer, but it does not complete the measured closure until the report is final and review-clean. The gaps/captures audit row is marked for review when captures are missing, not linked to active focus, left open without a `capture_followup_reviewed` event, or when significant gaps lack Day Event explanations. Review items still require human judgment against the release-candidate criteria.
Before marking the daily-control goal complete, run the final gate after `pnpm dogfood:finish:save`. For the real local database it first checks that both saved evidence files exist and that the saved report uses the grouped `Проверка перед отчётом` checklist, then runs `pnpm test`, `pnpm dogfood:preflight`, and the strict RC check on the same code:

```bash
pnpm dogfood:goal-check
```

When measured closure evidence is present and every `Аудит закрытия дня` row is already `ок`, `pnpm dogfood:finish:save` prints the exact dated `dogfood:goal-check` command to run next. If measured closure exists but audit rows are still pending, it prints those pending rows and tells you to return to `Проверка перед отчётом` first.

If you close yesterday's dogfood day after midnight, pass the date explicitly:

```bash
pnpm dogfood:finish:save -- --date YYYY-MM-DD
pnpm dogfood:goal-check -- --date YYYY-MM-DD
```

### macOS Data Path

```text
~/Library/Application Support/Timeskein/
```

The app stores SQLite data in `timeskein.db` and writes the current embedded-agent port to `agent.port`.
On startup the macOS app checks an existing `agent.port` with `agent.status`; if the recorded agent is gone, stale `agent.lock` / `agent.port` files are removed and a fresh embedded agent is started.

The local SQLite database also stores `captures`, the small inbox for incoming events, `day_events`, timestamped day-level notes for evening review, and `app_events`, an append-only technical event journal used for dogfood analysis. Telemetry payloads are intentionally limited to safe technical metadata; raw Work Item titles, notes, URLs, search text, and free-form user text are not written to telemetry payloads.

### Roadmap Tools

```bash
# Install opskarta Python dependencies
python3 -m pip install -r tools/opskarta/specs/v3/tools/requirements.txt

# Validate the roadmap plan set
pnpm roadmap:validate

# Render the current Gantt view
cd tools/opskarta
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

Full dogfood preflight, including roadmap validation, macOS `.app` build, and packaged-app smoke:

```bash
pnpm test:full
```

With the mock server running:

```bash
pnpm mock-server
pnpm smoke:focus-api
pnpm smoke:corrections-api
pnpm smoke:capture-api
pnpm smoke:day-events-api
```

Against a running Rust agent or desktop app:

```bash
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:focus-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:corrections-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:capture-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:day-events-api
```

The smoke refuses to run if there is already an active focus session.

## Keyboard Shortcuts

All shortcuts work regardless of keyboard layout (Russian, etc.):

The macOS app also tries to register one global show/hide shortcut, in this
order: `Ctrl+Shift+Space`, then `Ctrl+Option+Space`, then `Cmd+Option+Space`.
If macOS rejects all three, use the menu bar item or normal app switching.

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
| `Alt+1` / `Alt+2` / `Alt+3` / `Alt+4` | Switch Work Item list mode: Recent / Today / Pinned / All |
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
| Today `Add Block` | Add a missed stopped focus block before copying the final report |
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
- Post-factum correction for stopped focus blocks: add a missed block, edit time/note/Work Item/Activity Zone, or split a block
- Capture Inbox for incoming events that should be handled later without interrupting the current focus block
- Timestamped Work Item Events for observations during the day, with edit/delete cleanup for user-authored notes
- Timestamped Day Events for review context that belongs to the day rather than to one Work Item
- Open captures can be edited, deleted, resolved, converted to Work Items, or appended as timestamped Work Item Events
- Running focus session restored from SQLite after frontend/app restart
- Focus sessions are linked to Work Items; typed titles reuse existing Work Items instead of creating duplicates
- Setting a Work Item to `active` starts or switches the linked focus session; stopping it clears `active`
- Day panel with focus blocks, total tracked time, work focus, non-work tracked time, entrance count, zones, and gaps
- Open gap warning when no focus block is running and the time since the last stopped block is significant
- Day totals count the part of each focus block that overlaps the selected local day
- Russian review checklist in Today and copied dogfood reports: active-state blockers, open captures, significant gaps, open gap, Activity Zone coverage, non-work tracking, capture coverage, Work Item context coverage, current closure stage, elapsed closure time, compact summary of already-clean checks, `Объяснить` actions for gap Day Events, and specific accept-as-is actions for optional checks: `Зоны верны`, `Инбокс проверен`, `Пути проверены`, `Окно проверено`, `Трекинг верен`, `Бейджи верны`, and `Оставить открытыми`
- Markdown dogfood report from the Today panel or CLI, with Russian focus data, Work Item totals, Activity Zone totals, Day Events, Work Item notes and timestamped events for touched items, significant gaps, Russian interruption history, open captures, review checklist/prompts, and draft warning while a focus block or Work Item is active
- macOS menu bar item shows the active focus duration as a short `12m Focus` status while a block is running, and today's total when no block is active
- Work item states: active, waiting, blocked, done, someday, unknown
- Work Item activity zones: work, coordination, recovery, idle, personal; focus blocks keep their own zone snapshot for report correction
- Work Item list shows last touched time plus today/total tracked time when available
- Work Item list can be narrowed to `Recent`, `Today`, `Pinned`, or `All`; typed search scans the matching inventory regardless of the current mode
- Today list height can be resized by dragging the divider above the Work Item search and reset with a double-click
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
- **Post-factum correction is basic** - stopped focus blocks can be added, edited, and split, but there is not yet a drag timeline or multi-step correction wizard
- **Capture Inbox is still compact** - proven in one full dogfood day, with edit/delete for open captures; a fuller capture history screen is not implemented yet
- **Work Item Events are basic** - user-authored `note_added` events can be appended, promoted from captures, edited, deleted, and reported; generated system events are not exposed as an editable history yet
- **Day Events are basic** - user-authored day-level notes can be added, re-zoned, edited, deleted, and reported; there is no separate day journal screen yet
- **Work Item notes remain mutable descriptions** - timestamped observations should use Work Item Events instead
- **Activity zone correction is basic** - new focus blocks snapshot the Work Item zone and stopped blocks can be corrected, but there is no bulk zone editor yet
- **macOS window restore and menu bar counter are newly fixed** - the packaged app now avoids always-on-top/task-switcher hiding, handles macOS reopen, and updates the menu bar title from the native shell; the next dogfood day should verify this through non-zero show and hide request telemetry from window entrypoints
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
