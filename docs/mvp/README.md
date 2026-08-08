# MVP User Stories

This directory preserves the original user stories and UX specifications.
They are design history and an idea reservoir, not the current implementation
contract or delivery order. Use [Current Implementation](../current-implementation.md),
[Roadmap 0005](../roadmap/0005-causal-work-memory-roadmap.md), and
[opskarta](../roadmap/opskarta.md) for current status and sequence.

## Historical Implementation Order

The original Level 0 plan used this order:

1. **[02_user_story_manual_inventory.md](02_user_story_manual_inventory.md)** - Core MVP feature
2. **[02_manual_inventory_ui_ux.md](02_manual_inventory_ui_ux.md)** - UI/UX for manual inventory

Current implementation status is tracked in [../current-implementation.md](../current-implementation.md).
Retained unscheduled ideas such as onboarding, Settings, denylist, export,
conflict resolution, inventory grooming, SourceNode controls, and Evidence
Mode boundaries are summarized in
[Product Memory and Future Capabilities](../product-memory-and-future-capabilities.md).

## User Story Index

| Document | Level | Priority | Description |
|----------|-------|----------|-------------|
| [02_user_story_manual_inventory.md](02_user_story_manual_inventory.md) | Level 0 | MVP | Manual work item inventory |
| [02_manual_inventory_ui_ux.md](02_manual_inventory_ui_ux.md) | Level 0 | MVP | UI/UX specification |
| [01_user_story_context_capture.md](01_user_story_context_capture.md) | Level 2 | Future | Automatic context capture |
| [03_user_story_evidence_mode.md](03_user_story_evidence_mode.md) | Level 3 | Future | Evidence-Mode (opt-in screen evidence) |
| [03_evidence_mode_ui_ux.md](03_evidence_mode_ui_ux.md) | Level 3 | Future | Evidence-Mode UI/UX specification |

## Notes

- **Level 0 stories** are in scope for MVP
- **Level 2 stories** describe future functionality (context capture, not in MVP)
- **Level 3 stories** describe strictly opt-in Evidence-Mode functionality (NOT part of MVP)
- See [ADR-0002](../adr/0002-mvp-manual-first.md) for the manual-first decision
- See [ADR-0003](../adr/0003-evidence-mode-opt-in.md) for the Evidence-Mode opt-in decision

## Evidence-Mode (Level 3) — NOT in MVP

Evidence-Mode is a strictly opt-in Level 3 feature that enables screen evidence capture. It is **NOT** part of MVP and requires explicit user consent to enable.

Key characteristics:
- Opt-in only — never enabled by default
- Requires explicit user action to activate
- See [03_user_story_evidence_mode.md](03_user_story_evidence_mode.md) for details
- See [ADR-0003](../adr/0003-evidence-mode-opt-in.md) for architectural decision

---

[Back to Documentation Index](../index.md)
