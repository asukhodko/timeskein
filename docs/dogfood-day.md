# Dogfood Day Protocol

Use this protocol when Timeskein replaces Session for one real workday.

## Quick Runbook

Before starting work:

```bash
pnpm dogfood:start
```

If the previous test database should be moved aside first:

```bash
pnpm dogfood:start:clean:preview
pnpm dogfood:start:clean
```

During the day:

- start a block by typing a Work Item title and pressing `Enter`;
- switch by typing the next title into `Switch to...` and pressing `Enter`;
- capture incoming distractions in `Capture interruption...` without stopping the current block;
- add day-level review notes in `Add day note...` when the observation is about the day, a gap, a buffer, or recovery rather than one Work Item;
- stop with optional note by pressing `Enter` in the stop-note field;
- watch the short `12m Focus` counter in the macOS menu bar while a block is running;
- hide/show the app from the menu bar item, global shortcut, or `Esc` when no dialog is open.

End of day:

- click `Copy Report` in Today and paste the dogfood report into the day note;
- if the button says `Copy Draft`, stop the active focus block or clear the active Work Item before treating the report as final;
- use `Copy MD` when only the raw day picture is needed;
- if clipboard access is unavailable, copy the selected Markdown from the fallback text box;
- if you want saved Markdown evidence, run `pnpm dogfood:finish:save`; it writes both the day report and the RC check;
- if UI copy fails, run `pnpm dogfood:finish > timeskein-dogfood-report.md`;
- if only the raw day picture is needed, run `pnpm export:focus-day > timeskein-day.md`.
- if Timeskein itself felt awkward, run `pnpm dogfood:metrics` and `pnpm export:app-events` to inspect the local app-event telemetry.

Saved dogfood reports and RC checks can contain personal or internal work context. They are local evidence files and are ignored by git.

## Goal

Timeskein is ready for regular use when it can capture a workday without side tracking:

- what focus blocks happened;
- which Work Item each block belonged to;
- which Work Item descriptions were relevant to the day;
- which timestamped day-level observations were recorded;
- which timestamped Work Item observations were recorded during the day;
- how long each block lasted;
- where the meaningful gaps were;
- how much active focus time the day contained.

## Before the Day

Run the start gate:

```bash
pnpm dogfood:start
```

It checks the real local database first, then checks that no old `timeskein-desktop` process is running. After that it runs preflight, opens the macOS app if all gates pass, and waits for the embedded agent to respond.
If Timeskein is already running, the start gate refuses to continue. Quit the existing app first so the dogfood day uses the freshly built app.
If old `agent.lock` / `agent.port` files are left behind, the app probes the recorded port and starts a fresh embedded agent when the old one is not responsive.
If you intentionally want a clean trial database, run `pnpm dogfood:start:clean`. It moves the current SQLite files to timestamped backup names, then runs the same start gate.
To preview that clean start without moving files, opening the app, or running preflight:

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

If readiness reports active focus, active Work Items, duplicate titles, or existing blocks for today, fix that before treating Timeskein as the source of truth for the day. The readiness report includes exact next commands and shows whether the embedded agent or app process is already alive.

The default readiness mode is a clean start gate. After the day already has real focus blocks, use continue mode for a health check:

```bash
pnpm dogfood:ready -- --mode continue
```

Continue mode allows existing focus blocks and one coherent active focus block linked to exactly one active Work Item. It still rejects duplicate titles and active-state split brain.

If the readiness report shows existing blocks for today and you want a clean trial, prefer resetting the trial database. If it shows only an old active focus block and no existing day blocks, close only that active block:

```bash
pnpm dogfood:stop-active
pnpm dogfood:stop-active -- --apply
pnpm dogfood:ready
```

The first command is a dry run. It does not remove today's existing blocks; it only plans to stop active focus sessions and clear active Work Items. For a clean one-day trial, reset the database instead.
When Timeskein is running and the agent responds, the applied stop uses the local agent API. When the agent is not responsive and no app process is running, it falls back to direct SQLite update. If the app process is still alive but the agent is not responsive, the script refuses without `--force`. Applied stops add a note to the stopped block: `closed by dogfood:stop-active` by default, or a custom value passed with `--note`.

For a clean trial database, quit Timeskein and move the current SQLite files aside:

```bash
pnpm dogfood:reset-db
pnpm dogfood:reset-db -- --apply
pnpm dogfood:ready
```

The first command is a dry run. The second command moves `timeskein.db` and its SQLite sidecar files to timestamped backup names; it refuses to run while the embedded agent or app process appears to be alive unless `--force` is passed.
The one-command equivalent for the real dogfood start is:

```bash
pnpm dogfood:start:clean
```

Preview it first with:

```bash
pnpm dogfood:start:clean:preview
```

Build or reuse the current macOS app:

```bash
pnpm dogfood:macos
```

If the shell says `permission denied` for `Timeskein.app`, the app bundle was executed as a file. Use `open .../Timeskein.app` or run the binary directly:

```bash
target/release/bundle/macos/Timeskein.app/Contents/MacOS/timeskein-desktop
```

Check the basics before starting work:

- Timeskein opens from the menu bar item.
- The menu bar item shows the active focus duration while a block is running.
- `pnpm dogfood:status` reports `Status: READY`.
- The window can be moved by dragging the header.
- The window can be hidden with `Esc` when no dialog is open and shown again.
- Today is visible.
- The divider above Work Item search can resize the Today list; double-click resets it.
- There is no unexpected active focus block from a previous experiment.

## Next Dogfood Focus

The next dogfood day must verify the post-baseline daily-control loop, not only
that the timer still works. During the day, deliberately exercise these paths
when the real situation appears:

- open, hide, and restore Timeskein through the menu bar, `Esc`, Command+Tab,
  and the normal app entrypoint;
- start one new Work Item by typed title and continue one existing Work Item
  from the list;
- use at least two Activity Zones, with one non-work zone such as `recovery`,
  `idle`, `coordination`, or `personal`;
- add one Day Event with an explicit zone;
- use `Explain` on a significant gap or open gap, then edit the prepared Day
  Event text or zone before the final report;
- add or promote one timestamped Work Item Event if a detail matters for
  evening analysis;
- create at least one capture during an active focus block and resolve,
  convert, or consciously leave it open for the report;
- intentionally correct one safe tracking detail before final copy, such as a
  stopped block note, Work Item assignment, split point, or Activity Zone.

At evening review, the goal is not a perfect day. The goal is a report that lets
the day be discussed without reconstructing the timeline from memory. `Copy
Report`, `pnpm dogfood:report`, and `pnpm dogfood:finish:save` include a
`Daily Control Goal Audit` section before the raw focus data, so weak evidence
is visible during the normal report flow, not only in the separate RC check.
With `--save`, the separate RC check is saved automatically next to the day report.

## Readiness Audit

Current status: the macOS dogfood release baseline was accepted on 2026-07-03. Timeskein is usable as the primary daily personal focus tracker, with known limitations documented in [Dogfood Release Baseline](dogfood-release-baseline.md).

| Requirement | Evidence before dogfood | Dogfood check |
| --- | --- | --- |
| Fast automated regression suite | `pnpm test` runs contracts build, TypeScript typecheck, Rust agent tests, mock-store tests, mock API smoke, and key SQLite/report smoke checks | The local baseline is green before the day starts |
| Fast start by title | `pnpm smoke:focus-api` and `pnpm smoke:macos-app` verify `focus.start` creates or reuses a Work Item | Starting a block feels cheap enough during real work |
| No duplicate Work Items by title | Smoke checks `focus.start` and `work_item.create` title reuse | No duplicate Work Items appear from normal typing |
| One active timer and one active Work Item | Smoke checks switching by title, by Work Item state, deleting the active Work Item, SQLite single-active guards, and startup normalization | No visible split brain while switching tasks |
| Stop and later continue same Work Item | Smoke checks repeat `focus.start` with the same title | Continuing yesterday/today items is discoverable |
| Show, hide, move window | Implemented in macOS shell and header drag | Window behavior does not irritate during the day |
| Today block list and totals | `focus.list` and UI show block duration, time range, stop note, work focus, total tracked time, zones, and entrances | The list matches remembered work blocks |
| Post-factum correction | `cargo test -p timeskein-agent`, `pnpm smoke:corrections-api`, and `pnpm smoke:macos-app` verify missed-block creation, update, split, reassignment, Work Item edit, and corrected day-list data | Wrong or missing Work Item intervals can be fixed before copying the final report |
| Significant gaps | UI and Markdown show gap ranges of 20+ minutes | Long breaks and lost intervals are visible enough |
| Capture Inbox | `pnpm smoke:capture-api`, `pnpm smoke:mock-api`, and `pnpm smoke:macos-app` verify capture create/list/update/delete/resolve/convert/append-event without interrupting focus | Incoming events can be remembered and cleaned up without switching away from the current block |
| Markdown export | `Copy Report` exports timeline, `By Work Item`, Activity Zone totals, Day Events, Work Item Events, gaps, Capture Activity, open captures, Review Checklist, app telemetry, and review prompts; `Copy MD` exports the raw day picture; failed clipboard writes show selected Markdown; `pnpm smoke:export-focus-day` and `pnpm smoke:dogfood-report` verify SQLite fallbacks | Copied note is enough for evening analysis |
| App friction telemetry | `app_events` stores local technical events, `pnpm smoke:app-events` verifies metrics/export, and `pnpm dogfood:report` includes `App Telemetry` | Start/switch/stop/copy/API/window friction is visible without relying only on memory |
| macOS app with embedded agent and SQLite | `pnpm smoke:macos-app` verifies app launch, SQLite health, focus flow, stale lock/port recovery, and active focus restore after app restart | The real app survives normal workday use |

The dogfood goal is complete only after a real day produces a copied Markdown day note that is useful for analysis.

The first real dogfood day met this gate:

- 6:11:08 active focus
- 20 entrances
- seven Work Items
- four significant gaps
- usable Work Item totals and App Telemetry

Product friction found during the day is tracked in the roadmap. The most important next dogfood check is whether Capture Inbox makes incoming events cheap to remember without interrupting the current focus block.

The second real dogfood day on 2026-07-02 showed that the core timer loop was enough to stop using Session in parallel:

- 6:31:31 active focus
- 19 entrances
- 12 Work Items in the day report
- two significant gaps and one open gap
- no API errors, copy failures, duplicate-title groups, or active-state split brain in the saved report

The third real dogfood day on 2026-07-03 closed the Capture Inbox release-candidate gap:

- 5:47:04 active focus
- 11 entrances
- eight Work Items in the day report
- two significant gaps
- four captures created during active focus
- two captures resolved, one converted to a Work Item, one left open as visible follow-up
- no API errors, copy failures, capture failures, duplicate-title groups, or active-state split brain

Remaining friction is tracked as post-baseline work. Post-factum focus correction, Work Item title/basic-field editing, today/total time columns, macOS window restore, and native menu bar status refresh are implemented. The next dogfood day should verify the macOS entry fixes in real use.

For the stricter daily-use gate, use [Dogfood Release Candidate](dogfood-release-candidate.md). The day protocol explains how to run the test; the release-candidate gate decides whether the current baseline is good enough to replace Session.

## During the Day

Start a focus block from the input:

1. Open Timeskein.
2. Type the name of the thing you are starting.
3. Press `Enter` or click `Start`.

Expected behavior:

- If a Work Item with the same title already exists, Timeskein reuses it.
- If no Work Item exists, Timeskein creates one.
- Starting a new focus block stops the previous active block.
- There is only one active Work Item and one active timer.
- Today and the Markdown export include blocks that overlap the selected local day, even when a block started before the day boundary. These show up as `Day-Boundary Blocks`; the duration is counted as that day's clipped contribution.

Switch directly to another item:

1. Type the next thing into `Switch to...`.
2. Press `Enter` or click `Switch`.

This stops the current block without a note and starts a new linked block. Use `Stop` first if the previous block needs a note.

Continue an existing item:

1. Use `Recent`, `Today`, `Pinned`, or `All` to narrow the Work Item list if needed.
2. Select the Work Item.
3. Leave the focus input empty and press `Space`, or click `Start Item` / `Switch Item`.

Faster path: double-click a Work Item to start or switch focus to it.
Use `Alt+1`, `Alt+2`, `Alt+3`, and `Alt+4` to switch `Recent`, `Today`, `Pinned`, and `All` without leaving the keyboard.
Typed search can still find old Work Items when the current mode is too narrow.

Changing a Work Item state to `Active` is another way to start or switch focus:

- pressing `1` on a selected Work Item starts or switches to that Work Item;
- choosing `Active` in the state menu does the same;
- moving the currently active Work Item to any other state stops the current focus block.

Deleting the currently active Work Item also stops its current focus block first.

Capture an incoming event without switching focus:

1. Type the reminder into `Capture interruption...`.
2. Press `Enter` or click `Capture`.
3. Continue the current focus block.

Expected behavior:

- the active focus timer keeps running;
- the capture appears in `Inbox`;
- `Done` resolves it when no further action is needed;
- `Edit` cleans up the text while it is still open;
- `Del` removes an open capture that is just noise;
- `Make Item` converts it into a Work Item for later handling.

Stop a focus block when the contact with the work stops:

1. Add a short stop note if it will help evening review.
2. Press `Enter` in the stop-note field or click `Stop`.

Use stop notes for facts, not narration:

- `blocked by access`;
- `waiting for answer`;
- `lost context after meeting`;
- `done enough for today`.

Do not use Work Item state as a separate timer. In the current model, `active` means "this item is being timed now".
Creating a Work Item from the `+` dialog does not start a timer unless `Active` is explicitly selected.

## Evening Review

At the end of the day:

1. Open Timeskein.
2. Check Today work focus, total tracked time, zones, and entrance count.
3. Clear or consciously accept every `Review before report` item.
4. Click `Copy Report`.
5. Paste the Markdown dogfood report into the day note or analysis thread.

Use `Copy MD` only when the raw day picture is enough.
If Today or the report shows `Open Gap`, there was a significant interval after the last stopped block with no active focus block. Treat it as either a real break or a lost-tracking interval during review.
If the report shows `Open Captures`, edit, delete, resolve, or convert them before considering the day fully reviewed.
If Today or the report shows `Review Checklist`, use it as the minimal evening queue: active-state blockers must be cleared, review items should be classified or consciously accepted before treating the report as final.
The checklist also flags weak day evidence, such as all blocks landing in one Activity Zone, zero non-work tracked time, no Work Item notes/events for context, or no focus correction evidence. If the timeline is already accurate, use `Accept` on the tracking-accuracy review item so the report records that the correction pass was consciously done.
If a focus block is still active, or a Work Item is still marked active, the UI labels the report as `Copy Draft` and the Markdown includes a warning. The CLI report uses the same draft warning. Stop the active block or clear the active Work Item before using the report as the final day artifact.
If clipboard access is denied, Timeskein shows a selected text box with the Markdown. Copy it manually from there.

If the UI copy path is unavailable, export the same raw day picture from SQLite:

```bash
pnpm export:focus-day > timeskein-day.md
```

For the preferred evening review artifact, generate the dogfood report:

```bash
pnpm dogfood:finish:save
```

This writes `timeskein-dogfood-report-YYYY-MM-DD.md` in the current directory. To print the report to stdout instead:
It also writes `timeskein-dogfood-rc-check-YYYY-MM-DD.md`, so the evening evidence package has both the readable report and the stricter RC audit.

```bash
pnpm dogfood:finish > timeskein-dogfood-report.md
```

`dogfood:finish` refuses to produce a final report while a focus block or Work Item is still active, or when there are no focus blocks for the selected date.
The focus-day export includes a `Work Item Notes` section for touched Work Items that have a non-empty note. This is for current Work Item context. Use timestamped Work Item Events for observations tied to a concrete moment in the day; those appear separately in `Work Item Events`. If a timestamped event was written with a typo or in the wrong form, edit or delete it from the Work Item Events panel before copying the final report.
Use `Add day note...` for observations that explain the day but do not belong to one Work Item: buffer before a heavy meeting, recovery debt, tracking correction reminders, or why a gap happened. Choose a zone explicitly when the observation is really about `coordination`, `recovery`, `idle`, or `personal`; otherwise Timeskein uses the current focus or selected Work Item context. Significant gaps and the current open gap have an `Explain` shortcut that prepares a Day Event with the gap range, duration, and `Recovery` as the initial zone. These notes appear in `Day Events` and can be edited, re-zoned, or deleted before copying the final report.
The dogfood report also includes `Capture Activity` for every capture created during the selected day, including captures that were already resolved or converted. `Open Captures` remains a separate action list for unresolved inbox entries.
For the release-candidate verdict, inspect whether `Capture Activity` rows were created during a real focus block. A capture made after stopping all work proves the inbox can store text, but it does not prove interruption handling during focus.

The dogfood report includes an `App Telemetry` section. Use it to check whether Timeskein caused tracking friction:

- start, switch, and stop request counts;
- start/stop/copy/API errors;
- window show/hide and drag counts;
- average delay from start request to started focus;
- likely show-to-start friction gaps;
- repeated attempts to start the already active Work Item;
- stale embedded-agent runtime recovery events.

For deeper inspection:

```bash
pnpm dogfood:metrics
pnpm export:app-events
```

Telemetry stays local in SQLite. Event payloads are technical only; raw Work Item titles, notes, URLs, and typed text should not appear there.

For a Dogfood Release Candidate day, rerun the RC evidence check when you want to inspect it without re-saving the day report:

```bash
pnpm dogfood:rc-check:save
```

The command prints hard blockers and review items for the Session replacement gate. Its evidence summary includes total tracked time, work focus, non-work tracked time, Activity Zone coverage, Work Item notes/events, Capture Inbox coverage, correction telemetry, window telemetry, and product-friction counters. The same `Daily Control Goal Audit` framing maps the day to the active daily-control goal: focus blocks, Work Item totals, Activity Zones, notes/events, gaps/captures, window friction evidence, tracking correction evidence, hard blockers, and the manual local gates.
Before marking the daily-control goal complete, run the strict form. It exits with code 1 if any review item remains:

```bash
pnpm dogfood:rc-check:strict
```

The RC-check scripts read old SQLite databases defensively. If a previous dogfood day was captured before Activity Zone columns existed, reports fall back to `Work` rather than crashing. A fresh dogfood day should still be started through the app so real migrations run before new data is captured.

For a previous date:

```bash
pnpm export:focus-day --date 2026-06-30 > timeskein-day.md
pnpm dogfood:finish -- --date 2026-06-30 > timeskein-dogfood-report.md
pnpm dogfood:rc-check -- --date 2026-06-30 --save
```

The dogfood report includes the focus-day export and prompts for:

- Is every real focus block represented?
- Does `By Work Item` match where the day actually went?
- Are the Work Item titles understandable the next day?
- Are there duplicate Work Items that should have been reused?
- Are long gaps visible and plausible?
- Did stopping and continuing the same Work Item feel cheap enough?
- Did the app itself create friction that pushed tracking away?
- Where did entry cost appear before starting the next block?
- Does `App Telemetry` confirm the remembered friction, or show hidden friction such as repeated show-without-start attempts?
- Did Capture Inbox prevent interruption, or did captures become another unresolved pile?

## Success Criteria

The dogfood day succeeds if the copied Markdown is enough to discuss:

- where active work time went;
- which Work Items moved;
- which day-level events explain buffers, recovery, gaps, or tracking corrections;
- when the day fragmented;
- where entry cost or switching cost appeared;
- where Timeskein itself created start, switch, stop, copy, or window-management friction;
- whether incoming events were captured and reviewed without derailing current work;
- what must be improved before using Timeskein daily.

The dogfood day fails if any of these happens often enough to break trust:

- focus blocks are missing;
- duplicate Work Items appear from normal use;
- more than one active timer or active Work Item appears;
- continuing an earlier item is hard to discover;
- Today cannot explain the day without memory reconstruction;
- the app window is annoying to show, hide, or move.

## Known Limits for This Trial

- There is no pause/resume/cancel model yet. Stop and start again instead.
- Stopped focus blocks can be edited, re-zoned, reassigned, or split from the Today list. The correction workflow is basic: there is no drag timeline or bulk edit yet.
- Capture Inbox is compact. It can create, edit/delete open captures, resolve, convert captures, and append them as Work Item Events, but it has no separate capture history screen yet.
- Activity Zones are copied from the Work Item into each focus block. A Work Item named `Break` should default to `recovery` or `idle`; an individual stopped block can still be corrected later. Non-work zones contribute to `Total tracked`, but not to `Work focus`.
- Work Item notes are a single mutable field; timestamped observations are separate Work Item Events. Day-level observations are separate Day Events. User-authored Day Events and Work Item Events can be edited or deleted, while generated system history is not exposed as an editable log.
- There is no automatic active-window detection.
- There is no synchronization between devices.
- Browser development mode uses mock data; the real dogfood trial should use the macOS app.
- The export is Markdown copy only, not a full reporting screen.
- App telemetry has CLI/report output only; there is no in-app diagnostics screen yet.
