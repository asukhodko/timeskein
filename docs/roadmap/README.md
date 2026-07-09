# Roadmap

This directory contains development roadmap documents for the Timeskein project.

The current executable roadmap is [opskarta.md](opskarta.md), generated from
`plans/timeskein/*.plan.yaml` with the vendored opskarta v3 tools.

## Current Product Order

The near-term plan is intentionally ordered by what the user gets, not by which
technical subsystem looks tempting next.

1. **Keep the accepted daily-control gate green:** the 2026-07-08 day proved
   calm evening closure with final report, clean review state, measured closure
   `2:32`, and strict `dogfood:goal-check -- --date 2026-07-08
   --no-codex-guidance`. Future work must not regress this.
2. **Keep the accepted in-day structure layer useful:** free day thoughts,
   active-work observations, live zones, dispatch choices, and gap
   classifications must keep working without a parallel "Timeskein, day N"
   note. Work Item stages remain a later refinement.
3. **Continue the active periodic-reflection layer:** P0 range export is
   accepted. Add scale-specific week/sprint/performance profiles and preserve
   the user's chosen focus decisions.
4. **Only then broaden semantic context:** use the real report findings to add
   the smallest useful Track/Label and current-state model. Richer filters, LLM
   packs, active-window/browser evidence, screenshots, and Evidence Mode remain
   later opt-in layers. They should strengthen the manual loop, not replace it
   before it is reliable.

## Roadmap Documents

| Document | Level | Description |
|----------|-------|-------------|
| [../current-implementation.md](../current-implementation.md) | Current | What runs today |
| [opskarta.md](opskarta.md) | Current | opskarta v3 plan for accepted daily/in-day layers and active periodic reflection |
| [0001-mvp-execution-roadmap.md](0001-mvp-execution-roadmap.md) | Level 0 | Historical MVP execution plan, phases, and milestones |
| [0002-level3-evidence-mode-roadmap.md](0002-level3-evidence-mode-roadmap.md) | Level 3 | Evidence-Mode (opt-in screen evidence) roadmap |
| [0003-periodic-reflection-roadmap.md](0003-periodic-reflection-roadmap.md) | Level 0+ / Level 2+ | Periodic reports, meaning slices, reflection sessions, and performance-review evidence |
| [0004-in-day-structure-roadmap.md](0004-in-day-structure-roadmap.md) | Level 0+ | In-day thoughts, dogfood-day observations, stages, live zone balance, dispatching, and gap classification |

## Related Documents

- [ADR-0002: MVP = Manual-first](../adr/0002-mvp-manual-first.md)
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md)
- [RFC-0001: MVP Inventory Design](../rfc/0001-mvp-inventory-design.md)
- [RFC-0007: Screen Evidence Source Node](../rfc/0007-evidence-mode-screen-evidence-source-node.md)
- [RFC-0008: Periodic Reports and Reflection Loops](../rfc/0008-periodic-reports-and-reflection.md)
- [User Story: Manual Inventory](../mvp/02_user_story_manual_inventory.md)
- [User Story: Evidence-Mode](../mvp/03_user_story_evidence_mode.md)

## Maturity Levels

- **Level 0**: Manual-first (MVP) — no background observation
- **Level 2**: Context Capture — on-demand context capture via SourceNodes
- **Level 3**: Evidence-Mode — opt-in screen evidence capture

---

[Back to Documentation Index](../index.md)
