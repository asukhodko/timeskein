# Timeskein Documentation

## Overview

**Timeskein** is a personal context journal system that helps structure work activity into **episodes and threads of meaning**. The name is a metaphor for a skein of yarn: work activity is tangled across time and meaning, and Timeskein helps **untangle** it.

The system answers questions like:
- "What was I doing at time X?"
- "When and how did I solve problem Z?"
- "What's on my plate today?"
- "How much active focus time did I actually have today?"
- "What tried to interrupt me, and did I handle it later?"
- "Where did the tracking tool itself create friction today?"
- "What changed after my action, why do I trust that, and what should happen next?"

### Core Principles

1. **Local-first** - Processing and storage on device by default
2. **Privacy by default** - Minimal data collection, no "life recorder"
3. **Manual-first as baseline** - Manual mode always works; automation is opt-in
4. **Provenance** - Every observation knows its source, time, and applied rules

### Anti-Goals

- Building a video/audio recorder by default
- Mandatory server or cloud dependency
- Deep task tracker integration that creates lock-in

---

## How to Read This Documentation

**Recommended reading order:**

1. **[Project Overview](00_project_overview.md)** - Core concepts, maturity levels, architecture
2. **[Current Implementation](current-implementation.md)** - What runs today
3. **[Dogfood Day Protocol](dogfood-day.md)** - How to run one real Session replacement day
4. **[Dogfood Release Candidate](dogfood-release-candidate.md)** - Gate for deciding whether Timeskein can replace Session in daily use
5. **[Dogfood Release Baseline](dogfood-release-baseline.md)** - Accepted 2026-07-03 dogfood baseline and known limitations
6. **[Periodic Report Dogfood](dogfood-periodic-report.md)** - First real multi-day report and evidence for the P0 periodic-reflection slice
7. **[Operational Reality Dogfood](dogfood-operational-reality.md)** - Accepted two-day evidence, protocol, and executable gate
8. **[Causal Work Spine Acceptance Audit](acceptance-causal-work-spine-v1.md)** - Requirement-by-requirement implementation and real-use evidence
9. **[Glossary](glossary.md)** - Definitions of all terms used
10. **[Architecture Decision Records](adr/README.md)** - Key architectural choices
11. **[Technical Specifications (RFC)](rfc/README.md)** - Detailed technical designs
12. **[MVP User Stories](mvp/README.md)** - Features and acceptance criteria
13. **[Causal Work Memory Roadmap](roadmap/0005-causal-work-memory-roadmap.md)** - Current north-star route, horizons, assumptions, and risk gates
14. **[opskarta Roadmap](roadmap/opskarta.md)** - Current machine-checkable capability map
15. **[In-Day Structure Roadmap](roadmap/0004-in-day-structure-roadmap.md)** - Accepted in-day thoughts, zone visibility, dispatching, and gap classification layer
16. **[Periodic Reflection Roadmap](roadmap/0003-periodic-reflection-roadmap.md)** - Accepted period reports, semantic history, evidence, and reflection loop
17. **[Roadmap Index](roadmap/README.md)** - Roadmap status and related links

---

## Canonical Documents

All documentation below is the **source of truth** for the project.

### Foundation

| Document | Description |
|----------|-------------|
| [00_project_overview.md](00_project_overview.md) | Main project document: concepts, principles, model |
| [current-implementation.md](current-implementation.md) | Current repository/runtime state |
| [dogfood-day.md](dogfood-day.md) | Protocol for replacing Session during one real workday, including Capture Inbox, Day Events, and local app telemetry checks |
| [dogfood-release-candidate.md](dogfood-release-candidate.md) | Release-candidate gate for daily Session replacement |
| [dogfood-release-baseline.md](dogfood-release-baseline.md) | Accepted 2026-07-03 baseline for daily macOS use and known limitations |
| [dogfood-periodic-report.md](dogfood-periodic-report.md) | First real 2026-07-01..2026-07-10 period review, decision value, and known P0 limitations |
| [dogfood-operational-reality.md](dogfood-operational-reality.md) | Accepted two-day Operational Reality evidence, protocol, and executable gate |
| [acceptance-causal-work-spine-v1.md](acceptance-causal-work-spine-v1.md) | Requirement-by-requirement implementation and real-use audit |
| [glossary.md](glossary.md) | Definitions of all terms and entities |

### Architecture Decision Records (ADR)

| Document | Status | Summary |
|----------|--------|---------|
| [ADR-0001](adr/0001-initial-architecture.md) | Accepted | Initial architecture for MVP |
| [ADR-0002](adr/0002-mvp-manual-first.md) | Accepted | MVP = Manual-first (Level 0) |
| [ADR-0003](adr/0003-evidence-mode-opt-in.md) | Proposed | Evidence-Mode as opt-in Level 3 |
| [ADR-0004](adr/0004-user-truth-and-derived-inference.md) | Accepted | User-confirmed state is authoritative; observations and machine interpretations keep provenance and remain correctable |

### Technical Specifications (RFC)

| Document | Maturity | Summary |
|----------|----------|---------|
| [RFC-0001](rfc/0001-mvp-inventory-design.md) | Level 0 | MVP inventory design |
| [RFC-0002](rfc/0002-system-topology-and-component-map.md) | Level 0+ | System topology and component map |
| [RFC-0003](rfc/0003-client-app-suite-architecture.md) | Level 0+ | Client application suite architecture |
| [RFC-0004](rfc/0004-local-api.md) | Level 0+ | Local API (Surface - Agent) |
| [RFC-0005](rfc/0005-event-ingest-source-nodes.md) | Level 2+ | Event Ingest + SourceNode + Pairing |
| [RFC-0006](rfc/0006-retention-ttl-distillation.md) | Level 2+ | Retention, TTL, Distillation |
| [RFC-0007](rfc/0007-evidence-mode-screen-evidence-source-node.md) | Level 3 | Screen Evidence Source Node (Evidence-Mode) |
| [RFC-0008](rfc/0008-periodic-reports-and-reflection.md) | Level 0+ / Level 2+ | Periodic reports, arbitrary-range exports, Track/Label slices, LLM packs, and reflection loops |
| [RFC-0009](rfc/0009-causal-work-memory-and-operational-reality.md) | Accepted v1 / Level 0+ to Level 3 | Accepted causal spine and Operational Reality v1, plus provenance, incremental migration, and the future bounded context probe |

### User Stories

| Document | Level | Description |
|----------|-------|-------------|
| [01_user_story_context_capture.md](mvp/01_user_story_context_capture.md) | Level 2+ | Context capture (future) |
| [02_user_story_manual_inventory.md](mvp/02_user_story_manual_inventory.md) | Level 0 | Manual inventory (MVP) |
| [02_manual_inventory_ui_ux.md](mvp/02_manual_inventory_ui_ux.md) | Level 0 | UI/UX for manual inventory |
| [03_user_story_evidence_mode.md](mvp/03_user_story_evidence_mode.md) | Level 3 | Evidence-Mode (post-MVP, opt-in) |
| [03_evidence_mode_ui_ux.md](mvp/03_evidence_mode_ui_ux.md) | Level 3 | UI/UX for Evidence-Mode |

### Roadmap

| Document | Description |
|----------|-------------|
| [opskarta.md](roadmap/opskarta.md) | Current opskarta v3 roadmap and generated views |
| [0001-mvp-execution-roadmap.md](roadmap/0001-mvp-execution-roadmap.md) | MVP execution plan and phases |
| [0002-level3-evidence-mode-roadmap.md](roadmap/0002-level3-evidence-mode-roadmap.md) | Level 3 Evidence-Mode roadmap (post-MVP) |
| [0003-periodic-reflection-roadmap.md](roadmap/0003-periodic-reflection-roadmap.md) | Periodic reports, Track/Label slices, Reflection Sessions, and performance-review evidence |
| [0004-in-day-structure-roadmap.md](roadmap/0004-in-day-structure-roadmap.md) | Active in-day thoughts, day observations, live zone balance, dispatching, and gap classification |
| [0005-causal-work-memory-roadmap.md](roadmap/0005-causal-work-memory-roadmap.md) | Current north-star route from accepted manual foundation to causal steering, context fabric, private intelligence, continuity, and opt-in Full Context |

---

## Generated Documentation

The `.qoder/repowiki/` directory contains **Qoder-generated documentation** in English. This is a processed/aggregated view of the canonical documentation above.

- **Source of truth:** `docs/**` (this directory)
- **Do not edit:** `.qoder/repowiki/**` directly
- See [.qoder/README.md](../.qoder/README.md) for details

---

## Maturity Levels

Documentation and features are tagged by maturity level:

| Level | Name | Description |
|-------|------|-------------|
| **Level 0** | Manual-first | Manual inventory, refs, notes (MVP) |
| **Level 1** | Sync | Multi-device synchronization |
| **Level 2** | Semantics-first | Explicit context capture, connectors |
| **Level 3** | Full context | Always-on collectors (opt-in) |
