# Technical Specifications (RFC)

This directory contains Request for Comments (RFC) documents that describe technical designs for Timeskein components.

## What is an RFC?

An RFC is a detailed technical specification for a feature or system component. RFCs go through review before implementation.

## RFC Index

| RFC | Status | Maturity | Title |
|-----|--------|----------|-------|
| [Current Implementation](../current-implementation.md) | Current | Current | What the repository actually runs today |
| [RFC-0001](0001-mvp-inventory-design.md) | Historical / partial | Level 0 | Original MVP inventory design and retained product hygiene |
| [RFC-0002](0002-system-topology-and-component-map.md) | Strategic draft / partial | Level 0+ | Local slice works; multi-device topology remains future |
| [RFC-0003](0003-client-app-suite-architecture.md) | Strategic draft / partial | Level 0+ | Browser/macOS slice works; full client suite remains future |
| [RFC-0004](0004-local-api.md) | Implemented, evolving | Level 0+ | Live Surface-Agent boundary; exact methods live in contracts and code |
| [RFC-0005](0005-event-ingest-source-nodes.md) | Future draft | Level 2+ | Event Ingest + SourceNode + Pairing after the bounded probe |
| [RFC-0006](0006-retention-ttl-distillation.md) | Future draft | Level 2+ | Retention, TTL, Distillation and deletion controls |
| [RFC-0007](0007-evidence-mode-screen-evidence-source-node.md) | Far-future draft | Level 3 | Opt-in Screen Evidence Source Node |
| [RFC-0008](0008-periodic-reports-and-reflection.md) | P0-P4 accepted / later draft | Level 0+ / Level 2+ | Manual period reports and reflection work; in-app and LLM layers remain future |
| [RFC-0009](0009-causal-work-memory-and-operational-reality.md) | Accepted v1 / active evolution | Strategic / Level 0+ to Level 3 | Accepted causal spine and Operational Reality; Working Memory implementation awaits real acceptance |
| [RFC-0010](0010-artifacts-observations-and-context-packs.md) | Manual slice implemented / future source draft | Level 0+ to Level 3 | Manual materials and Context Packs work; observations and derivations remain future |

## How to Interpret Older RFCs

An RFC is not automatically a current delivery commitment. When a design and
the running system differ, use this order:

1. executable tests and [Current Implementation](../current-implementation.md);
2. accepted ADRs;
3. [Roadmap 0005](../roadmap/0005-causal-work-memory-roadmap.md) and
   [opskarta](../roadmap/opskarta.md);
4. the RFC as architectural intent or design history.

Useful unscheduled ideas recovered from older RFCs are collected in
[Product Memory and Future Capabilities](../product-memory-and-future-capabilities.md).

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
