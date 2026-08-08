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
- "Which incoming fragments still have no explicit fate?"

### Core Principles

1. **Local-first** - Processing and storage on device by default
2. **Privacy by default** - Minimal data collection, no "life recorder"
3. **Manual-first as baseline** - Manual mode always works; automation is opt-in
4. **Provenance** - Every observation knows its source, time, and applied rules
5. **Clarify before collecting more** - Incoming fragments need an explicit fate; retention without review and deletion creates a new source of chaos

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
8. **[Operational Workspace Dogfood](dogfood-operational-workspace.md)** - Accepted four-day evidence, executable gate, and remaining product findings
9. **[Working Memory Bridge Dogfood](dogfood-working-memory.md)** - Real 1/3/7-day re-entry protocol and strict acceptance gate
10. **[Working Memory Bridge Acceptance Audit](acceptance-working-memory-bridge-v1.md)** - Automated evidence, live D0–D11 state, and completion boundary
11. **[Causal Work Spine Acceptance Audit](acceptance-causal-work-spine-v1.md)** - Requirement-by-requirement implementation and real-use evidence
12. **[Dogfood Findings](dogfood-learnings.md)** - Product conclusions and development order derived from nineteen real workdays
13. **[Product Memory and Future Capabilities](product-memory-and-future-capabilities.md)** - Valuable early ideas, current interpretation, and promotion rules
14. **[Glossary](glossary.md)** - Definitions of all terms used
15. **[Architecture Decision Records](adr/README.md)** - Key architectural choices
16. **[Technical Specifications (RFC)](rfc/README.md)** - Current contracts and historical designs
17. **[MVP User Stories](mvp/README.md)** - Historical requirements and retained product ideas
18. **[Causal Work Memory Roadmap](roadmap/0005-causal-work-memory-roadmap.md)** - Current north-star route, horizons, assumptions, and risk gates
19. **[Artifacts, Observations, and Context Packs](rfc/0010-artifacts-observations-and-context-packs.md)** - Future-safe boundary between manual memory, untrusted sources, and portable consumers
20. **[opskarta Roadmap](roadmap/opskarta.md)** - Current machine-checkable capability map
21. **[In-Day Structure Roadmap](roadmap/0004-in-day-structure-roadmap.md)** - Accepted in-day thoughts, zone visibility, dispatching, and gap classification layer
22. **[Periodic Reflection Roadmap](roadmap/0003-periodic-reflection-roadmap.md)** - Accepted period reports, semantic history, evidence, and reflection loop
23. **[Roadmap Index](roadmap/README.md)** - Roadmap status and related links

---

## Document Authority

Not every preserved document describes the current system.

1. [Current Implementation](current-implementation.md) and executable tests
   describe what runs now.
2. [Roadmap 0005](roadmap/0005-causal-work-memory-roadmap.md) and
   [opskarta](roadmap/opskarta.md) define the current order of work.
3. Accepted ADRs define architectural invariants.
4. RFCs describe contracts at different maturity levels; their index states
   whether each one is implemented, active design, or historical reference.
5. MVP stories and Roadmaps 0001–0002 are design history and an idea reservoir,
   not a current delivery commitment.
6. [Product Memory](product-memory-and-future-capabilities.md) preserves useful
   unscheduled ideas without presenting them as implemented or committed.

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
| [dogfood-operational-workspace.md](dogfood-operational-workspace.md) | Accepted four-day evidence, executable gate, interpretation boundary, and follow-up findings for Operational Workspace |
| [dogfood-working-memory.md](dogfood-working-memory.md) | Working Memory Bridge real-use protocol, 1/3/7-day pauses, Context Pack evidence, and strict gate |
| [acceptance-working-memory-bridge-v1.md](acceptance-working-memory-bridge-v1.md) | Requirement audit, automated evidence, live D0–D11 progress, and final completion rule |
| [acceptance-causal-work-spine-v1.md](acceptance-causal-work-spine-v1.md) | Requirement-by-requirement implementation and real-use audit |
| [dogfood-learnings.md](dogfood-learnings.md) | Cross-day product findings, principles, and updated development order |
| [product-memory-and-future-capabilities.md](product-memory-and-future-capabilities.md) | Recovered early ideas, future capability register, and promotion rules |
| [glossary.md](glossary.md) | Definitions of all terms and entities |

### Architecture Decision Records (ADR)

| Document | Status | Summary |
|----------|--------|---------|
| [ADR-0001](adr/0001-initial-architecture.md) | Accepted | Initial architecture for MVP |
| [ADR-0002](adr/0002-mvp-manual-first.md) | Accepted | MVP = Manual-first (Level 0) |
| [ADR-0003](adr/0003-evidence-mode-opt-in.md) | Proposed | Evidence-Mode as opt-in Level 3 |
| [ADR-0004](adr/0004-user-truth-and-derived-inference.md) | Accepted | User-confirmed state is authoritative; observations and machine interpretations keep provenance and remain correctable |
| [ADR-0005](adr/0005-untrusted-context-and-consumer-neutral-memory.md) | Accepted | External context stays untrusted; portable memory does not depend on one assistant or model provider |

### Technical Specifications (RFC)

| Document | Maturity | Summary |
|----------|----------|---------|
| [RFC-0001](rfc/0001-mvp-inventory-design.md) | Historical baseline / partial implementation | Original MVP inventory design; current behavior lives in code and Current Implementation |
| [RFC-0002](rfc/0002-system-topology-and-component-map.md) | Strategic draft / partial local slice | Long-horizon topology; Hub, sync and collectors are not implemented |
| [RFC-0003](rfc/0003-client-app-suite-architecture.md) | Strategic draft / partial desktop slice | Client-suite design; only browser and macOS surfaces are current |
| [RFC-0004](rfc/0004-local-api.md) | Implemented evolving contract | Local API architecture is live; exact methods live in shared contracts and code |
| [RFC-0005](rfc/0005-event-ingest-source-nodes.md) | Future draft | Event Ingest, SourceNode and Pairing after a successful bounded probe |
| [RFC-0006](rfc/0006-retention-ttl-distillation.md) | Future draft | Retention, TTL, Distillation and deletion controls |
| [RFC-0007](rfc/0007-evidence-mode-screen-evidence-source-node.md) | Far-future draft | Opt-in Screen Evidence Source Node |
| [RFC-0008](rfc/0008-periodic-reports-and-reflection.md) | Manual P0–P4 accepted / later slices draft | Period reports, Track/Label slices and Reflection Sessions work; in-app review and LLM layers remain future |
| [RFC-0009](rfc/0009-causal-work-memory-and-operational-reality.md) | Accepted v1 / Level 0+ to Level 3 | Accepted causal spine and Operational Reality v1, plus provenance, incremental migration, and the future bounded context probe |
| [RFC-0010](rfc/0010-artifacts-observations-and-context-packs.md) | Implemented manual slice / Level 0+ to Level 3 | Manual materials and Context Packs are implemented; untrusted observations, derivations, and deletion policy remain future work |

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
