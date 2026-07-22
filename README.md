# Timeskein

**Manual-first, local-first causal work memory and steering system.**

A local desktop system for tracking real focus, preserving a historically
honest causal work trace, and choosing a justified next action without
background monitoring.

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend (React + Tailwind) | Working | Runs in browser via Vite |
| Focus Session | Working baseline | Start, live timer, manual stop, post-factum edit/split/add-missed-block correction, day list, tracked/work totals |
| Activity Zones | Basic | `work`, `coordination`, `recovery`, `idle`, `personal` zones with per-focus-block snapshots and day-report totals |
| Capture Inbox | Working baseline | Quick incoming-event capture without interrupting the active focus block |
| Work Item List | Working baseline | `Recent`, `Today`, `Pinned`, and `All` modes keep a multi-day inventory navigable |
| Work Item Events | Working baseline | Timestamped notes linked to Work Items and optionally to focus blocks |
| Day Events | Working baseline | Timestamped day-level notes for buffers, recovery, tracking corrections, and review context |
| Dispatch Ritual | Working baseline | Day-entry and post-break panel narrows the active set, can track coordination time, records the choice, and switches to one first action |
| Periodic Reflection | Working baseline | Four report profiles, Markdown/JSON period facts, review questions, decision templates, and persistent Reflection Sessions in local SQLite |
| Tracks and Labels | Working baseline | Hierarchical primary Track, optional cross-cutting Labels, Work Item assignment UI, historical focus/event snapshots, and filtered period reports |
| Evidence-backed Track story | Working baseline | Typed result/decision/blocker/next-step/observation events, immutable Ref snapshots, and decision follow-ups in Track retrospectives |
| Causal Work Spine | Working baseline | Append-only intent, state, result, decision, next-action, confirmation, and correction records with provenance and semantic snapshots |
| Operational Reality | Accepted baseline | Explainable current projection with unknowns, confidence, manual correction, Reflection follow-up, next-action lifecycle, JSON export, and a passed two-real-day gate |
| Operational Workspace | Accepted baseline | Item-backed day contract, immutable revisions, one primary steering surface, morning start, re-entry, export, telemetry, and a passed four-day gate |
| Working Memory Bridge | Implemented, acceptance pending | Chronological memory, revisions and tombstones, stages, materials, daily outcomes, WIP overflow, duplicate merge, re-entry surface, and deterministic Work Item/Track Context Packs |
| North-star architecture | Implemented foundation | Causal Work Memory, user-truth and untrusted-content boundaries, portable Context Packs, risk gates, bounded Context Probe, and the long-horizon map are defined in ADR-0004/0005, RFC-0009/0010, Roadmap 0005, and opskarta |
| Dogfood Telemetry | Working baseline | Local app-event journal and CLI metrics for tracking UX friction |
| Mock Server | Working | Full API implementation for development |
| Rust Agent | Working | SQLite-backed Local API, embedded in macOS app |
| Tauri Desktop | Working on macOS | Embeds Rust agent and builds macOS `.app` |

**What works now:** The browser mock and macOS `.app` support focus tracking,
Capture Inbox, Work Item inventory, correction, day and period review,
Tracks/Labels, typed evidence, causal history, and the accepted Operational
Reality projection through the embedded Rust agent. The current code also
implements Working Memory Bridge; its product acceptance deliberately remains
open until the real 1/3/7-day re-entry protocol passes.

**Current focus:** The manual day, period reflection, semantic history,
evidence-backed Track story, and `Causal Work Spine + Operational Reality v1`
and Operational Workspace are accepted. The workspace now converges Operational
Reality, an item-backed day contract, active focus, and the secondary inventory;
its gate passed with `4/3` contract/start/closure days, `3/2` re-entry days, and
`1/1` revised day. Working Memory Bridge is code-ready and is now in real-use
acceptance; causal period review and a bounded untrusted-context probe follow it.
Full SourceNodes, sync, private intelligence, and opt-in Evidence Mode remain
later capabilities.

See [Current Implementation](docs/current-implementation.md) for the exact state of what runs today.
Use [Dogfood Day Protocol](docs/dogfood-day.md) when testing Timeskein as a Session replacement for a real workday.
Use [Dogfood Release Candidate](docs/dogfood-release-candidate.md) as the evidence checklist for deciding whether the current macOS baseline is good enough to replace Session in daily use.
See [Dogfood Release Baseline](docs/dogfood-release-baseline.md) for the accepted 2026-07-03 verdict and known limitations.
See [Periodic Report Dogfood](docs/dogfood-periodic-report.md) for the first real multi-day review and its limitations.
See [Operational Reality Dogfood](docs/dogfood-operational-reality.md) for the accepted two-real-day evidence and reproducible protocol.
Use [Operational Workspace Dogfood](docs/dogfood-operational-workspace.md) for the required three-real-day acceptance protocol and executable gate.
Use [Working Memory Bridge Dogfood](docs/dogfood-working-memory.md) for the long-lived Work Item protocol and strict 1/3/7-day gate.
See [Causal Work Spine Acceptance Audit](docs/acceptance-causal-work-spine-v1.md) for requirement-by-requirement implementation and real-use evidence.
See [Dogfood Findings](docs/dogfood-learnings.md) for the product conclusions
and route derived from sixteen real workdays.

The current execution roadmap is maintained as an opskarta v3 plan set:
[Timeskein opskarta roadmap](docs/roadmap/opskarta.md).
The current strategic route is described in
[Causal Work Memory Roadmap](docs/roadmap/0005-causal-work-memory-roadmap.md),
[RFC-0009](docs/rfc/0009-causal-work-memory-and-operational-reality.md), and
[ADR-0004](docs/adr/0004-user-truth-and-derived-inference.md). The future
context boundary is specified independently of any assistant in
[ADR-0005](docs/adr/0005-untrusted-context-and-consumer-neutral-memory.md) and
[RFC-0010](docs/rfc/0010-artifacts-observations-and-context-packs.md). The accepted
[In-Day Structure](docs/roadmap/0004-in-day-structure-roadmap.md) and
[Periodic Reflection](docs/roadmap/0003-periodic-reflection-roadmap.md) roadmaps
remain the detailed history of the manual foundation.

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

For real Timeskein days, prefer the guarded commands below over opening the app directly.

### Building a Period Report

The upper date boundary is exclusive. This command includes July 1 through July 9:

```bash
pnpm report:period -- --from 2026-07-01 --to 2026-07-10
```

JSON uses the same report model:

```bash
pnpm report:period -- --from 2026-07-01 --to 2026-07-10 --format json
```

Save either format explicitly when needed:

```bash
pnpm report:period -- --from 2026-07-01 --to 2026-07-10 --output timeskein-period-report-2026-07-01--2026-07-09.md
pnpm report:period -- --from 2026-07-01 --to 2026-07-10 --format json --output timeskein-period-report-2026-07-01--2026-07-09.json
```

Choose a review profile and create a decision template:

```bash
pnpm report:period -- --from 2026-07-01 --to 2026-07-10 \
  --profile weekly-review \
  --reflection-template /tmp/timeskein-reflection.json
```

Build a historically explicit Track retrospective. Track can be an id or an unambiguous title; `--include-child-tracks` expands the selected subtree. Repeat `--label` to require several Labels, and repeat `--zone` to include several Activity Zones:

```bash
pnpm report:period -- --from 2026-07-01 --to 2026-07-10 \
  --profile track-retrospective \
  --track Timeskein \
  --include-child-tracks \
  --label dogfood \
  --zone work \
  --reflection-template /tmp/timeskein-track-reflection.json
```

Supported profiles are `weekly-review`, `sprint-review`, `track-retrospective`, and `performance-evidence`. Edit the generated JSON summary, findings, and decisions, then preserve the review:

```bash
pnpm reflection:save -- --input /tmp/timeskein-reflection.json
pnpm reflection:list -- --from 2026-07-01 --to 2026-07-10 --profile weekly-review
```

Decision kinds are `continue`, `done-close`, `park`, `reactive`, `noise`, and `protect-next-focus`. Decisions can target a Work Item or a Track. Re-running the same filtered report includes saved decisions for the selected period and the latest prior review with the same profile and filters.

For `track-retrospective`, Work Item events can be typed as `result`, `decision`, `blocker`, `next_step`, or `observation`. The active-focus journal and Work Item note editor can attach an existing Ref or create a URL, file, issue-key, or custom Ref. The report then adds `Что изменилось`, `Доказательства`, `Решения`, `Блокеры и хвосты`, `Что произошло после прошлых решений`, and `Следующие действия`. A result is confirmed only when it has a captured Ref snapshot; tracked duration remains evidence of effort, not proof of outcome.

Generated reflection templates also expose prior decisions that need follow-up. Save an explicit status with `fulfilled`, `progressed`, `cancelled`, `parked`, `contradicted`, or `no_evidence`; an optional `evidence_event_id` links the judgment to a typed Work Item event.

The real acceptance gate is executable and intentionally strict:

```bash
pnpm evidence:gate -- --from 2026-07-10 --to 2026-07-11
```

It builds the same Track slice as JSON and Markdown, then requires at least three captured Timeskein blocks, one result with a historical Ref snapshot, the six evidence-story sections, and explicit follow-up for the saved `protect-next-focus` and `continue` decisions. The 2026-07-10 real database passes this command.

### Using Operational Reality

The `Рабочая реальность` panel is shown above the focus/day controls. It is a
projection of saved Work Items, Tracks, captures, typed evidence, causal
records, focus state, and unresolved Reflection decisions. A card explains why
it is visible, distinguishes confirmed, derived, and legacy state, lists known
facts and unknowns, and keeps one explicit next action.
Track cards also show recent results and decisions from related Work Items by
their captured historical Track path, with captured evidence Refs. Moving the
current Work Item later does not rewrite that Track history.

The default panel shows the decision queue, not every legacy Work Item. Plain
unknown legacy state and a missing next action remain inspectable through
`Показать всё`; attention requires a stronger signal such as an explicit
waiting/blocked/reactive/stale/meeting-tail state, a Reflection decision, an
open next action, a capture, a pinned tail, or at least two hours without a
recorded result.

From the card the user can confirm or correct state, complete or replace the
next action, inspect captured evidence Refs, follow up a prior Reflection
decision, resolve a capture, remove an irrelevant point from current attention,
or start the linked Work Item. Corrections append a new record and keep the replaced
assertion in history without letting it continue to drive the current
projection. The implementation passed its two-real-day acceptance gate on
2026-07-16. Older facts show a date as well as a time, and `Enter` opens the
Work Item editor even when the item has a URL Ref.

With Timeskein running, export the exact current projection and its grounds as
JSON:

```bash
pnpm export:operational-reality
pnpm export:operational-reality -- --output /tmp/timeskein-operational-reality.json
pnpm export:operational-reality -- --as-of 2026-07-10T12:00:00+03:00
```

The accepted two-real-day gate remains reproducible:

```bash
pnpm operational-reality:gate -- --from 2026-07-15 --to 2026-07-17
```

It passed with two days and 11 starts from the projection, real attention
states, one explicit state correction followed by an app restart, three
Reflection decision follow-ups, one causal chain from intent through a result
with a Ref to a next action, and normal day closure on both days.

### Operational Workspace

`Рабочий контур` is now the primary steering surface. A morning contract selects
2–3 Work Items or Tracks, one first-action Work Item, 1–3 parked
competitors, and one `why now` statement. The saved contract remains visible
after focus starts, shows Operational Reality grounds beside the selection,
supports post-break re-entry, and records every adjustment as an append-only
revision. The complete Work Item inventory is collapsed by default and remains
available through `Дела` for search and maintenance.

Each active direction can carry a concrete daily outcome. Obligations beyond
the protected WIP 2–3 are recorded separately as visible overflow. Searching
inside the editor can create or reuse a Work Item and immediately add it to the
contract without opening the full inventory.

Opening a contract editor with no running focus starts Coordination tracking
automatically. Removing the previous first action selects another eligible
action when possible, and every missing save condition is shown next to the
disabled button. The current first action exposes its live state and an
explicit `Выбрать следующее` route instead of forcing a stale return.

The browser mock and embedded Rust agent expose the same workspace, contract
history, telemetry, and export behavior. Inspect a period of contracts with:

```bash
pnpm export:operational-workspace -- --from YYYY-MM-DD --to YYYY-MM-DD
```

After three full real days, run the acceptance gate with an exclusive upper
date:

```bash
pnpm operational-workspace:gate -- --from YYYY-MM-DD --to YYYY-MM-DD
```

The exact daily protocol and interpretation boundary are in
[Operational Workspace Dogfood](docs/dogfood-operational-workspace.md). Code,
tests, macOS packaging, and the browser scenario are ready; the product result
is deliberately not marked accepted before the real-use gate.

Focus corrections cannot create overlapping stopped blocks. Existing
historical overlaps block final day closure and appear as an explicit period
report warning; Timeskein does not silently rewrite them.

The report separates facts, observations, data-quality warnings, profile-specific evidence, and decisions. It includes totals by day, Activity Zone and Work Item; semantic coverage; focus-block timeline; significant gaps; Day Events; Work Item Events; Capture Inbox outcomes; current linked refs; open Track tails; and up to three focus candidates. Candidates are prompts for conscious review, not automatic productivity judgments. Generated period reports and decision templates are ignored by git by default.

### Working Memory Bridge

Open a selected Work Item's `Рабочая память` surface to keep chronological
thoughts, questions, decisions, observations, results, state changes, next
actions, and manual materials. Long entries have a dedicated resizable editor;
edits append revisions, and deletion leaves an explicit historical tombstone.
Named stages can be planned, activated, completed, or archived. A Focus Session
snapshots its stage and current daily outcome so later edits do not rewrite the
past.

The stop panel can optionally preserve one causal trace without making it a
condition of stopping: result, changed state, and next physical action. On
return, the same memory surface shows the latest confirmed change, current
stage, unknowns, materials, and next action, then starts the Work Item through
`Начать отсюда`. Duplicate Work Items can be merged into the selected canonical
item while keeping focus, memory, stages, classification, and an alias from the
old id.

The UI can copy deterministic `work-item-reentry` and `track-reentry` Context
Packs as Markdown and JSON. CLI export uses the same projection:

```bash
pnpm context-pack -- --profile work-item-reentry --scope WORK_ITEM_UUID \
  --format both --output /tmp/timeskein-work-item-reentry
pnpm context-pack -- --profile track-reentry --scope TRACK_UUID \
  --format both --output /tmp/timeskein-track-reentry
```

After the required real-use pauses, run the strict acceptance gate with an
exclusive upper date:

```bash
pnpm working-memory:gate -- --work-item WORK_ITEM_UUID \
  --from YYYY-MM-DD --to YYYY-MM-DD
```

Implementation tests are green, but Working Memory Bridge is not accepted until
the real protocol in [Working Memory Bridge Dogfood](docs/dogfood-working-memory.md)
proves returns after pauses of at least 1, 3, and 7 days without an external
task-memory notebook.

### Starting a Timeskein Day on macOS

```bash
pnpm dogfood:start
```

`dogfood:start` — быстрый ежедневный вход: он проверяет состояние реальной базы и открывает уже проверенную сборку без полного набора тестов. После изменений кода один раз используй `pnpm dogfood:start:verified`: команда выполнит полный preflight, пересоберёт приложение и только затем откроет его.

The start check first reads the real local SQLite database for active sessions, active Work Items, duplicate titles, and existing blocks for today. If the real day is clean, it checks that no old `timeskein-desktop` process is running, runs the dogfood preflight, opens `Timeskein.app`, and waits for the embedded agent to respond.
It refuses to open the app if `timeskein-desktop` is already running, so the Timeskein day does not accidentally reuse an older process after a rebuild.
When readiness is clean, `dogfood:ready` also prints the next start command and the daily-control checklist for the next Timeskein day: window entrypoints, new and existing Work Item starts, Work Item day/total time visibility with explicit review acceptance, Activity Zones, Day Events, Work Item Events, Capture Inbox, tracking correction/review, measured evening closure, treating the short closure notes as optional, following the UI `Ближайшее действие` until final `Копировать отчёт`, using the selected-Markdown `Command+C` fallback if clipboard copy is refused, avoiding Codex as closure navigation, using `dogfood:goal-check:status` only for calm readiness inspection, and treating the terminal `Статус закрытия: завершено`, `Короткое закрытие ... да (...)`, plus the exact strict `dogfood:goal-check -- --date YYYY-MM-DD --no-codex-guidance` command as the proof path.

If Timeskein was quit during an already started day, reopen it through the continue check:

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

This writes `timeskein-dogfood-report-YYYY-MM-DD.md` in the current directory. The report includes focus blocks, Work Item totals, Activity Zone totals, Day Events, Work Item notes and timestamped Work Item Events for items touched that day, Russian focus-data labels, Russian interruption history for the day, open Capture Inbox entries, a Russian review checklist, a Russian daily-closure check, and human-readable local app telemetry: starts, switches, stops, typed, selected/list, and dispatch-ritual entry paths, start/stop failures, Capture Inbox actions, daytime Activity Zone glances, accepted review decisions for Activity Zones, Capture usage, entry paths, window entrypoints, Work Item day/total time checks, focus corrections, measured day-closure duration, API errors, show/hide events, show/hide requests from window entrypoints, copy failures, and likely friction points. The standalone `pnpm dogfood:metrics` and `pnpm export:app-events` commands also print Russian output for manual inspection after a rough Timeskein day.
It also writes `timeskein-dogfood-rc-check-YYYY-MM-DD.md`, so the evening evidence package contains both the readable day report and the requirement-by-requirement closure check.
Saved day reports and closure checks can contain personal or internal work context, so they are ignored by git.
To print the report to stdout instead:

```bash
pnpm dogfood:finish > timeskein-dogfood-report.md
```

Inspect the telemetry separately when debugging the test day:

```bash
pnpm dogfood:metrics
pnpm export:app-events
```

To inspect the closure check without re-saving the day report, rerun the evidence check explicitly:

```bash
pnpm dogfood:rc-check:save
```

The closure check exits with code 1 for red items such as active state, duplicate Work Item titles, or an empty day. Its Russian `Сводка доказательств` includes total tracked time, working occupancy (`Work + Coordination`), executive work (`Work`), non-work tracked time, Activity Zone coverage, Work Item notes/events, accepted review decisions, Capture Inbox coverage, typed entry, selected/list continuation, and dispatch-ritual start evidence, correction telemetry, measured day-closure duration, window telemetry including both show and hide request evidence, and product-friction counters. It also includes a `Проверка закрытия дня` table that maps the current day to the accepted daily-control gate. The Work Item totals check row is marked for review when touched-item time was not explicitly accepted from the UI checklist. The Activity Zone row expects either two in-day explicit zone-distribution views through `Отметить просмотр` or an explicit evening `Зоны верны` acceptance; Capture usage, entry path, and window-entrypoint rows can be cleared by real evidence or by explicit accepted review telemetry. The day-closure row is marked for review when closure was not measured or took more than 10 minutes. The Today report button starts the closure timer, then stays on `Закрыть проверки` until the report is final and review-clean; CLI draft exports remain diagnostic evidence, but they do not complete measured closure. The gaps/captures row is marked for review when captures are missing, not linked to active focus, left open without a `capture_followup_reviewed` event, or when significant gaps lack Day Event explanations. Review items still require human judgment against the closure criteria.
Before marking the daily-control goal complete, run the final check after `pnpm dogfood:finish:save`. For the real local database it first checks that both saved evidence files exist, that the saved report status is final, that the saved report includes `Короткое закрытие` with `Статус закрытия`, `Данным можно доверять: да`, and `Закрытие уложилось в 10 минут: да`, that it uses the grouped `Проверка перед отчётом` checklist with `Ближайшее действие` and `Сводка`, and that the final command includes the explicit `--no-codex-guidance` confirmation; then it runs `pnpm test`, `pnpm dogfood:preflight`, and the strict closure check on the same code. If the saved evidence is missing or still draft, the command stops early with `Финальная проверка пока не готова`, repeats the saved report next action when available, and avoids a JavaScript stack trace:

```bash
pnpm dogfood:goal-check -- --no-codex-guidance
```

If you only want to inspect whether the saved evidence is ready, without running the expensive local checks and without turning expected incompleteness into a pnpm failure, use the soft status command. It keeps the manual route compact: next action, summary, safe bulk-accept hint when available, and a short note instead of the detailed audit-row list:

```bash
pnpm dogfood:goal-check:status -- --date YYYY-MM-DD
```

The status command reads the saved evidence files. If you already changed the current day in the app and the saved report looks stale, inspect the live next-action hint first:

```bash
pnpm dogfood:report -- --date YYYY-MM-DD
```

Then save the refreshed evidence with `pnpm dogfood:finish:save -- --date YYYY-MM-DD`.

When measured closure evidence is present and every `Проверка закрытия дня` row is already `ок`, `pnpm dogfood:finish:save` prints `Статус закрытия`, the short closure verdict, reminds that a day with Codex guidance is not proof for the active goal, and prints the exact dated `dogfood:goal-check` command with `--no-codex-guidance` to run next. If the saved report is still a draft, `finish:save` and `goal-check:status` repeat `Ближайшее действие` and `Сводка проверки` from the report, repeat the one-click `Всё проверено` hint when safe review checks can be accepted together, and keep the next step visible without reopening the Markdown. If measured closure exists but check rows are still pending, `finish:save` prints those pending rows and tells you to return to `Проверка перед отчётом` first.

If you close yesterday's dogfood day after midnight, pass the date explicitly:

```bash
pnpm dogfood:finish:save -- --date YYYY-MM-DD
pnpm dogfood:goal-check -- --date YYYY-MM-DD --no-codex-guidance
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
pnpm smoke:operational-reality-api
```

Against a running Rust agent or desktop app:

```bash
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:focus-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:corrections-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:capture-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:day-events-api
TIMESKEIN_API_URL=http://127.0.0.1:<port>/api pnpm smoke:operational-reality-api
```

The smoke refuses to run if there is already an active focus session.

## Keyboard Shortcuts

All shortcuts work regardless of keyboard layout (Russian, etc.):

The macOS app also tries to register one global show/hide shortcut, in this
order: `Ctrl+Shift+Space`, then `Ctrl+Option+Space`, then `Cmd+Option+Space`.
If macOS rejects all three, use the macOS menu bar item or normal app switching.

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate items |
| `T` | Обновить время касания дела |
| `P` | Закрепить или открепить дело |
| `S` or `1-6` | Change state menu |
| `N` | Edit note |
| `R` | Refs panel (add/remove/open) |
| `Enter` | Open primary ref in browser, or edit the selected item when it has no refs |
| `E` | Править выбранное дело |
| `Alt+1` / `Alt+2` / `Alt+3` / `Alt+4` | Переключить список дел: недавние / сегодня / закреплённые / все |
| `Shift+Delete` | Delete item (with confirmation) |
| `C` or `Alt+N` | Create new item |
| `Esc` | Close dialogs; hide the macOS window when no dialog is open |

Управление фокус-блоками:

| Что нажать | Что произойдёт |
|---------|--------|
| Поле «На чём сейчас фокус?» + `Старт` | Найти или создать дело по названию и начать фокус |
| Поле «Переключиться на...» + `Переключить` | Остановить текущий блок и начать следующий по названию |
| Строка «Мысль, решение, вопрос или следующий шаг...» | Записать событие активного дела или дня, не останавливая таймер |
| Поле «Зафиксировать отвлечение...» + `Записать` | Сохранить входящее событие, не останавливая и не переключая фокус |
| Пустое поле фокуса + `Space` | Начать или переключить фокус на выбранное дело |
| `Начать` / `Переключиться` на выбранном деле | Продолжить фокус на выбранном деле |
| Двойной клик по делу | Начать или переключить фокус на это дело |
| «Заметка при остановке» + `Enter` или `Стоп` | Остановить активный фокус-блок и при необходимости сохранить заметку |
| `Добавить пропущенный блок` в «Сегодня» | Добавить пропущенный остановленный блок перед финальным отчётом |
| `Править` в строке «Сегодня» | Исправить остановленный фокус-блок или разделить его на два |

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
- Active focus journal for quick thoughts, decisions, questions, next steps, milestones, and interruption notes during the running block; entries can target the current Work Item or the day and keep a local draft until they are saved
- Timestamped Work Item Events for observations during the day, with edit/delete cleanup for user-authored notes
- The Work Item event input keeps a local per-day, per-item draft until the event is successfully added
- Timestamped Day Events for review context that belongs to the day rather than to one Work Item
- The Day Event input keeps a local per-day draft until the event is successfully added, so a reload does not lose typed review context
- Open captures can be edited, deleted, resolved, converted to Work Items, or appended as timestamped Work Item Events
- Running focus session restored from SQLite after frontend/app restart
- Focus sessions are linked to Work Items; typed titles reuse existing Work Items instead of creating duplicates
- Setting a Work Item to `active` starts or switches the linked focus session; stopping it clears `active`
- Day panel with focus blocks, total tracked time, working occupancy, executive work, non-work tracked time, entrance count, live zone totals, an explicit `Отметить просмотр` action with a two-views-per-day reference point, and gaps
- Open gap warning when no focus block is running and the time since the last stopped block is significant
- Day totals count the part of each focus block that overlaps the selected local day
- Russian review checklist in Today and copied dogfood reports: active-state red items, open captures, significant gaps, open gap, Activity Zone coverage, non-work tracking, capture coverage, Work Item context coverage, current closure stage, elapsed closure time, compact summary of already-clean checks, `Объяснить` / `Управляемость` / `Восстановление` actions for gap Day Events, direct `Добавить блок` for missing tracking intervals, and specific accept-as-is actions for optional checks: `Зоны верны`, `Инбокс проверен`, `Пути проверены`, `Окно проверено`, `Трекинг верен`, `Время верно`, `Контекст не нужен`, and `Оставить как хвост`; open captures stay a separate conscious decision and are not hidden behind the bulk `Всё проверено` action. Missing day/item context can either stage a short note through `Добавить контекст` or record an explicit `Контекст не нужен` review when the report is already understandable. Before `Начать закрытие дня`, Today keeps the checklist compact and does not show the full evening queue as daytime background pressure, the report button starts closure, then says `Закрыть проверки` until a final report is possible, `Ближайшее действие` names the exact button or gesture for the current red item, review item, or final report copy, `Сводка` separates remaining red items, fix-ups, and accept-as-is checks, every unresolved checklist row repeats its action hint in the UI and copied/CLI Markdown, and an active focus block is not duplicated as a separate active-item red item until the focus has actually stopped
- Markdown day-closure report from the Today panel or CLI, with Russian focus data, Work Item totals, Activity Zone totals, Day Events, Work Item notes and timestamped events for touched items, significant gaps, Russian interruption history, open captures, review checklist/prompts, a short closure section for the minimal evening note with the measured 10-minute verdict prefilled, and draft status while a focus block, Work Item, or review check still needs attention
- macOS menu bar item shows the active focus duration as a short `12 мин в фокусе` status while a block is running, and today's total when no block is active
- Work item states: active, waiting, blocked, done, someday, unknown
- Work Item activity zones: work, coordination, recovery, idle, personal; focus blocks keep their own zone snapshot for report correction
- One optional hierarchical Track and several optional Labels per Work Item; the `#` header action manages the taxonomy, while create/edit dialogs assign it without adding a mandatory start step
- Explainable `Рабочая реальность` with active/waiting/blocked/parked/reactive/completed/stale-important/meeting-tail/unknown states, provenance, confidence, facts, unknowns, next actions, corrections, Track cards, captures, and Reflection follow-up
- Persistent `Рабочий контур` with an item-backed 2–3-direction day contract, one first action, explicit parking, `why now`, immutable revision history, and one morning/re-entry path over Operational Reality and active focus
- Append-only causal records keep `occurred_at` separate from `recorded_at`, preserve replaced assertions, and snapshot current Track/Labels for historical honesty
- Focus blocks and Work Item Events keep immutable Track/Label snapshots; period reports distinguish captured history, legacy current-Work-Item inference, and `Unclassified` data
- Work Item list shows Russian last-touched time like `5 мин назад` plus day/total tracked time when available
- Work Item list can be narrowed to `Recent`, `Today`, `Pinned`, or `All`; typed search scans the matching inventory regardless of the current mode
- The complete work area above inventory can be resized by dragging the divider above Work Item search and reset with a double-click
- Refs: URLs, file paths, issue keys with conflict detection
- Pin items to keep them at top of list
- Unicode-case-insensitive search by title/note, including common Cyrillic/Latin homoglyphs
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
- **Semantic classification is intentionally optional** - unclassified work remains visible; old rows created before semantic snapshots are clearly reported as restored from the Work Item's current classification
- **Taxonomy UI is minimal** - Tracks and Labels can be created, renamed, archived, and assigned, but there is no drag tree, bulk classifier, merge action, or automatic LLM classification
- **Operational Workspace has accepted follow-up polish** - contract composition still needs easier access to Operational Reality, creating an item from the contract picker is indirect, and accidental day-closure start has no cancel action
- **macOS Command+Tab restore is still unreliable** - tray click, global shortcut, and macOS reopen can show the window, but selecting a hidden Timeskein through Command+Tab did not restore it on 2026-07-20
- **macOS packaging produces `.app` only** - DMG packaging is deferred
- **Windows packaging deferred** - current recovery baseline targets browser and macOS first
- **Automated browser e2e tests are not implemented yet** - current validation combines Rust/API tests, mock parity, UI structure smoke, release build, packaged-app smoke, and manual browser inspection
- **Operational Reality still has integration polish** - the accepted projection is not yet visible enough while assembling a contract; Command+Tab restore, light theme, and a chronological thought workspace remain backlog items

## Documentation

- [Project Overview](docs/00_project_overview.md) - architecture and principles
- [Current Implementation](docs/current-implementation.md) - what runs today
- [Dogfood Day Protocol](docs/dogfood-day.md) - one-day Session replacement trial
- [Operational Reality Dogfood](docs/dogfood-operational-reality.md) - accepted two-day gate for the explainable current projection
- [Causal Work Spine Acceptance Audit](docs/acceptance-causal-work-spine-v1.md) - implementation and real-use proof
- [opskarta Roadmap](docs/roadmap/opskarta.md) - current machine-checkable roadmap
- [In-Day Structure Roadmap](docs/roadmap/0004-in-day-structure-roadmap.md) - in-day thoughts, stages, live zone balance, dispatching, and recovery/lost-control gap classification
- [Periodic Reflection Roadmap](docs/roadmap/0003-periodic-reflection-roadmap.md) - arbitrary-period reports and reflection loops
- [MVP Technical Spec](mvp-technical%20specifications.md) - detailed requirements
- [Glossary](docs/glossary.md) - term definitions
- [ADRs](docs/adr/) - architecture decision records
- [RFCs](docs/rfc/) - design proposals

## Privacy

Timeskein is **manual-first**: no background monitoring, no collectors, no automatic tracking. All data entry requires explicit user action. Data stored locally only.

## License

MIT
