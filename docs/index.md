# Timeskein Documentation

## Overview

**Timeskein** is a personal context journal system that helps structure work activity into **episodes and threads of meaning**. The name is a metaphor for a skein of yarn: work activity is tangled across time and meaning, and Timeskein helps **untangle** it.

The system answers questions like:
- "What was I doing at time X?"
- "When and how did I solve problem Z?"
- "What's on my plate today?"
- "How much active focus time did I actually have today?"

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
3. **[Glossary](glossary.md)** - Definitions of all terms used
4. **[Architecture Decision Records](adr/README.md)** - Key architectural choices
5. **[Technical Specifications (RFC)](rfc/README.md)** - Detailed technical designs
6. **[MVP User Stories](mvp/README.md)** - Features and acceptance criteria
7. **[opskarta Roadmap](roadmap/opskarta.md)** - Current machine-checkable execution plan
8. **[Roadmap Archive](roadmap/README.md)** - Older roadmap documents and related links

---

## Canonical Documents

All documentation below is the **source of truth** for the project.

### Foundation

| Document | Description |
|----------|-------------|
| [00_project_overview.md](00_project_overview.md) | Main project document: concepts, principles, model |
| [current-implementation.md](current-implementation.md) | Current repository/runtime state |
| [glossary.md](glossary.md) | Definitions of all terms and entities |

### Architecture Decision Records (ADR)

| Document | Status | Summary |
|----------|--------|---------|
| [ADR-0001](adr/0001-initial-architecture.md) | Accepted | Initial architecture for MVP |
| [ADR-0002](adr/0002-mvp-manual-first.md) | Accepted | MVP = Manual-first (Level 0) |
| [ADR-0003](adr/0003-evidence-mode-opt-in.md) | Proposed | Evidence-Mode as opt-in Level 3 |

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
