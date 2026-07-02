# Timeskein Dogfood Release Candidate

This gate decides whether Timeskein is ready to replace the useful free part of
Session for daily personal focus tracking.

The first real dogfood day on 2026-07-01 proved that the core timer loop can
produce a useful workday report. The release-candidate gate is stricter: it must
prove that the current baseline, including Capture Inbox, can survive another
real workday without falling back to Session.

## Scope

In scope:

- macOS app with embedded Rust agent and local SQLite;
- manual focus-session tracking;
- Work Items created or reused by title;
- Capture Inbox for incoming events that should not interrupt focus;
- Markdown day report, open captures, gaps, Work Item totals, Work Item notes, and app telemetry;
- documentation, known limits, and opskarta status.

Out of scope for this gate:

- Windows and Android;
- sync and multi-device continuity;
- Evidence Mode and active-window automation;
- body metrics integrations;
- full reporting UI;
- activity zones, unless break tracking corrupts the next dogfood day enough to
  block trust in the data.

## Start Conditions

Before the RC dogfood day:

1. `git status --short` is clean or all local changes are intentionally unrelated.
2. `pnpm dogfood:preflight` passes.
3. The app is started through `pnpm dogfood:start` or `pnpm dogfood:start:clean`.
4. Session is not used as a parallel source of truth during the day.

## During The Day

Track every intentional block of contact with work:

1. Start or switch focus through the main input, selected Work Item, or state
   change to `Active`.
2. Use `Capture interruption...` for incoming events that should be remembered
   without switching away from the current block.
3. Stop the focus block when real contact with the work stops.
4. Use stop notes for facts that help evening review.
5. Do not track breaks as focus unless the break itself is intentionally being
   studied; activity zones are not implemented yet.

## End-Of-Day Evidence

Save the report:

```bash
pnpm dogfood:finish:save
```

Inspect the telemetry when something felt wrong:

```bash
pnpm dogfood:metrics
pnpm export:app-events
```

Run the release-candidate evidence check:

```bash
pnpm dogfood:rc-check:save
```

`dogfood:rc-check` does not replace the human verdict. It catches hard blockers
and prints review items that must be resolved or consciously accepted before the
milestone can be marked done. `dogfood:rc-check:save` writes
`timeskein-dogfood-rc-check-YYYY-MM-DD.md` next to the saved day report.
Both saved files can contain personal or internal work context and are ignored by git.

The final evidence must include:

- focus blocks for the real workday;
- total focus time;
- Work Item totals;
- Work Item notes for touched items;
- significant gaps and open gap, if any;
- open captures, if any;
- App Telemetry;
- `dogfood:rc-check` output;
- a short written review of missing blocks, wrong Work Items, unresolved
  captures, and product friction.

## Pass Criteria

The RC passes only if all of these are true:

- Timeskein was the primary focus tracker for one full real workday.
- The day report is enough to discuss where the day went without rebuilding the
  timeline from memory.
- Capture Inbox was used or consciously tested, and the result is known: it
  either helped preserve focus, or it produced specific blockers to fix.
- No focus blocks are missing often enough to break trust.
- No duplicate Work Items appear from normal title reuse.
- At most one active timer and one active Work Item exist during normal use.
- Starting, switching, stopping, hiding, showing, and copying the report are
  cheap enough to keep tracking during the day.
- Open captures are resolved, converted, or explicitly accepted as remaining
  follow-up work.
- Remaining limitations are documented and are not blockers for daily use.
- The roadmap marks the release baseline according to the actual result.

## Fail Criteria

The RC fails if any of these happens often enough to make Session feel safer:

- missing or wrong focus blocks;
- unclear Work Item reuse or normal-use duplicates;
- split-brain active state;
- Capture Inbox becomes an unresolved pile instead of preserving focus;
- window/tray behavior prevents quick tracking;
- report data cannot explain the day without substantial memory reconstruction;
- local agent or database behavior makes data loss plausible.

When the RC fails, fix only the blockers shown by the day evidence and run
another dogfood day. Do not expand the scope to future platforms, sync,
automation, or health-data integrations before the Session replacement baseline
is trustworthy.
