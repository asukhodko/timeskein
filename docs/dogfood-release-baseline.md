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
  Capture Activity, open captures, Work Item notes, Work Item Events, and app telemetry.

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

- Focus correction is basic: stopped blocks can be edited, split, and reassigned,
  but there is no drag timeline, bulk edit, or dedicated correction workflow yet.
- Work Item editing covers title, type, Activity Zone, and note; refs, state,
  pinning, touch, and delete remain separate actions.
- Stop notes cannot be edited after the block is stopped.
- Work Item notes are mutable descriptions; timestamped observations are stored
  separately as Work Item Events.
- Capture Inbox cannot edit or delete captures, and cannot append a capture as
  a Work Item Event yet.
- Activity zones are Work Item-level only. Reports show zone totals, but the
  top-line `Total focus` still counts every tracked block.
- The macOS borderless window can stay visually on top in awkward moments and
  cannot be restored through Command+Tab after being hidden.
- The menu bar focus counter can lag until the status item is clicked.
- The Work Item list shows today/total time spent per item when available.

## Next Slice

Post-dogfood correction and first review enrichment are now partly implemented:

- stopped focus blocks can be edited, split, and reassigned by Work Item title;
- Work Item titles and basic fields can be edited with duplicate-title
  protection;
- copied reports use the corrected focus-session rows.
- Work Items carry Activity Zones, the list shows today/total spent time, and
  copied reports include Activity Zone totals.
- Timestamped Work Item Events can be appended from the note editor and appear
  in UI/CLI day reports.

Remaining entry and review polish:

- make hidden-window restore and status-bar updates less surprising;
- add capture-to-Work-Item-event promotion if captures often become review notes.
- decide whether top-line report totals should include filtered numbers such as
  work-only focus and recovery time.

Activity evidence from apps, browser tabs, messenger channels, screenshots, or
AI interpretation remains a future opt-in layer. It should not be started until
the manual correction loop is reliable.
