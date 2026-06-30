# Timeskein opskarta roadmap

This is the current machine-checkable roadmap for Timeskein. The source files live in
`plans/timeskein/*.plan.yaml` and use the vendored opskarta v3 tools in
`tools/opskarta`.

The near-term focus is deliberately narrow: replace the useful part of Session with
a local Focus Session flow before widening scope to sync, Evidence Mode, or new
platforms.

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

    recovered_baseline["Recovered<br/>baseline<br/>100%<br/>веха 2026-06-30"]
    class recovered_baseline exec_done
    app_entry_ux["App<br/>entry UX<br/>~0%<br/>веха 2026-07-06"]
    class app_entry_ux exec_mgmt_yellow
    style app_entry_ux stroke:#111827,stroke-width:3px
    focus_session_core["Focus<br/>Session core<br/>~0%<br/>веха 2026-07-17"]
    class focus_session_core exec_mgmt_yellow
    day_review_export["Day review<br/>and export<br/>~0%<br/>веха 2026-07-23"]
    class day_review_export exec_mgmt_neutral
    dogfood_hardening["Dogfood<br/>hardening<br/>~0%<br/>веха 2026-07-28"]
    class dogfood_hardening exec_mgmt_neutral
    future_directions["Future<br/>directions<br/>n/a"]
    class future_directions exec_mgmt_neutral

    recovered_baseline --> app_entry_ux
    app_entry_ux --> focus_session_core
    focus_session_core --> day_review_export
    day_review_export --> dogfood_hardening
    focus_session_core -. later .-> future_directions
```

Near-term plan is intentionally narrow: make Timeskein replace Session before reopening sync, Evidence Mode, or platform expansion.

## Current schedule

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render gantt ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view current-gantt --style status
-->
```mermaid
%%{init: {"theme": "base", "themeVariables": {"taskBkgColor": "#9ca3af", "taskBorderColor": "#4b5563", "taskTextColor": "#000000", "taskTextDarkColor": "#000000", "taskTextLightColor": "#000000", "activeTaskBkgColor": "#0ea5e9", "activeTaskBorderColor": "#0ea5e9", "doneTaskBkgColor": "#22c55e", "doneTaskBorderColor": "#16a34a", "critBkgColor": "#fecaca", "critBorderColor": "#fecaca", "todayLineColor": "#ef4444"}} }%%

gantt
    title Timeskein Focus Session dogfood slice
    dateFormat YYYY-MM-DD
    axisFormat %d.%m
    excludes weekends

    section App entry UX
    Make the app window movable  :ts_ux_entry_window_drag,    2026-07-01, 1d
    Add clear hide and show behavior  :ts_ux_entry_hide_toggle,    2026-07-02, 1d
    Wire tray menu actions  :ts_ux_entry_tray_actions,    2026-07-03, 1d
    Document macOS multi-monitor status item limits  :ts_ux_entry_monitor_policy,    2026-07-06, 1d
    Reduce the path from intent to tracked work  :ts_ux_entry_fast_track_flow,    2026-07-06, 1d
    section Focus Session core
    Add FocusSession and SessionEvent persistence  :ts_focus_core_model_migrations,    2026-07-07, 2d
    Add contracts and Local API for focus sessions  :ts_focus_core_contracts_api,    2026-07-09, 2d
    Build focus timer UI with overflow  :ts_focus_core_timer_ui,    2026-07-13, 2d
    Implement start, pause, resume, stop, cancel  :ts_focus_core_session_lifecycle,    2026-07-15, 2d
    Restore running focus session after app restart  :ts_focus_core_restart_restore,    2026-07-17, 1d
    Bind focus sessions to Work Items or free intentions  :ts_focus_core_work_item_binding,    2026-07-13, 1d
    Capture a note at the end of a focus session  :ts_focus_core_session_notes,    2026-07-17, 1d
    First real Focus Session dogfood  :milestone, ts_focus_core_dogfood_gate,    2026-07-17, 0d
    section Day review
    Show focus blocks on a daily timeline  :ts_day_review_timeline,    2026-07-20, 2d
    Compute totals, gaps, and entry count  :ts_day_review_totals_gaps,    2026-07-22, 1d
    Export day data as JSON, CSV, and Markdown  :ts_day_review_export,    2026-07-23, 1d
    End-of-day analysis can use Timeskein data  :milestone, ts_day_review_analysis_gate,    2026-07-23, 0d
    section Dogfood hardening
    Add smoke checks for focus-session flows  :ts_hardening_smoke,    2026-07-24, 1d
    Add local data backup and reset path  :ts_hardening_backup_reset,    2026-07-24, 1d
    Rebuild macOS app for regular personal use  :ts_hardening_package_app,    2026-07-27, 1d
    Write dogfood release notes and known limitations  :ts_hardening_release_notes,    2026-07-28, 1d
    Session replacement dogfood baseline  :milestone, ts_hardening_dogfood_release,    2026-07-28, 0d
```

## Current work list

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render list ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view current
-->
<!-- GENERATED:START -->
- App entry UX [planned] (6 focus-blocks)
- Make the app window movable [planned] (1 focus-blocks)
- Add clear hide and show behavior [planned] (1 focus-blocks)
- Wire tray menu actions [planned] (1 focus-blocks)
- Document macOS multi-monitor status item limits [planned] (1 focus-blocks)
- Reduce the path from intent to tracked work [planned] (2 focus-blocks)
- Focus Session core [planned] (17 focus-blocks)
- Add FocusSession and SessionEvent persistence [planned] (3 focus-blocks)
- Add contracts and Local API for focus sessions [planned] (3 focus-blocks)
- Build focus timer UI with overflow [planned] (3 focus-blocks)
- Implement start, pause, resume, stop, cancel [planned] (3 focus-blocks)
- Restore running focus session after app restart [planned] (2 focus-blocks)
- Bind focus sessions to Work Items or free intentions [planned] (2 focus-blocks)
- Capture a note at the end of a focus session [planned] (1 focus-blocks)
- First real Focus Session dogfood [planned]
- Day review and export [planned] (7 focus-blocks)
- Show focus blocks on a daily timeline [planned] (3 focus-blocks)
- Compute totals, gaps, and entry count [planned] (2 focus-blocks)
- Export day data as JSON, CSV, and Markdown [planned] (2 focus-blocks)
- End-of-day analysis can use Timeskein data [planned]
- Dogfood hardening [planned] (6 focus-blocks)
- Add smoke checks for focus-session flows [planned] (2 focus-blocks)
- Add local data backup and reset path [planned] (2 focus-blocks)
- Rebuild macOS app for regular personal use [planned] (1 focus-blocks)
- Write dogfood release notes and known limitations [planned] (1 focus-blocks)
- Session replacement dogfood baseline [planned]
<!-- GENERATED:END -->

## Deferred directions

<!--
Перегенерить:
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli validate ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.cli render list ../../plans/timeskein/main.plan.yaml ../../plans/timeskein/nodes.plan.yaml ../../plans/timeskein/schedule.plan.yaml ../../plans/timeskein/execution.plan.yaml ../../plans/timeskein/views.plan.yaml --view backlog
-->
<!-- GENERATED:START -->
- Active-window and automation experiments [deferred] (8 focus-blocks)
- Android client path [deferred] (8 focus-blocks)
- Complete broader Manual Inventory UX [deferred] (8 focus-blocks)
- Evidence Mode [deferred] (20 focus-blocks)
- Explicit context capture and SourceNodes [deferred] (13 focus-blocks)
- Future directions [deferred] (78 focus-blocks)
- Sync and multi-device continuity [deferred] (13 focus-blocks)
- Windows packaging and tray behavior [deferred] (8 focus-blocks)
<!-- GENERATED:END -->
