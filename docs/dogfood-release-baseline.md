# Timeskein Dogfood Release Baseline

Status: accepted for daily personal use on macOS.

Date accepted: 2026-07-03.

## Verdict

Timeskein is good enough to replace the free useful part of Session for daily
personal focus tracking on macOS.

This does not mean the product is polished. It means the core loop is
trustworthy enough for regular dogfooding:

- start or switch a focus block quickly;
- keep one active timer and one active Work Item;
- capture incoming interruptions without switching away from the current block;
- produce an end-of-day report with focus blocks, Work Item totals, Activity Zone totals, gaps,
  Capture Activity, open captures, Day Events, Work Item notes, Work Item Events, and app telemetry.

## Evidence

Three real dogfood days were completed:

| Date | Focus | Entrances | Capture result | Notes |
| --- | ---: | ---: | --- | --- |
| 2026-07-01 | 6:11:08 | 20 | not available yet | Proved the basic timer/report loop and exposed first friction. |
| 2026-07-02 | 6:31:31 | 19 | 0 captures | Proved Timeskein could be used without Session in parallel. |
| 2026-07-03 | 5:47:04 | 11 | 4 captures during active focus | Proved Capture Inbox in real use: 2 resolved, 1 converted, 1 left open as follow-up. |

The 2026-07-03 release-candidate check reported:

- 4 captures created during active focus;
- 0 API errors;
- 0 copy failures;
- 0 focus start/stop failures;
- 0 Capture Inbox failures;
- 0 duplicate normalized Work Item titles;
- no active focus session or active Work Item left at end of day.

One open capture remained in the evening report. This is accepted for the
baseline because the report surfaced it explicitly and it did not indicate a
Capture Inbox failure or data-loss risk.

## Known Limitations

These were accepted limitations for the dogfood baseline, not blockers:

- Focus correction is basic: stopped blocks can be added, edited, split, and
  reassigned, but there is no drag timeline, bulk edit, or dedicated correction
  workflow yet.
- Work Item editing covers title, type, Activity Zone, and note; refs, state,
  pinning, touch, and delete remain separate actions.
- Stop notes can be edited through the basic focus-block correction dialog, but
  there is no dedicated quick-edit flow yet.
- Work Item notes are mutable descriptions; timestamped observations are stored
  separately as Work Item Events.
- Capture Inbox can edit/delete open captures and append captures as Work Item
  Events. A fuller capture history screen is not implemented yet.
- Activity zones are copied from Work Items into focus blocks. Stopped blocks
  can be corrected independently, and reports separate `Total tracked`,
  `Work focus`, non-work tracked time, and per-zone totals.
- macOS window restore and menu bar status refresh were known baseline
  limitations; both have been fixed in code after acceptance. The next dogfood
  day should confirm them in real use, and show/hide request telemetry should
  prove that window entrypoints were exercised.
- The Work Item list shows today/total time spent per item when available.
- The Work Item list now has `Recent`, `Today`, `Pinned`, and `All` modes; the
  next dogfood day should verify that the accumulated multi-day inventory stays
  cheap to navigate.
- The Today list height can be resized relative to the Work Item inventory; the
  next dogfood day should verify whether this is enough for review-heavy days.

## Next Slice

Post-dogfood correction and first review enrichment are now partly implemented:

- missed stopped focus blocks can be added without starting an active timer;
- stopped focus blocks can be edited, split, reassigned by Work Item title, and
  re-zoned;
- Work Item titles and basic fields can be edited with duplicate-title
  protection;
- copied reports use the corrected focus-session rows.
- Work Items carry Activity Zones, focus blocks keep zone snapshots, the list
  shows today/total spent time, and copied reports include Activity Zone totals.
- Timestamped Work Item Events can be appended from the note editor and appear
  in UI/CLI day reports.
- Timestamped Day Events can be appended from the focus panel and appear in
  UI/CLI day reports and RC evidence.
- Captures can be appended as timestamped Work Item Events.
- Open captures can be edited or deleted before the final day report.
- User-authored Work Item Events can be edited or deleted before the final day
  report.
- User-authored Day Events can be edited or deleted before the final day report.
- Today and copied reports include an automatic Review Checklist for active-state
  blockers, open captures, significant gaps, open gaps, Activity Zone coverage,
  non-work tracking, capture coverage, and Work Item context coverage.
- App Telemetry and RC checks include show/hide request counts, so the
  next dogfood day can distinguish real window entrypoint tests from passive
  visibility changes.
- Work Items can be viewed through `Recent`, `Today`, `Pinned`, and `All` modes,
  while search remains the path to older matching items.
- The Today/Work Item split can be resized and reset locally.

Remaining entry and review polish:

- verify that the Review Checklist catches the actual evening cleanup during
  the next dogfood day.
- verify that Day Events make buffers, recovery debt, gap explanations, and
  tracking corrections visible without relying on memory.
- decide whether per-block zone correction is enough, or whether day review
  needs a faster bulk zone editor.

Activity evidence from apps, browser tabs, messenger channels, screenshots, or
AI interpretation remains a future opt-in layer. It should not be started until
the manual correction loop is reliable.
