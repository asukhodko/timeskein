# Dogfood findings: 2026-07-01 through 2026-07-16

## Status

This document summarizes twelve real workdays of using Timeskein as the primary
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

### Capture works, but working memory is still split

Capture Inbox proved that an incoming event can be preserved without switching
the active focus. Day Events and Work Item Events preserved useful thoughts in
reports. Even so, an external text notebook remained easier for reviewing a
long chronological stream, materials, intermediate reasoning, and product
observations side by side.

The remaining gap is not another note field. Timeskein needs a calm working
memory surface available with or without active focus, with explicit material,
thought, decision, result, and next-action semantics.

### Operational Reality is the strongest new direction

The accepted two-day Operational Reality gate showed that a derived but
correctable projection can narrow a large inventory into a useful attention
queue. Starting from a card, correcting state, preserving the reason, carrying
a Reflection follow-up, and exposing the next action all worked on real days.

The trial also exposed a structural problem: Operational Reality, the dispatch
ritual, the day contract, and the full Work Item list currently represent
overlapping answers to “what should I do now?”. The next product step is to
make them one coherent loop.

### Timeskein is not a general todo manager

Promises and future obligations matter, but Timeskein earns its place by
connecting current attention to actual contact, state change, evidence, and
closure. It should not grow a second planning universe that competes with the
systems where commitments already live.

The day contract is deliberately small. It selects a current working set from
known Work Items and Tracks, records why the choice is legitimate, and keeps
the rest parked without pretending the backlog has disappeared.

## Product principles derived from dogfood

1. Optimize transitions and re-entry before optimizing total tracked time.
2. Keep one authoritative operational workspace; move inventory maintenance
   and taxonomy administration out of the primary attention path.
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

## Development route after the trial

### M2: Operational Workspace convergence

The release candidate now unifies Operational Reality, the day contract,
active focus, re-entry after a break, and the inventory boundary. The user sees
one current working set and one justified next action; dispatching selects
existing Work Items or Tracks instead of producing a hidden free-text plan.
The complete inventory remains available for search and maintenance. This is
an implemented hypothesis, not yet an accepted result: three full real days
must show that the combined surface actually lowers transition cost.

### M3: Working Memory Bridge

Add a persistent chronological stream for thoughts and materials, explicit
Work Item stages, calm long-note review, semantic deduplication, and a cheap
`action -> changed state` record. The external notebook should no longer be
needed to reconstruct a long block or a return after several days.

### M4: Causal period review

Promote confirmed changes, decisions, unresolved commitments, and next actions
into ordinary weekly and Track reports. Then move the review loop into the app
without losing Markdown/JSON portability.

### M5: Bounded Context Capture Probe

Only after the manual operational and working-memory loops are coherent, test
one focus-scoped automatic source with a visible indicator, local storage,
short raw TTL, pause, purge, provenance, and a measured re-entry benefit. Do
not build a general SourceNode platform before this gate passes.

## Next acceptance gate

Operational Workspace convergence is accepted only after several real days
show that:

- the day contract is assembled from actual Work Items or Tracks and remains
  visible after the first start;
- the same workspace supports morning entry and post-break re-entry;
- the user can explain why the current action is active and what is parked;
- changes to the contract preserve history instead of silently replacing it;
- the primary screen no longer requires reconciling three competing work
  representations;
- normal starting, switching, capture, correction, and day closure remain at
  least as reliable as the accepted baseline.

The executable threshold is three contract/start/closure days, post-break
re-entry on at least two days, and at least one honest saved contract revision.
`pnpm operational-workspace:gate -- --from YYYY-MM-DD --to YYYY-MM-DD` checks
the machine evidence; the user still confirms that no parallel external
active-list was needed. The full protocol is in
[Operational Workspace Dogfood](dogfood-operational-workspace.md).

## What the evidence does not prove

- Tracked hours are not a measure of personal effectiveness.
- An unexplained gap is not evidence of idleness or avoidance.
- A difficult start does not imply that the selected work lacks value.
- That automatic context will be useful; this remains an untested hypothesis.
- That a richer interface is automatically better. Every new surface must reduce
  reconstruction or decision cost enough to justify its cognitive load.
