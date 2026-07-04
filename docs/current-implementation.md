# Current Implementation

## Status

Last updated: 2026-07-04.

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

If startup sees an existing `agent.lock` / `agent.port`, the desktop shell probes the recorded port with `agent.status` before reusing it. If the port is stale, the shell removes the runtime files and starts a fresh embedded agent.

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
cargo test -p timeskein-agent
cargo check -p timeskein-agent
cargo check -p timeskein-desktop
pnpm --filter @timeskein/mock-server test
pnpm test
pnpm smoke:focus-api
pnpm smoke:corrections-api
pnpm smoke:capture-api
pnpm smoke:day-events-api
pnpm smoke:mock-api
pnpm --filter @timeskein/desktop build
pnpm smoke:macos-app
pnpm smoke:export-focus-day
pnpm smoke:app-events
pnpm smoke:dogfood-report
pnpm smoke:dogfood-finish
pnpm smoke:dogfood-status
pnpm smoke:dogfood-ready
pnpm smoke:dogfood-rc-check
pnpm smoke:dogfood-reset-db
pnpm smoke:dogfood-start
pnpm smoke:dogfood-stop-active
pnpm smoke:open-macos-app
pnpm roadmap:validate
pnpm dogfood:preflight
```

Runtime smoke on macOS:

- `Timeskein.app` starts
- embedded agent creates `agent.port`
- `agent.status` returns `db_ok: true`
- `inventory.list` returns an empty list against the real SQLite-backed agent
- `focus.start`, `focus.stop`, `focus.list`, and Work Item focus switching work against the real SQLite-backed agent
- `pnpm smoke:macos-app` launches the packaged `.app` binary with a temporary home directory and verifies embedded-agent `agent.status`, `inventory.list`, focus start/stop/list, title reuse, focus switching, active Work Item deletion, and active focus restoration after app restart
- `pnpm smoke:macos-app` also verifies post-factum focus correction: missed stopped block creation, stopped block update, split, Work Item reassignment, Work Item edit, and day-list reflection
- `pnpm smoke:macos-app` also verifies Capture Inbox create/update/delete/resolve/convert/append-event while ensuring capture actions do not interrupt the active focus session
- `pnpm smoke:macos-app` also verifies Work Item Event add/update/delete/list against the packaged SQLite-backed app
- `pnpm smoke:macos-app` also verifies Day Event add/update/delete/list against the packaged SQLite-backed app while ensuring day notes do not interrupt the active focus session
- `pnpm smoke:macos-app` also verifies startup normalization of legacy active Work Items, orphan active focus sessions, stale `agent.lock` / `agent.port` recovery, and migration of older `app_events` kind constraints
- `pnpm smoke:export-focus-day` verifies fallback Markdown export, including Day Events, Work Item notes, timestamped Work Item Events for touched items, and legacy focus-session schemas without Activity Zone columns, against temporary SQLite databases
- `pnpm smoke:app-events` verifies the local app-event migration, metrics summary, and Markdown export against a temporary SQLite database
- `pnpm smoke:dogfood-report` verifies the evening dogfood report wrapper, Review Checklist, Daily Control Goal Audit, Activity Zone evidence warnings, entry-path evidence prompts, correction evidence prompts, accepted correction review, accepted open-capture follow-up review, Day Events, Work Item notes, Work Item Events, Capture Activity, open captures, analysis prompts, and App Telemetry section, including typed/selected entry and both window show and hide request evidence
- `pnpm smoke:dogfood-finish` verifies the end-of-day gate: no active focus session, no active Work Item, at least one focus block, and `--save` writing both the day report and RC check
- `pnpm smoke:dogfood-status` verifies the embedded-agent status checker against healthy and unhealthy temporary HTTP agents
- `pnpm smoke:dogfood-ready` verifies the real-database readiness checker against clean and contaminated temporary SQLite databases, including running-process visibility and the actionable next commands
- `pnpm smoke:dogfood-rc-check` verifies the release-candidate evidence checker against good, legacy-schema, open-capture, no-active-focus-capture, empty-day, duplicate-title, and active-session temporary databases, including Day Event evidence, strict review-item failure, and the `Daily Control Goal Audit`
- `pnpm smoke:dogfood-reset-db` verifies dry-run, backup-reset behavior, and running-process refusal on temporary database files
- `pnpm smoke:dogfood-start` verifies the start gate against clean and contaminated temporary SQLite databases, including clean-start reset, without opening the app
- `pnpm smoke:dogfood-stop-active` verifies dry-run, direct SQLite fallback, running-process refusal, and running-agent API behavior for closing a stuck active focus block
- `pnpm smoke:open-macos-app` verifies that the macOS opener, `--check-only`, and `--check-running-only` refuse to reuse an already running `timeskein-desktop` process

Dogfood launch helper:

- `pnpm dogfood:start` checks the real local database and running-process guard first, then runs preflight, opens the macOS app when all gates pass, and waits for the embedded agent to respond
- `pnpm dogfood:continue` runs the same guarded app-opening path with readiness continue mode, so an already started dogfood day can be reopened without resetting the database or bypassing duplicate-title and active-state checks
- `pnpm dogfood:start:clean` moves the current local SQLite files aside through the same guarded reset path, then runs the normal dogfood start gate; `pnpm dogfood:start:clean:preview` prints the reset plan and checks non-mutating gates
- `pnpm dogfood:status` waits for the local embedded-agent port file and verifies `agent.status`
- `pnpm dogfood:finish` checks that the day can be closed with no active focus session or active Work Item, then prints the Markdown dogfood report
- `pnpm dogfood:finish:save` runs the same end-of-day gate and saves both `timeskein-dogfood-report-YYYY-MM-DD.md` and `timeskein-dogfood-rc-check-YYYY-MM-DD.md`
- `pnpm dogfood:preflight` runs the local checks needed before trusting a real dogfood day, including opskarta roadmap validation, Work Item list mode tests, isolated mock API, export, and dogfood-report smoke checks
- `pnpm dogfood:ready` inspects the real local SQLite database for active sessions, active Work Items, duplicate titles, existing focus blocks for today, agent responsiveness, and running app processes; when the day is not ready it prints exact stop/reset commands, and when the day is ready it prints the next start command plus the Daily-Control Checklist for the next dogfood pass
- `pnpm dogfood:rc-check` prints the release-candidate evidence summary, `Daily Control Goal Audit`, hard blockers, review items, and manual verdict prompts for the saved dogfood day; the summary includes total tracked time, work focus, non-work tracked time, Activity Zone coverage, Work Item notes/events, Capture Inbox coverage, typed entry and selected/list continuation evidence, correction telemetry, window telemetry with both show and hide request counts, and product-friction counters
- `pnpm dogfood:rc-check:save` saves the same RC evidence again when it needs to be inspected without regenerating the day report
- `pnpm dogfood:rc-check:strict` uses the same evidence but exits with code 1 when any review item remains, for the final daily-control goal closure check
- `pnpm dogfood:goal-check` runs the final closure gate for the active daily-control goal: `pnpm test`, `pnpm dogfood:preflight`, and strict RC evidence for the selected dogfood day
- `pnpm dogfood:reset-db` moves the real local SQLite database and sidecar files aside only when `--apply` is passed; it refuses while the agent or app process appears alive unless `--force` is passed
- `pnpm dogfood:stop-active` stops active focus sessions, writes a stop note, and clears active Work Items only when `--apply` is passed; it uses the running agent API when available and direct SQLite only when neither agent nor app process is alive, unless `--force` is passed
- `pnpm dogfood:macos` rebuilds and opens the packaged app as a low-level development/manual-debugging helper; normal dogfood days should use `dogfood:start` or `dogfood:continue` because those commands inspect the real day state before opening the app
- `pnpm open:macos-app` refuses by default when `timeskein-desktop` is already running, so a dogfood start does not silently activate an old process; `--check-only` validates bundle plus guard without opening the app, and `--check-running-only` runs only the process guard before preflight has built the app
- `pnpm export:focus-day` prints a Markdown day report from the local SQLite database as a fallback to UI copy
- `pnpm dogfood:metrics` prints dogfood telemetry aggregates from the local SQLite app-event journal, including start/stop failure counts and accepted open-capture follow-up reviews
- `pnpm export:app-events` prints a Markdown event table for deeper inspection of show/hide/start/switch/stop/copy/API behavior
- `pnpm dogfood:report` prints a Markdown dogfood report with focus data, Review Checklist, Daily Control Goal Audit, Day Events, Capture Activity, open captures, app telemetry, and evening review prompts, marked as a draft if a focus block or Work Item is still active

Runtime smoke in browser/mock mode:

- mock server starts on localhost
- `pnpm test` runs the fast local suite: contracts build, TypeScript typecheck, Rust agent tests, mock-store tests, Work Item list mode tests, mock API smoke, and key SQLite/report smoke checks
- `cargo test -p timeskein-agent` includes handler-level integration tests against a temporary SQLite database for focus start/switch coherence and post-factum correction, including adding a missed stopped block
- `pnpm --filter @timeskein/mock-server test` covers mock-store invariants for one-active focus, Capture Inbox non-interruption and cleanup, and correction add/update/split/edit reflection
- `focus.start`, `focus.stop`, `focus.list`, and Work Item focus switching work against the mock API
- `pnpm smoke:focus-api` verifies the same flow and refuses to run over an existing active focus session
- `pnpm smoke:corrections-api` verifies focus.create_stopped, focus.update, focus.split, Work Item edit, duplicate-title rejection, and corrected day-list data
- `pnpm smoke:capture-api` verifies Capture Inbox create/list/update/delete/resolve/convert/append-event without interrupting focus
- `pnpm smoke:day-events-api` verifies Day Event create/list/update/delete without interrupting focus
- `pnpm smoke:mock-api` starts an isolated mock server, runs `smoke:focus-api`, `smoke:corrections-api`, `smoke:capture-api`, and `smoke:day-events-api`, and stops it
- mock API also exposes `app_event.log`, `app_event.list`, and `app_event.summary`, including correction and correction-review telemetry counters
- manual browser UI smoke was checked on 2026-06-30: start by typed title, switch by typed title, stop with note, Today list, totals, and `Copy Report` Markdown with both Work Items

First real dogfood day:

- 2026-07-01 was tracked through Timeskein as the Session replacement
- Result: 6:11:08 active focus, 20 entrances, seven Work Items, four significant gaps
- The exported dogfood report was useful for discussing focus allocation, gaps, entry cost, and product friction
- App telemetry exposed two API errors from creating a Work Item directly in `Active`; this path is now covered by smoke tests and fixed in the agent
- The follow-up baseline adds Capture Inbox, so incoming events can be recorded during a focus block without turning them into timed work immediately

Second real dogfood day:

- 2026-07-02 was tracked through Timeskein without using Session in parallel
- Result: 6:31:31 active focus, 19 entrances, 12 Work Items, two significant gaps, one open gap
- The saved report had no API errors, copy failures, duplicate-title groups, or active-state split brain
- The report now includes Work Item notes for touched items, because those notes became important review context during the second day
- Capture Inbox was visible but not used; release-candidate status therefore remains open until incoming-event capture is tested in real work

Third real dogfood day and release baseline:

- 2026-07-03 was tracked through Timeskein without Session in parallel
- Result: 5:47:04 active focus, 11 entrances, eight Work Items, two significant gaps
- Capture Inbox was used in real active-focus situations: four captures were created during active focus, two were resolved, one was converted to a Work Item, and one remained open as visible follow-up
- The saved report had no API errors, copy failures, focus start/stop failures, Capture Inbox failures, duplicate-title groups, or active-state split brain
- This day accepted the macOS dogfood release baseline: Timeskein is good enough to replace Session for daily personal use, with known limitations documented in `dogfood-release-baseline.md`
- The first post-baseline slice added correction of stopped focus blocks and Work Item title/basic-field editing, so wrong Work Item assignments can be fixed before copying the final report.

## Implemented Features

- Focus Session panel
- Start focus from text by finding or creating a Work Item with that title
- Create Work Item also reuses an existing normalized title instead of creating a duplicate
- Create dialog defaults new Work Items to `unknown`; choosing `active` is an explicit focus-start action
- Start focus session from the selected Work Item
- Press `Space` with an empty focus input to start or switch to the selected Work Item
- Double-click a Work Item to start or switch focus to it
- Stop the active focus block by pressing `Enter` in the stop-note field or by clicking `Stop`
- Add a missed stopped focus block from Today before copying the final report
- Correct a stopped focus block from the Today list: edit start/end/note/Work Item or split it into two blocks
- Switch directly to another focus title from the active focus panel
- Set a Work Item to `active` to switch focus to it
- Move the active Work Item to another state to stop the linked focus block
- Delete the active Work Item to stop the linked focus block before the item is removed
- Reuse an existing Work Item when the typed title matches an existing title
- At most one active Work Item is kept in sync with the active focus session
- 25-minute target with elapsed contact time and overflow display
- Manual stop with optional note
- Active focus session restored from SQLite after frontend/app restart
- Today's focus blocks with total tracked time, work focus, non-work tracked time, entrance count, Activity Zone, stop notes, and significant gap ranges of 20+ minutes
- Day views include focus blocks that overlap the selected local day; duration totals are clipped to the selected day window
- Today and Markdown export show an `Open Gap` when no focus block is running and the interval after the last stopped block is at least 20 minutes
- Markdown reports use the corrected focus-session rows, so post-factum edits are reflected in copied day data
- Today shows a `Review before report` checklist for active-state blockers, open captures, significant gaps, open gaps, Activity Zone coverage, non-work tracking, capture coverage, Work Item context coverage, and focus-correction evidence. If no correction is needed, the user can explicitly accept tracking accuracy from the checklist, which writes `focus_correction_reviewed` telemetry. If open captures are intentionally left as follow-up, the user can explicitly accept them from the checklist, which writes `capture_followup_reviewed` telemetry. Copied UI dogfood reports include the same Daily Control Goal Audit as the CLI report.
- Today's focus picture can be copied as Markdown from the focus panel, including per-Work-Item totals, Activity Zone totals, and significant gaps
- Today's focus picture can also be exported from SQLite with `pnpm export:focus-day`
- Evening dogfood report can be copied from the focus panel, shown as selected Markdown if clipboard access fails, or generated with `pnpm dogfood:report`; UI and CLI reports include the same `Review Checklist`
- Day reports include a `Work Item Notes` section for touched Work Items that have non-empty notes
- Day reports include a `Day Events` section for timestamped notes that belong to the day rather than one Work Item
- Day reports include a `Work Item Events` section for timestamped Work Item observations created during the selected day
- The UI and CLI label the report as a draft while a focus block or Work Item is still active and include an active-state warning in the Markdown
- Capture Inbox for incoming events that should not interrupt the current focus block
- Captures link to the active focus session when one exists
- Open captures are visible in the focus panel
- Open captures can be edited, deleted, resolved as done, or converted into Work Items
- Captures can be appended as timestamped Work Item Events, using the linked focus session's Work Item or the currently selected Work Item as the target
- The dogfood report shows Capture Activity for captures created during the day, including captures that were already resolved or converted
- Open captures appear separately in the UI and CLI dogfood report for evening review
- Manual Work Item inventory UI
- Search
- `Recent`, `Today`, `Pinned`, and `All` Work Item list modes for a multi-day inventory, with `Alt+1..4` shortcuts
- Resizable divider between the Today list and Work Item inventory search/list area
- Create Work Item
- Edit Work Item title, type, Activity Zone, and note
- Add timestamped Work Item Events from the note editor
- Add timestamped Day Events from the focus panel for buffers, recovery notes, tracking corrections, and other review context
- Work Item cards show last touched time plus today/total tracked time when available
- Create Work Item directly in `active` starts or switches the focus timer instead of leaving split active state
- Touch
- State changes
- Notes
- Pin/unpin
- Refs UI and Local API methods
- Delete with confirmation
- Global shortcut registration with fallback candidates
- Tray/menu bar entry point on macOS with Show/Hide and Quit actions
- Tray/menu bar title shows a short active focus counter such as `12m Focus`, and today's total when no block is active
- The native shell refreshes the tray/menu bar title through the local API even when the webview window is hidden
- Borderless window can be moved by dragging the header
- The macOS window is not configured as always-on-top and is not skipped from normal app switching
- macOS `Reopen` is handled so a hidden window can be restored through the normal app return path
- `Esc` hides the macOS window when no dialog is open
- Palette shortcuts are ignored while typing in inputs, textareas, selects, or editable elements
- Destructive confirmation dialogs focus `Cancel` by default and do not confirm on `Enter`
- Focus input is refocused when the window becomes visible and no block is active
- SQLite storage through the embedded Rust agent
- Local app-event telemetry for dogfood analysis: app start, agent start/reuse/recovery, window show/hide/drag, window show/hide requests, focus start/switch/stop, Capture Inbox create/update/delete/resolve/convert, report copy, manual copy fallback, and API errors
- Mock server for browser development

## Focus Session Data

The first Focus Session baseline is intentionally small. It stores manual contact-time blocks:

- title copied from the linked Work Item
- Work Item link
- state: `active` or `stopped`
- target seconds, currently 25 minutes by default in the UI
- start time, stop time, updated time
- optional stop note

The Rust agent stores focus sessions in SQLite. Partial unique indexes enforce at most one active focus session and at most one active Work Item. Work Item `active` is treated as the UI marker for the currently timed item: switching it stops the old focus block and starts a new linked block, while stopping a linked focus block clears `active` from Work Items. On startup, the agent normalizes old active Work Item rows and stops an active focus session if its linked Work Item is missing or deleted. Starting focus from typed text first searches for an existing Work Item with the same normalized title; if none exists, it creates one.

Post-factum correction is implemented for stopped focus sessions. `focus.create_stopped` adds a missed stopped block without starting an active timer. `focus.update` edits the block title/Work Item, start, stop, target, and note. `focus.split` cuts one stopped block into left/right blocks at a timestamp; the right side can be assigned to another Work Item by title. This covers common tracking mistakes by adding a missed interval, splitting around the wrong interval, and updating the resulting block. The mock server exposes the same focus correction methods for browser development.

## Dogfood Findings

The 2026-07-01, 2026-07-02, and 2026-07-03 dogfood days showed that the core timer loop works, and that Capture Inbox can preserve incoming events without switching away from the current focus. The first post-baseline slice added post-factum correction; the next useful product slice is entry/window polish and richer day review.

High-signal findings:

- Quick text entry must stay safe: `C`/`С` opening Create while typing was a real blocker and is fixed.
- Creating a new Work Item directly as `Active` must work; the first dogfood day hit this twice and the path is now fixed.
- `last_seen_at` labels looked like spent duration; the UI now says `ago`.
- The report needs explicit zone totals before `break` or `idle` blocks can be tracked without polluting work-focus review.
- Work Item notes are still mutable descriptions; timestamped observations now live in separate Work Item Events.
- Capture Inbox worked in real use on 2026-07-03: incoming events were captured during active focus, then resolved or converted later.
- Work Item notes matter for review and appear in day reports for touched items; timestamped Work Item Events now cover day-specific observations.
- Some observations belong to the whole day rather than one Work Item. Day Events now cover buffers before heavy meetings, recovery notes, tracking corrections, and similar review context.
- Wrong Work Item assignment happened during dogfood; stopped blocks can now be corrected and split after the fact.
- Activity Zones are now available on Work Items and copied into each focus block as a snapshot. Stopped blocks can be corrected independently, so changing a Work Item later does not rewrite past day reports. The UI and Markdown separate total tracked time, work focus, non-work tracked time, and per-zone totals for work, coordination, recovery, idle, and personal.
- macOS window restore and the menu bar counter were newly fixed after the third dogfood day; the next dogfood day should verify that Command+Tab/Dock return and status refresh feel reliable in real use, with both show and hide request telemetry proving window entrypoints were exercised.

## Capture Inbox Data

Capture Inbox stores quick incoming-event notes in SQLite table `captures`.

The current baseline stores:

- free-form text entered by the user;
- state: `open`, `resolved`, or `converted`;
- optional link to the active focus session at capture time;
- optional link to a Work Item after conversion;
- created, updated, resolved, and converted timestamps.

Capture is intentionally separate from focus sessions. Creating, editing, deleting, resolving, or converting a capture must not stop or switch the active timer. Open captures can be edited or deleted during review; processed captures stay as day history. Converting a capture creates or reuses a Work Item by normalized title, but does not start focus on that Work Item. The dogfood report includes a `Capture Activity` table for all captures created during the selected day, with state, focus context, and outcome. The RC checker also counts how many captures were linked to an active focus session, because that is the real evidence for interruption handling during focus.

## Work Item Events

Work Item Events store timestamped observations in SQLite table `work_item_events`.
They are separate from the mutable Work Item `note` field:

- `note` is the current description/context of the Work Item;
- `note_added` events are dated observations for the day journal.

The current API surface is:

- `work_item.add_event` to append an event to a Work Item, optionally linked to the active focus session;
- `work_item.update_event` to edit user-authored `note_added` event text;
- `work_item.delete_event` to delete user-authored `note_added` events;
- `work_item.events` to list events by Work Item and/or time window.

The note editor can append a timestamped event without replacing the Work Item description. Capture Inbox can also append a capture as a Work Item Event, preserving the capture text and focus-session link. The focus panel shows Work Item Events for the day and lets user-authored note events be edited or deleted before the final report. UI/CLI Markdown exports include a `Work Item Events` section.

## Day Events

Day Events store timestamped day-level observations in SQLite table `day_events`.
They are for review context that is not naturally owned by one Work Item:

- buffer or mobilization before a heavy meeting;
- recovery notes after a demanding block;
- tracking corrections noticed during the day;
- context that explains a gap without turning it into timed work.

The current API surface is:

- `day_event.add` to append a day-level note, optionally linked to the active focus session and Activity Zone;
- `day_event.update` to edit the text or Activity Zone;
- `day_event.delete` to remove a user-authored day note;
- `day_event.list` to list day notes by time window.

The focus panel has a compact `Add day note...` input with an optional Activity Zone selector. Adding, editing, re-zoning, or deleting a Day Event must not stop or switch the active timer. Significant gaps and the current open gap have an `Explain` shortcut that prepares a Day Event with the gap range and duration. UI/CLI Markdown exports and the RC checker include a `Day Events` section.

## App Event Telemetry

The dogfood baseline stores a local append-only event journal in SQLite table `app_events`.
It is for evaluating Timeskein itself after a real workday, not for external analytics.

Tracked event groups:

- app and embedded-agent startup, reuse, and stale runtime recovery;
- window show, hide, and drag start;
- focus start, switch, stop requests and outcomes, including whether start came from typed text or selected/list continuation;
- Capture Inbox create, update, delete, resolve, convert requests and outcomes;
- report copy attempts, clipboard failures, and manual copy fallback;
- Local API errors.

Telemetry payloads are sanitized before storage. They can contain safe technical metadata such as control name, action id, duration, counters, and boolean flags. They must not contain raw Work Item titles, notes, URLs, search text, or other free-form user text. Analysis links events through `work_item_id` and `focus_session_id`, using the existing tables when names are needed.

Useful commands:

```bash
pnpm dogfood:metrics
pnpm export:app-events
pnpm dogfood:report
pnpm dogfood:finish:save
pnpm dogfood:goal-check
```

The report telemetry section includes action counts, typed entry and selected/list continuation evidence, start/switch/stop failures, Capture Inbox action counts and failures, API errors, window show/hide counts, both show and hide request counts, copy fallback counts, average start latency, likely show-to-start friction gaps, attempts to start the already active Work Item, and stale runtime recovery events.

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
- Focus Session has a compact day list and Markdown copy, but not a full reporting/JSON/CSV export view yet.
- App-event telemetry has CLI/report output, but no in-app inspection screen yet.
- Post-factum correction is intentionally basic: stopped blocks can be added, edited, reassigned, re-zoned, and split, but there is no drag timeline, bulk edit, or dedicated correction wizard yet.
- Capture Inbox is still compact: open captures can be edited or deleted, but there is no separate capture history screen beyond the open list and dogfood report.
- Work Item Events are report-visible. User-authored `note_added` events can be edited or deleted; generated system events remain internal history.
- Work Item notes are included in day reports for touched items, but they remain mutable descriptions rather than dated observations.
- macOS window restore and menu bar status refresh were newly fixed after the third dogfood day, but still need one real dogfood pass with both show and hide request telemetry before being considered fully proven.
- Activity Zones have per-focus-block snapshots and overrides; there is no bulk zone correction UI yet.
- Automated e2e tests are not implemented yet.
- Cross-platform CI is not implemented yet.
- Settings UI is not implemented yet.
- Agent lifecycle is minimal: embedded startup works, but production-grade diagnostics/restart handling are not done.
- Sync, SourceNodes, Context Capture, and Evidence-Mode are future levels, not current functionality.

## Next Engineering Steps

1. Verify the new macOS window return and native menu bar status refresh in the next dogfood day, including non-zero show and hide request counts for window entrypoints.
2. Add a clearer correction workflow if split + update + zone correction is not enough after the next dogfood day.
3. Verify capture-to-Work-Item-event promotion in the next dogfood day.
4. Decide whether the current per-block zone override is enough, or whether day review needs a faster bulk editor.
