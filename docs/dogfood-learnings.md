# Dogfood findings: 2026-07-01 through 2026-07-24

## Status

This document summarizes eighteen real workdays of using Timeskein as the primary
personal work journal. It records product conclusions, not a complete diary.
Internal work names, people, links, and identifiers are intentionally omitted.

## What the trial established

### Timeskein already replaced the timer it set out to replace

By the second dogfood day, the basic loop was useful enough to stop running
Session in parallel. Starting, switching, stopping, restoring, correcting, and
exporting focus blocks now form a viable local macOS baseline.

This result matters, but it is no longer the main product claim. The timer is
the sensor at the edge of a larger control loop.

### The difficult part is usually the transition, not sustained execution

Across the trial, work often became comfortable once one direction had been
selected and entered. Friction returned after a stop, a meeting, a break, or
the completion of a block. The expensive operation was repeatedly:

```text
many possible obligations -> one legitimate next action -> renewed contact
```

Timeskein should therefore optimize the cost of choosing, entering, resuming,
and closing work. Maximizing tracked minutes is not the objective.

### Coordination, anticipation, and recovery are real states

The day cannot be described honestly as only `work` and `not work`.
Coordination, pre-meeting buffers, meeting tails, recovery, idle loss of
manageability, and personal activity have different meanings. Activity Zones
made this visible and prevented coordination or recovery from being confused
with executive output.

The useful daily distinction is:

- **executive work**: direct progress inside the `work` zone;
- **working occupancy**: executive work plus coordination;
- **non-work tracked time**: recovery, idle, and personal zones;
- **untracked gaps**: unknown until classified, not automatically waste.

### Duration proves contact, not progress

Long blocks and high totals did not reliably answer what changed. The useful
trace appeared only when the user could connect:

```text
intent -> action -> changed state -> evidence -> next action
```

This is why typed results, evidence Refs, next actions, corrections, and
Reflection follow-ups are now more important than adding another timer chart.

### Visibility changes behaviour, so metrics need restraint

The visible day journal encouraged returning to the selected work and exposed
lost tracking. It also created a temptation to avoid empty gaps for their own
sake. Timeskein must not turn coverage into a score of personal worth or treat
an uninterrupted timeline as inherently good.

Reports should present facts, unknowns, and user-confirmed classifications.
They should not infer laziness, productivity, or value from duration alone.

### Data trust requires correction and provenance

Real use produced missed starts, wrong Work Item attribution, forgotten stops,
legacy classification, duplicate concepts, and one overlapping historical
interval. Post-factum correction, immutable semantic snapshots, superseding
state records, and overlap detection are core product behaviour rather than
administrative polish.

Timeskein must preserve the difference between:

- what the user explicitly recorded;
- what the system observed;
- what was reconstructed from current data;
- what remains unknown.

### Working memory is implemented, but long re-entry is still unproven

Capture Inbox proved that an incoming event can be preserved without switching
the active focus. Day Events and Work Item Events preserved useful thoughts in
reports. Working Memory Bridge now adds the missing calm surface: chronology,
materials, stages, revisions, results, changed state, next actions, and
deterministic Work Item/Track Context Packs.

The first real confirmed result was added on 2026-07-23. On 2026-07-24 the
same Work Item was opened again, received another real entry and a 16-minute
focus block, while the ordinary day still closed cleanly in 37 seconds. Seven
later ordinary workdays produced `52:13:58` tracked and 104 entrances, including
`12:18` on the selected Work Item, without adding new memory, materials, causal
stop traces, or re-entry actions. This natural pre-D0 baseline proves runtime
compatibility, but it also shows that ordinary tracking cannot substitute for
the explicit memory-return path. D0 therefore has not started. Product
acceptance still depends on one complete baseline and returns after distinct 1,
3, and 7 day pauses without an external task-memory notebook; unrelated daily
contract and closure rituals are not required on intervening days.

### Portability, synchronization, and interface density are separate problems

The eighteenth real day exposed three future needs without changing the
current gate:

- trustworthy state portability starts with a verified backup/restore bundle;
  cloud or multi-device synchronization is a later conflict-resolution
  problem, not a substitute for backup;
- the power-user desktop workspace now contains enough capability that compact
  desktop and mobile clients need role-based surfaces, not a uniformly scaled
  version of the full canvas;
- a redundant Work Item should be merged into its canonical item, while real
  substructure belongs in stages or a deliberate hierarchy. The `ППП` /
  `ППП: Работа с материалами` case is a real acceptance candidate for the
  already implemented merge path.

The missed-block dialog also revealed a smaller consistency issue: exact title
matching preserves identity, but correction should use the same searchable
Work Item picker as contract composition to avoid accidental near-duplicates.

### Operational Reality is the strongest new direction

The accepted two-day Operational Reality gate showed that a derived but
correctable projection can narrow a large inventory into a useful attention
queue. Starting from a card, correcting state, preserving the reason, carrying
a Reflection follow-up, and exposing the next action all worked on real days.

Operational Workspace resolved the structural split between Operational
Reality, dispatch, the day contract, and the full inventory. Its four-day gate
proved morning entry, post-break return, immutable revisions, and normal
closure without a parallel external active-list.

Day 19 exposed an overcorrection in that convergence. The UI had started to
call the entire surface `Рабочий контур` and hid the full derived Reality when
there was no contract. These are different things: Reality is what the stored
facts currently imply; Contour is what the user has deliberately selected for
the day. The corrected workspace keeps both as explicit views, allows normal
work without a contract, and asks for contract review only when observable
drift exists.

The accepted workspace also clarified the next boundary. A protected active
set of two or three directions is useful, while the remaining real obligations
need a visible overflow lane rather than silent disappearance or unlimited WIP.
Each selected direction needs a concrete intended result for the day, and long
work needs stages. Contract composition should expose Operational Reality
without forcing a second navigation loop.

### Timeskein is not a general todo manager

Promises and future obligations matter, but Timeskein earns its place by
connecting current attention to actual contact, state change, evidence, and
closure. It should not grow a second planning universe that competes with the
systems where commitments already live.

The day contract is deliberately small. It selects a current working set from
known Work Items and Tracks, records why the choice is legitimate, and keeps
the rest parked without pretending the backlog has disappeared.

### More capture is unsafe without clarification and pruning

The early product idea “chaos is incoming without a fate” matches the observed
inventory pressure. Captures, unknown states, duplicate Work Items, stale
tails, and items without a next action remain cognitively active even when
they are stored reliably.

Before Timeskein increases the input stream through automatic sources, it
needs a regular clarification loop: continue, connect, delegate, wait, defer,
preserve as reference, merge, archive, or delete. Retention alone is not
memory quality.

## Product principles derived from dogfood

1. Optimize transitions and re-entry before optimizing total tracked time.
2. Keep one authoritative operational workspace with distinct Reality and
   Contour views; move inventory maintenance and taxonomy administration out of
   the primary attention path.
3. Keep the current day contract visible and revisable throughout the day.
4. Capture quickly, classify later, and never interrupt focus merely to file a
   thought correctly.
5. Ask what changed after meaningful work; do not infer progress from duration.
6. Preserve user truth, provenance, uncertainty, and superseding corrections.
7. Separate executive work, coordination, recovery, idle time, and personal
   activity without turning zones into performance grades.
8. Keep manual mode complete and useful before adding automatic observation.
9. Use progressive disclosure: current action first, evidence and maintenance
   on demand.
10. Accept a feature only after it changes a real workday, not merely after its
    code and tests pass.
11. Clarify and prune before collecting more; every significant incoming
    fragment should receive an explicit fate or remain visibly unclassified.

## Development route after the trial

### M2: Operational Workspace convergence

The accepted baseline unifies Operational Reality, the day contract,
active focus, re-entry after a break, and the inventory boundary. The user sees
one current working set and one justified next action; dispatching selects
existing Work Items or Tracks instead of producing a hidden free-text plan.
The complete inventory remains available for search and maintenance. Four real
days accepted the combined surface with `4/3` contract/start/closure days,
`3/2` re-entry days, and `1/1` revised day.

### M3: Working Memory Bridge

The implementation provides a persistent chronological stream for thoughts
and materials, explicit Work Item stages, calm long-note review, duplicate
merge, and a cheap `action -> changed state -> next action` record. Acceptance
now depends on real 1/3/7-day returns without an external task-memory notebook.

### M4: Causal period review

Promote confirmed changes, decisions, unresolved commitments, and next actions
into ordinary weekly and Track reports. Then move the review loop into the app
without losing Markdown/JSON portability.

### M5: Inventory Stewardship and Inbound Clarification

Turn captures, unknown items, stale tails, duplicates, and items without a next
action into explicit outcomes. The review must support continuation, linking,
waiting, delegation, deferral, reference, merge, archive, and deletion without
creating a second universal task manager.

### M6: Bounded Context Capture Probe

Only after the manual operational, working-memory, period-review, and
clarification loops are coherent, test one focus-scoped automatic source with
a visible indicator, local storage, short raw TTL, pause, purge, provenance,
and a measured re-entry benefit. Do not build a general SourceNode platform
before this gate passes.

## Accepted Operational Workspace gate

Operational Workspace convergence was accepted after real days showed that:

- the day contract is assembled from actual Work Items or Tracks and remains
  visible after the first start;
- the same workspace supports morning entry and post-break re-entry;
- the user can explain why the current action is active and what is parked;
- changes to the contract preserve history instead of silently replacing it;
- the primary screen no longer requires reconciling three competing work
  representations;
- normal starting, switching, capture, correction, and day closure remain at
  least as reliable as the accepted baseline.

The executable threshold was three contract/start/closure days, post-break
re-entry on at least two days, and at least one honest saved contract revision.
`pnpm operational-workspace:gate -- --from YYYY-MM-DD --to YYYY-MM-DD` checks
the machine evidence. It passed on 2026-07-22 with `4/3`, `3/2`, and `1/1`;
the user confirmed that no parallel external active-list was needed. The full evidence is in
[Operational Workspace Dogfood](dogfood-operational-workspace.md).

## What the evidence does not prove

- Tracked hours are not a measure of personal effectiveness.
- An unexplained gap is not evidence of idleness or avoidance.
- A difficult start does not imply that the selected work lacks value.
- That automatic context will be useful; this remains an untested hypothesis.
- That a richer interface is automatically better. Every new surface must reduce
  reconstruction or decision cost enough to justify its cognitive load.
