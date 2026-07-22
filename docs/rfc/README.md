# Technical Specifications (RFC)

This directory contains Request for Comments (RFC) documents that describe technical designs for Timeskein components.

## What is an RFC?

An RFC is a detailed technical specification for a feature or system component. RFCs go through review before implementation.

## RFC Index

| RFC | Status | Maturity | Title |
|-----|--------|----------|-------|
| [Current Implementation](../current-implementation.md) | Current | Current | What the repository actually runs today |
| [RFC-0001](0001-mvp-inventory-design.md) | Draft | Level 0 | MVP inventory design |
| [RFC-0002](0002-system-topology-and-component-map.md) | Draft | Level 0+ | System topology and component map |
| [RFC-0003](0003-client-app-suite-architecture.md) | Draft | Level 0+ | Client application suite architecture |
| [RFC-0004](0004-local-api.md) | Draft | Level 0+ | Local API (Surface - Agent) |
| [RFC-0005](0005-event-ingest-source-nodes.md) | Draft | Level 2+ | Event Ingest + SourceNode + Pairing |
| [RFC-0006](0006-retention-ttl-distillation.md) | Draft | Level 2+ | Retention, TTL, Distillation |
| [RFC-0007](0007-evidence-mode-screen-evidence-source-node.md) | Draft | Level 3 | Screen Evidence Source Node (Evidence-Mode) |
| [RFC-0008](0008-periodic-reports-and-reflection.md) | Draft | Level 0+ / Level 2+ | Periodic Reports and Reflection Loops |
| [RFC-0009](0009-causal-work-memory-and-operational-reality.md) | Implemented | Strategic / Level 0+ to Level 3 | Accepted Causal Work Memory v1, Operational Reality, provenance, incremental migration, and bounded Context Probe |
| [RFC-0010](0010-artifacts-observations-and-context-packs.md) | Draft | Level 0+ to Level 3 | Consumer-neutral artifacts, untrusted observations, derivations, accepted claims, and Context Packs |

## Maturity Levels

- **Level 0** - Core for MVP (manual-first)
- **Level 0+** - Applies to all levels
- **Level 2+** - Required for context capture features (not in MVP)
- **Level 3** - Required for always-on collectors

## Status Legend

- **Draft** - Under development/review
- **Accepted** - Approved for implementation
- **Implemented** - Fully implemented

---

[Back to Documentation Index](../index.md)
