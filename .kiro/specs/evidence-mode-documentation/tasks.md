# Implementation Plan: Evidence-Mode Documentation

## Overview

This implementation plan covers the documentation updates to integrate Evidence-Mode (Dayflow-class) functionality into Timeskein documentation. All tasks involve creating or modifying documentation files in `docs/**`. No code implementation is included.

## Tasks

- [x] 0. Repository audit and language detection
  - Verify all target files exist in `docs/**`
  - Determine language of each file (RU/EN) from existing content
  - Check for existing terms that may conflict (purge, revoke, sensitivity, artifact)
  - Document findings for use in subsequent tasks
  - _Requirements: 14.6_

- [x] 1. Update Glossary baseline (foundation for all other docs)
  - [x] 1.1 Update `docs/glossary.md` - Add new terms
    - Add Capture Profile definition
    - Add Evidence-Mode definition with Level 3 marker and chunking model
    - Add Evidence Artifact definition (chunk canonical, frames derived/temporary)
    - Add Timeline Card definition (derived view of Episode, Level 2+)
    - Add Provider definition (Level 2+)
    - Add Storage Budget definition
    - Add Purge definition (evidence artifacts only, creates Distilled Snapshot)
    - Add Revocation definition (delete canonical+ephemeral, recompute derived)
    - Add Distilled Snapshot definition (derived preserved after upstream deletion)
    - Add Distraction Mark definition (classification, NOT exclusion)
    - Add Redaction Rule definition (privacy exclusion, Level 0+)
    - Add Sensitivity Level definition (normal/private/high with TTL guidance)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_
  
  - [x] 1.2 Update `docs/glossary.md` - Update existing terms
    - Update Artifact: clarify "evidence chunk" as canonical type
    - Update Retention: "derived обычно пересчитываемые, но возможны distilled snapshots"
    - Update Provenance: add provider_id/capture_profile_id context
    - Preserve document language
    - _Requirements: 10.7, 10.8, 10.9_

- [x] 2. Update RFC-0006: Retention/TTL/Distillation (lifecycle foundation)
  - Update `docs/rfc/0006-retention-ttl-distillation.md`
  - Add Evidence Artifact TTL policies
  - Add Storage Budget + GC policy
  - Add Purge semantics + audit trail (tombstone events)
  - Add Distilled Snapshot concept (derived preserved after upstream deletion)
  - Add Revocation semantics (delete canonical+ephemeral, recompute derived)
  - Preserve document language
  - _Requirements: 10.7, 10.8, 10.9_

- [x] 3. Create ADR-0003: Evidence-Mode Opt-in Decision
  - Create file `docs/adr/0003-evidence-mode-opt-in.md`
  - Include: Status (Proposed), Level 3 marker, context, decision, trust guarantees
  - State chunking principle (details in RFC-0007)
  - Add philosophy note: Evidence-Mode is sensor, Work Items remain source of truth
  - Reference ADR-0002 as foundation
  - If open questions arise, document in "Open Questions" section
  - Write in document language (determine from repo audit)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 4. Update RFC-0005: Event Ingest + SourceNode
  - Update `docs/rfc/0005-event-ingest-source-nodes.md`
  - Add Screen Evidence collector type with chunking
  - Note evidence events as ContextEvent subtypes (kind: "evidence.*")
  - Preserve document language
  - _Requirements: 10.6_

- [x] 5. Create RFC-0007: Screen Evidence Source Node
  - [x] 5.1 Create file `docs/rfc/0007-evidence-mode-screen-evidence-source-node.md`
    - Include: SourceNode manifest following RFC-0005 format
    - Define permissions (screen_capture), event types (ContextEvent subtypes)
    - Reference RFC-0006 for retention semantics
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 5.2 Add Evidence Artifact and Pipeline sections
    - Define Evidence Artifact structure (chunk with TTL)
    - Define Provider abstraction (local/remote)
    - Define Pipeline stages: Capture → Distill → Present → Cleanup
    - _Requirements: 2.5, 2.6, 2.7_
  
  - [x] 5.3 Add privacy and configuration sections
    - Include privacy controls: pause/resume, purge, redaction rules
    - Specify recommended (non-normative) defaults: fps, chunk_duration, distill_interval
    - Specify storage budget integration, GC hooks, purge vs revocation semantics
    - Add revocation flow (reference RFC-0005)
    - If open questions arise, document in "Open Questions" section
    - Write in document language
    - _Requirements: 2.8, 2.9, 2.10, 2.11, 2.12_

- [x] 6. Checkpoint - Verify foundation documents
  - Ensure glossary updated with all new terms
  - Ensure RFC-0006 has retention/purge/revocation semantics
  - Ensure ADR-0003 and RFC-0007 created
  - Verify cross-references are consistent
  - Document any open questions found

- [x] 7. Update remaining RFC documents
  - [x] 7.1 Update `docs/rfc/README.md`
    - Add RFC-0007 to index table with Level 3 maturity
    - _Requirements: 10.1_
  
  - [x] 7.2 Update `docs/rfc/0001-mvp-inventory-design.md`
    - Add section "Future: Level 3 Evidence-Mode (non-MVP)"
    - Add forward links to ADR-0003 and RFC-0007
    - State manual-first approach not changed by Evidence-Mode
    - Preserve document language
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  
  - [x] 7.3 Update `docs/rfc/0002-system-topology-and-component-map.md`
    - Add Screen Evidence SourceNode to component map
    - Preserve document language
    - _Requirements: 10.2_
  
  - [x] 7.4 Update `docs/rfc/0003-client-app-suite-architecture.md`
    - Add Evidence-Mode UI components section
    - Preserve document language
    - _Requirements: 10.3_
  
  - [x] 7.5 Update `docs/rfc/0004-local-api.md`
    - Add section for future Evidence-Mode API endpoints (draft)
    - Add section for future provider listing/selection API (draft)
    - Preserve document language
    - _Requirements: 10.4, 10.5_

- [x] 8. Create User Story and UX documents
  - [x] 8.1 Create User Story 03: Evidence-Mode
    - Create file `docs/mvp/03_user_story_evidence_mode.md`
    - Include: Level 3 opt-in marker, value proposition
    - Write acceptance criteria with EARS patterns
    - Document privacy controls and trust guarantees
    - Reference dependencies (RFC-0005, RFC-0006, RFC-0007)
    - Distinguish Distraction Mark (classification) from Redaction Rule (privacy)
    - Write in document language
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  
  - [x] 8.2 Create UI/UX Spec 03: Evidence-Mode
    - Create file `docs/mvp/03_evidence_mode_ui_ux.md`
    - Describe Timeline Card-based presentation (Cards = UI view, Episodes = model)
    - Specify controls: enable/disable, pause/resume, purge
    - Describe Provider selection UI with privacy mode indicators
    - Specify Storage Budget management UI
    - Describe Distraction Mark as classification label
    - Describe Redaction Rules UI for privacy exclusions
    - Emphasize opt-in nature in all UI flows
    - Write in document language
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 9. Update foundation and index documents
  - [x] 9.1 Update `docs/00_project_overview.md`
    - Add Capture Profile concept
    - Describe Evidence-Mode as Level 3 opt-in with chunking model
    - Add Provider abstraction to architecture components
    - Add Pipeline concept to data processing
    - Ensure no implication of default screen recording
    - Preserve document language
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [x] 9.2 Update `docs/index.md`
    - Add ADR-0003 to ADR table
    - Add RFC-0007 to RFC table with Level 3 maturity
    - Add new user stories to User Stories table
    - Add Level column to User Stories table (not rename section)
    - Add new roadmap to Roadmap table
    - Preserve English language
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 10. Update ADR documents
  - [x] 10.1 Update `docs/adr/README.md`
    - Add ADR-0003 to index table
    - _Requirements: 9.1_
  
  - [x] 10.2 Update `docs/adr/0001-initial-architecture.md`
    - Add forward reference to Evidence-Mode as Level 3 extension
    - Preserve document language
    - _Requirements: 9.2_
  
  - [x] 10.3 Update `docs/adr/0002-mvp-manual-first.md`
    - Add forward reference to ADR-0003
    - Preserve document language
    - _Requirements: 9.3, 9.4_

- [x] 11. Update MVP documents
  - [x] 11.1 Update `docs/mvp/README.md`
    - Add Evidence-Mode user stories with Level 3 marker
    - Clearly state Evidence-Mode is NOT part of MVP
    - Preserve document language
    - _Requirements: 11.1, 11.4, 11.5_
  
  - [x] 11.2 Update `docs/mvp/01_user_story_context_capture.md`
    - Add forward reference to Evidence-Mode
    - Preserve document language
    - _Requirements: 11.2_
  
  - [x] 11.3 Update `docs/mvp/02_manual_inventory_ui_ux.md`
    - Add section about future Evidence-Mode integration
    - Preserve document language
    - _Requirements: 11.3_

- [x] 12. Create and update Roadmap documents
  - [x] 12.1 Create Roadmap 0002: Level 3 Evidence-Mode
    - Create file `docs/roadmap/0002-level3-evidence-mode-roadmap.md`
    - Position as post-MVP Level 3 feature
    - Define phases: infrastructure, capture (chunking), processing, UI
    - Specify dependencies on RFC-0005, RFC-0006, RFC-0007
    - Include gates for each phase
    - Write in document language
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  
  - [x] 12.2 Update `docs/roadmap/README.md`
    - Add Level 3 Evidence-Mode roadmap entry
    - Preserve document language
    - _Requirements: 12.1_
  
  - [x] 12.3 Update `docs/roadmap/0001-mvp-execution-roadmap.md`
    - Add reference to future Evidence-Mode phase
    - Preserve document language
    - _Requirements: 12.2, 12.3_

- [x] 13. Final checkpoint - Documentation validation
  - Verify all new files created (5 files)
  - Verify all existing files updated (15+ files)
  - Run document lint checks:
    - Language consistency (preserved from original)
    - Terminology consistency (Evidence-Mode with hyphen)
    - Cross-reference validation
    - Opt-in marker presence
    - No .qoder/repowiki modifications
  - Verify glossary consistency
  - Manual review checklist:
    - Evidence-Mode never implied as default
    - MVP manual-first approach preserved
    - Privacy controls documented
    - Distraction Mark vs Redaction Rule distinguished
    - Purge vs Revocation semantics clear
    - Cards = UI view, Episodes = domain model
  - Document any remaining open questions in ADR-0003/RFC-0007
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

## Notes

- All documentation preserves the language of existing documents (determine from content)
- Evidence-Mode is strictly Level 3 opt-in - this must be emphasized throughout
- No modifications to `.qoder/repowiki/**` files
- MVP manual-first approach must not be changed
- Use canonical terminology: "Evidence-Mode" (with hyphen), "Timeline Card", "Sensitivity Level"
- Cards = UI view model, Episodes = domain model
- Evidence Artifact canonical type = chunk (frames are derived/temporary)
- Purge creates Distilled Snapshots; Revocation recomputes derived
- Open questions go in "Open Questions" sections, not user prompts
