# Timeskein opskarta roadmap

This is the current machine-checkable roadmap for Timeskein. The source files live in
`plans/timeskein/*.plan.yaml` and use the vendored opskarta v3 tools in
`tools/opskarta`.

## Strategic position

The accepted manual foundation includes the macOS Session replacement, cheap
day closure, in-day structure, period reports, Reflection Sessions,
Tracks/Labels, historical snapshots, typed evidence, decision follow-up, the
Causal Work Spine, and Operational Reality. Twelve real workdays through
2026-07-16 remain the evidence base and regression boundary.

The roadmap now backcasts from one north star:

```text
intention -> work episode -> context -> change
          -> evidence -> decision -> next action
```

ADR-0004, RFC-0009, Roadmap 0005, and the cross-day dogfood findings define the
route. `Causal Work Spine + Operational Reality v1` was accepted on the real
2026-07-15 and 2026-07-16 workdays. The executable gate confirmed two
closures, eleven starts from Operational Reality, correction and restart,
Reflection follow-up, and a complete causal chain. The same review found one
historical overlap between focus blocks; new overlaps are now rejected and old
ones are explicit report-integrity blockers.

Dogfood closed the former choice between integration, working-memory polish,
and early automatic context. The committed order is now:

1. accept the implemented convergence of Operational Reality, an item-backed
   day contract, active focus, and secondary inventory on three real days;
2. replace the external working notebook with a chronological memory bridge;
3. carry causal changes and commitments into period reviews;
4. test one bounded automatic context source before building Context Fabric.

The Operational Workspace release candidate was implemented and automatically
verified on 2026-07-17. The `current` view now contains the accepted causal
baseline plus its three-day product gate. The `next` view contains manual
working-memory and causal-review work. Automatic collection and later
capabilities remain coarse and unscheduled until the manual gates pass.

## Executive view

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render executive ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view exec-top
-->
```mermaid
flowchart LR

    classDef exec_done fill:#22c55e,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_in_progress fill:#0ea5e9,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_blocked fill:#fecaca,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_not_started fill:#9ca3af,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_mgmt_green fill:#86efac,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_mgmt_yellow fill:#fde68a,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_mgmt_red fill:#fca5a5,stroke:#4b5563,color:#111827,stroke-width:1px
    classDef exec_mgmt_neutral fill:#d1d5db,stroke:#4b5563,color:#111827,stroke-width:1px

    accepted_foundation["Accepted manual<br/>foundation<br/>100%<br/>веха 2026-07-10"]
    class accepted_foundation exec_done
    architecture_gate["North-star<br/>architecture gate<br/>100%<br/>веха 2026-07-10"]
    class architecture_gate exec_done
    causal_memory["Causal<br/>Work Memory<br/>~30%"]
    class causal_memory exec_mgmt_green
    current_steering["Accepted<br/>Operational Reality<br/>100%<br/>веха 2026-07-15"]
    class current_steering exec_done
    operational_workspace["Operational<br/>Workspace convergence<br/>90%<br/>веха 2026-07-22"]
    class operational_workspace exec_mgmt_yellow
    style operational_workspace stroke:#111827,stroke-width:3px
    working_memory["Working<br/>Memory Bridge<br/>~0%"]
    class working_memory exec_mgmt_neutral
    trust_controls["Trust and<br/>privacy controls<br/>n/a"]
    class trust_controls exec_mgmt_neutral
    bounded_context_probe["Bounded<br/>context probe<br/>~0%"]
    class bounded_context_probe exec_mgmt_neutral
    context_fabric["Context<br/>Fabric<br/>~0%"]
    class context_fabric exec_mgmt_neutral
    private_intelligence["Explainable private<br/>intelligence<br/>n/a"]
    class private_intelligence exec_mgmt_neutral
    continuity["Multi-device<br/>continuity<br/>~0%"]
    class continuity exec_mgmt_neutral
    full_context["Opt-in Full<br/>Context<br/>n/a"]
    class full_context exec_mgmt_neutral

    accepted_foundation --> architecture_gate
    architecture_gate --> causal_memory
    causal_memory --> current_steering
    current_steering --> operational_workspace
    operational_workspace --> working_memory
    architecture_gate --> trust_controls
    working_memory --> bounded_context_probe
    trust_controls --> bounded_context_probe
    bounded_context_probe --> context_fabric
    context_fabric --> private_intelligence
    causal_memory -. sync-ready first .-> continuity
    context_fabric --> full_context
    private_intelligence -. derived meaning .-> full_context
    continuity -. multi-device sources .-> full_context
```

Twelve real workdays selected a concrete route: converge the operational workspace, close the manual working-memory gap, strengthen causal period review, and only then test bounded automatic context before broader Context Fabric, private intelligence, continuity, and opt-in Full Context.

## North-star capability tree

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render tree ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view north-star
-->
<!-- GENERATED:START -->
└── Timeskein [in_progress] (284 focus-blocks) {86% cov:55%}
    ├── Causal Work Memory [in_progress] (29 focus-blocks) {38% cov:90%}
    │   ├── Build a chronological working-memory bridge [planned] (16 focus-blocks) {0% cov:31%}
    │   │   ├── Keep one chronological thought and material stream [planned] (4 focus-blocks)
    │   │   ├── Make small action outcomes visible [planned] (3 focus-blocks)
    │   │   ├── Review larger day and work notes calmly [planned] (3 focus-blocks)
    │   │   ├── Track stages inside a Work Item [planned] (5 focus-blocks) {0%}
    │   │   └── Working memory supports multi-day re-entry [planned] (1 focus-blocks)
    │   ├── Carry causal outcomes into period reports [planned] (3 focus-blocks)
    │   └── Preserve manual state and next-action transitions [done] (3 focus-blocks) {100%}
    ├── Context Fabric [planned] (31 focus-blocks)
    │   ├── Activity Evidence Layer experiments [planned] (8 focus-blocks)
    │   ├── Automatic context proves value and trust [planned] (1 focus-blocks)
    │   ├── Context Fabric supports one explicit external source [deferred] (1 focus-blocks)
    │   ├── Explicit context capture and SourceNodes [planned] (13 focus-blocks)
    │   ├── Implement one source observation envelope [planned] (3 focus-blocks)
    │   └── Run a bounded active-app and browser-context probe [planned] (5 focus-blocks)
    ├── Current-State Steering [in_progress] (22 focus-blocks) {89%}
    │   ├── Confirm and correct operational state [done] (3 focus-blocks) {100%}
    │   └── Converge Operational Reality, day contract, and inventory [in_progress] (13 focus-blocks) {81%}
    │       ├── Build a visible item-backed day contract [done] (3 focus-blocks) {100%}
    │       ├── Make one primary operational surface [done] (4 focus-blocks) {100%}
    │       ├── Make workspace actions and review checks self-explanatory [done] (2 focus-blocks) {100%}
    │       ├── One operational workspace drives the real day [planned] (1 focus-blocks) {0%}
    │       └── Use the same loop for morning entry and re-entry [in_progress] (3 focus-blocks) {50%}
    ├── Explainable Episodes and Private Intelligence [deferred] (27 focus-blocks)
    │   ├── Connect Episodes into semantic Threads [deferred] (8 focus-blocks)
    │   ├── Derive explainable work Episodes [deferred] (8 focus-blocks)
    │   ├── Export LLM packs with redaction controls [deferred] (5 focus-blocks)
    │   ├── Private intelligence improves a real reflection decision [deferred] (1 focus-blocks)
    │   └── Run period reviews inside the app [planned] (5 focus-blocks)
    ├── Multi-device Continuity [deferred] (33 focus-blocks)
    │   ├── Android client path [deferred] (8 focus-blocks)
    │   ├── Canonical history survives multi-device use [deferred] (1 focus-blocks)
    │   ├── Keep new canonical facts sync-ready [planned] (3 focus-blocks)
    │   ├── Sync and multi-device continuity [deferred] (13 focus-blocks)
    │   └── Windows packaging and tray behavior [deferred] (8 focus-blocks)
    ├── Opt-in Full Context and Evidence Mode [deferred] (21 focus-blocks)
    │   ├── Evidence Mode [deferred] (20 focus-blocks)
    │   └── Full Context reconstructs work without becoming surveillance [deferred] (1 focus-blocks)
    └── Trust, Privacy, and Retention [planned] (2 focus-blocks)
        └── Define minimum policy controls for a context probe [planned] (2 focus-blocks)
<!-- GENERATED:END -->

## Strategic dogfood gates

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render list ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view risk-gates
-->
<!-- GENERATED:START -->
- Automatic context proves value and trust [planned] (1 focus-blocks)
- Canonical history survives multi-device use [deferred] (1 focus-blocks)
- Context Fabric supports one explicit external source [deferred] (1 focus-blocks)
- Define minimum policy controls for a context probe [planned] (2 focus-blocks)
- Full Context reconstructs work without becoming surveillance [deferred] (1 focus-blocks)
- One operational workspace drives the real day [planned] (1 focus-blocks) {0%}
- Private intelligence improves a real reflection decision [deferred] (1 focus-blocks)
- Working memory supports multi-day re-entry [planned] (1 focus-blocks)
<!-- GENERATED:END -->

## Accepted history and committed schedule

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render gantt ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view current-gantt --style status
-->
```mermaid
%%{init: {"theme": "base", "themeVariables": {"taskBkgColor": "#9ca3af", "taskBorderColor": "#4b5563", "taskTextColor": "#000000", "taskTextDarkColor": "#000000", "taskTextLightColor": "#000000", "activeTaskBkgColor": "#0ea5e9", "activeTaskBorderColor": "#0ea5e9", "doneTaskBkgColor": "#22c55e", "doneTaskBorderColor": "#16a34a", "critBkgColor": "#fecaca", "critBorderColor": "#fecaca", "todayLineColor": "#ef4444"}} }%%

gantt
    title Timeskein accepted history and committed work
    dateFormat YYYY-MM-DD
    axisFormat %d.%m
    excludes weekends

    section Accepted manual gates
    ✅ Current implementation documentation  :done, ts_baseline_docs,    2026-06-30, 1d
    ✅ First real Focus Session dogfood  :milestone, done, ts_focus_core_dogfood_gate,    2026-07-01, 0d
    ✅ End-of-day analysis can use Timeskein data  :milestone, done, ts_day_review_analysis_gate,    2026-07-01, 0d
    ✅ Session replacement dogfood baseline  :milestone, done, ts_hardening_dogfood_release,    2026-07-06, 0d
    ✅ Close daily-control goal with strict evidence  :milestone, done, ts_daily_control_goal_check,    2026-07-08, 0d
    section Accepted meaning gates
    ✅ In-day structure dogfood gate  :milestone, done, ts_in_day_structure_dogfood_gate,    2026-07-09, 0d
    ✅ Save period conclusions as Reflection Sessions  :done, ts_periodic_reflection_reflection_sessions,    2026-07-09, 1d
    ✅ Prove semantic history on fresh dogfood data  :milestone, done, ts_periodic_reflection_semantic_dogfood_gate,    2026-07-10, 0d
    ✅ Build an evidence-backed Track story  :done, ts_periodic_reflection_context_links,    2026-07-10, 1d
    section North-star architecture
    ✅ Fix the causal model and truth boundaries  :milestone, done, ts_causal_memory_architecture_gate,    2026-07-10, 0d
    ✅ Add shared provenance and observation contracts  :done, ts_causal_memory_provenance_contract,    2026-07-10, 1d
    ✅ Preserve manual state and next-action transitions  :done, ts_causal_memory_transition_history,    2026-07-10, 1d
    ✅ Build operational reality panel  :done, ts_periodic_reflection_operational_reality,    2026-07-10, 1d
    ✅ Confirm and correct operational state  :done, ts_steering_manual_correction,    2026-07-10, 1d
    ✅ Operational Reality selects the next justified action  :milestone, done, ts_steering_operational_reality_gate,    2026-07-15, 0d
    section Next operational workspace
    ✅ Build a visible item-backed day contract  :done, ts_steering_workspace_day_contract,    2026-07-17, 1d
    ✅ Make one primary operational surface  :done, ts_steering_workspace_primary_surface,    2026-07-17, 1d
    🔄 Use the same loop for morning entry and re-entry  :active, ts_steering_workspace_reentry,    2026-07-20, 3d
    ✅ Make workspace actions and review checks self-explanatory  :done, ts_steering_workspace_explainability,    2026-07-17, 1d
    One operational workspace drives the real day  :milestone, ts_steering_workspace_gate,    2026-07-22, 0d
```

## Current work list

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render list ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view current
-->
<!-- GENERATED:START -->
- Causal Work Memory [in_progress] (29 focus-blocks) {38% cov:90%}
- Current-State Steering [in_progress] (22 focus-blocks) {89%}
- Converge Operational Reality, day contract, and inventory [in_progress] (13 focus-blocks) {81%}
- Use the same loop for morning entry and re-entry [in_progress] (3 focus-blocks) {50%}
- One operational workspace drives the real day [planned] (1 focus-blocks) {0%}
<!-- GENERATED:END -->

## Next risk-reduction work

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render list ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view next
-->
<!-- GENERATED:START -->
- Build a chronological working-memory bridge [planned] (16 focus-blocks) {0% cov:31%}
- Keep one chronological thought and material stream [planned] (4 focus-blocks)
- Working memory supports multi-day re-entry [planned] (1 focus-blocks)
- Track stages inside a Work Item [planned] (5 focus-blocks) {0%}
- Review larger day and work notes calmly [planned] (3 focus-blocks)
- Make small action outcomes visible [planned] (3 focus-blocks)
- Carry causal outcomes into period reports [planned] (3 focus-blocks)
<!-- GENERATED:END -->

## Deferred directions

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render list ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view backlog
-->
<!-- GENERATED:START -->
- Activity Evidence Layer experiments [planned] (8 focus-blocks)
- Android client path [deferred] (8 focus-blocks)
- Automatic context proves value and trust [planned] (1 focus-blocks)
- Canonical history survives multi-device use [deferred] (1 focus-blocks)
- Complete broader Manual Inventory UX [deferred] (8 focus-blocks)
- Connect Episodes into semantic Threads [deferred] (8 focus-blocks)
- Context Fabric [planned] (31 focus-blocks)
- Context Fabric supports one explicit external source [deferred] (1 focus-blocks)
- Define minimum policy controls for a context probe [planned] (2 focus-blocks)
- Derive explainable work Episodes [deferred] (8 focus-blocks)
- Evidence Mode [deferred] (20 focus-blocks)
- Explainable Episodes and Private Intelligence [deferred] (27 focus-blocks)
- Explicit context capture and SourceNodes [planned] (13 focus-blocks)
- Export LLM packs with redaction controls [deferred] (5 focus-blocks)
- Full Context reconstructs work without becoming surveillance [deferred] (1 focus-blocks)
- Implement one source observation envelope [planned] (3 focus-blocks)
- Improve readability and panel ergonomics [planned] (3 focus-blocks)
- Keep new canonical facts sync-ready [planned] (3 focus-blocks)
- Maintenance and deferred polish [deferred] (13 focus-blocks)
- Multi-device Continuity [deferred] (33 focus-blocks)
- Normalize search for Cyrillic and Latin lookalikes [planned] (2 focus-blocks)
- Opt-in Full Context and Evidence Mode [deferred] (21 focus-blocks)
- Pause, resume, and cancel focus sessions [deferred] (5 focus-blocks)
- Private intelligence improves a real reflection decision [deferred] (1 focus-blocks)
- Run a bounded active-app and browser-context probe [planned] (5 focus-blocks)
- Run period reviews inside the app [planned] (5 focus-blocks)
- Sync and multi-device continuity [deferred] (13 focus-blocks)
- Trust, Privacy, and Retention [planned] (2 focus-blocks)
- Windows packaging and tray behavior [deferred] (8 focus-blocks)
<!-- GENERATED:END -->
