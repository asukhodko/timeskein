# Roadmap

This directory contains development roadmap documents for the Timeskein project.

The current executable roadmap is [opskarta.md](opskarta.md), generated from
`plans/timeskein/*.plan.yaml` with the vendored opskarta v3 tools.

## Current Product Order

The near-term plan is intentionally ordered by what the user gets, not by which
technical subsystem looks tempting next.

1. **Finish the active goal:** prove that evening closure is calm and short:
   final report, clean review state, measured closure `<= 10` minutes, and
   strict `dogfood:goal-check -- --no-codex-guidance`.
2. **Build in-day structure:** keep thoughts, decisions, questions, next steps,
   Work Item stages, live Activity Zone totals, dispatch choices, and gap
   classifications inside Timeskein. Success means a real workday no longer
   needs a parallel "Timeskein, day N" note in Codex or Obsidian.
3. **Add periodic reflection:** generate weekly/sprint/monthly reports from the
   accumulated local data so the user can choose 1-3 protected focus points and
   collect performance-review evidence without manual archaeology.
4. **Only then broaden context capture:** Tracks/Labels, richer filters, LLM
   packs, active-window/browser evidence, screenshots, and Evidence Mode remain
   later opt-in layers. They should strengthen the manual loop, not replace it
   before it is reliable.

## Roadmap Documents

| Document | Level | Description |
|----------|-------|-------------|
| [../current-implementation.md](../current-implementation.md) | Current | What runs today |
| [opskarta.md](opskarta.md) | Current | opskarta v3 plan for the daily-control goal, in-day structure, and later period reports |
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
