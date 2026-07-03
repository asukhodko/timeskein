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
- produce an end-of-day report with focus blocks, Work Item totals, gaps,
  Capture Activity, open captures, Work Item notes, and app telemetry.

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

- Focus blocks cannot be edited, split, moved, or reassigned after the fact.
  When a timer is left on the wrong Work Item, the report preserves total focus
  time but Work Item totals need a manual note.
- Work Item title editing is not implemented yet; current Work Item editing is
  limited to notes, refs, state, pinning, touch, and delete.
- Stop notes cannot be edited after the block is stopped.
- Work Item notes are mutable descriptions, not timestamped activity notes.
- Capture Inbox cannot edit or delete captures, and cannot append a capture as
  a timestamped Work Item note yet.
- Activity zones are not implemented, so breaks tracked as Work Items still
  count into total focus.
- The macOS borderless window can stay visually on top in awkward moments and
  cannot be restored through Command+Tab after being hidden.
- The menu bar focus counter can lag until the status item is clicked.
- The Work Item list does not yet show today/total time spent per item.

## Next Slice

Post-dogfood correction was the next useful engineering slice and is now partly
implemented:

- stopped focus blocks can be edited, split, and reassigned by Work Item title;
- Work Item titles and basic fields can be edited with duplicate-title
  protection;
- copied reports use the corrected focus-session rows.

Remaining entry and review polish:

- make hidden-window restore and status-bar updates less surprising;
- show today/total time in the Work Item list;
- add timestamped notes or events if stop notes and captures are not enough.

Activity evidence from apps, browser tabs, messenger channels, screenshots, or
AI interpretation remains a future opt-in layer. It should not be started until
the manual correction loop is reliable.
