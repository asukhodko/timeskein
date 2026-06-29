# Design Document: Evidence-Mode Documentation Integration

## Overview

This design document describes the approach for integrating Evidence-Mode (Dayflow-class) functionality into Timeskein documentation. The goal is to create a comprehensive documentation set that positions Evidence-Mode as a strictly opt-in Level 3 feature while preserving the MVP manual-first approach.

The documentation update involves:
1. Creating 5 new documentation files (ADR, RFC, user stories, UI/UX spec, roadmap)
2. Updating 15+ existing documentation files with Evidence-Mode references
3. Maintaining language consistency (Russian for Russian docs, English for English docs)
4. Ensuring all documentation clearly communicates that Evidence-Mode is opt-in Level 3

## Architecture

The documentation architecture follows the existing Timeskein documentation structure:

```
docs/
├── 00_project_overview.md          # Updated: Add Evidence-Mode concepts
├── index.md                        # Updated: Add new documents to tables
├── glossary.md                     # Updated: Add new terms
├── adr/
│   ├── README.md                   # Updated: Add ADR-0003
│   ├── 0001-initial-architecture.md # Updated: Forward reference
│   ├── 0002-mvp-manual-first.md    # Updated: Forward reference
│   └── 0003-evidence-mode-opt-in.md # NEW: Evidence-Mode decision
├── rfc/
│   ├── README.md                   # Updated: Add RFC-0007
│   ├── 0001-mvp-inventory-design.md # Updated: Forward reference
│   ├── 0002-system-topology-and-component-map.md # Updated: Add component
│   ├── 0003-client-app-suite-architecture.md # Updated: Add UI components
│   ├── 0004-local-api.md           # Updated: Add API endpoints
│   ├── 0005-event-ingest-source-nodes.md # Updated: Add collector type
│   ├── 0006-retention-ttl-distillation.md # Updated: Add TTL policies
│   └── 0007-evidence-mode-screen-evidence-source-node.md # NEW
├── mvp/
│   ├── README.md                   # Updated: Add Level 3 stories
│   ├── 01_user_story_context_capture.md # Updated: Forward reference
│   ├── 02_manual_inventory_ui_ux.md # Updated: Future integration
│   ├── 03_user_story_evidence_mode.md # NEW
│   └── 03_evidence_mode_ui_ux.md   # NEW
└── roadmap/
    ├── README.md                   # Updated: Add new roadmap
    ├── 0001-mvp-execution-roadmap.md # Updated: Forward reference
    └── 0002-level3-evidence-mode-roadmap.md # NEW
```

### Document Dependency Graph

```mermaid
flowchart TD
    subgraph Foundation["Foundation Documents"]
        Overview["00_project_overview.md"]
        Glossary["glossary.md"]
        Index["index.md"]
    end

    subgraph ADR["Architecture Decisions"]
        ADR1["ADR-0001: Initial Architecture"]
        ADR2["ADR-0002: MVP Manual-first"]
        ADR3["ADR-0003: Evidence-Mode Opt-in"]
    end

    subgraph RFC["Technical Specifications"]
        RFC1["RFC-0001: MVP Design"]
        RFC5["RFC-0005: Event Ingest"]
        RFC6["RFC-0006: Retention/TTL"]
        RFC7["RFC-0007: Screen Evidence"]
    end

    subgraph MVP["User Stories"]
        US1["01: Context Capture (L2)"]
        US3["03: Evidence-Mode (L3)"]
        UX3["03: Evidence-Mode UI/UX"]
    end

    subgraph Roadmap["Roadmaps"]
        RM1["0001: MVP Roadmap"]
        RM2["0002: Level 3 Roadmap"]
    end

    ADR2 --> ADR3
    ADR1 --> ADR3
    RFC5 --> RFC7
    RFC6 --> RFC7
    RM1 --> RM2
    ADR3 --> RFC7
    RFC7 --> US3
    US3 --> UX3
    RFC7 --> RM2


## Components and Interfaces

### Component 1: New Documentation Files

#### ADR-0003: Evidence-Mode Opt-in Decision

**Purpose**: Document the architectural decision to make Evidence-Mode strictly opt-in Level 3.

**Structure**:
- Status: Proposed (Draft)
- Level: Level 3
- Context: Why Evidence-Mode requires explicit opt-in
- Decision: Evidence-Mode is Level 3 only, never default
- Trust guarantees: opt-in, pause/resume, TTL, purge, revoke
- Chunking model: frames/chunks vs single screenshots
- Consequences: Privacy preserved, user control maintained
- Philosophy: Evidence-Mode is a sensor for context recovery, Work Items remain source of truth

**Language**: Russian (matches existing ADRs)

#### RFC-0007: Screen Evidence Source Node

**Purpose**: Technical specification for screen evidence capture.

**Structure**:
- SourceNode manifest (following RFC-0005 format)
- Required permissions (screen capture)
- Event types (evidence chunks)
- Evidence Artifact structure (frame/chunk with TTL)
- Provider abstraction (local/remote AI)
- Pipeline stages: Capture → Distill → Present → Cleanup
- Privacy controls: pause/resume, purge, redaction rules
- Configurable defaults: fps, chunk_duration, distill_interval
- Storage budget integration and GC hooks
- Revocation flow

**Language**: Russian (matches existing RFCs)

#### User Story 03: Evidence-Mode

**Purpose**: Describe Evidence-Mode from user perspective.

**Structure**:
- Level 3 opt-in marker
- Value proposition
- Acceptance criteria (EARS patterns)
- Privacy controls and trust guarantees
- Dependencies (RFC-0005, RFC-0006, RFC-0007)
- Distinction: Distraction Mark (classification) vs Redaction Rule (privacy)

**Language**: Russian (matches existing user stories)

#### UI/UX Spec 03: Evidence-Mode

**Purpose**: Define user interface for Evidence-Mode.

**Structure**:
- Card-based presentation (time range + summary + refs + marks + optional preview)
- Controls: enable/disable, pause/resume, purge
- Provider selection UI with privacy mode indicators
- Storage Budget management UI
- Distraction Mark as classification label
- Redaction Rules UI for privacy exclusions
- Opt-in emphasis in all UI flows

**Language**: Russian (matches existing UX docs)

#### Roadmap 0002: Level 3 Evidence-Mode

**Purpose**: Development plan for Evidence-Mode.

**Structure**:
- Post-MVP Level 3 positioning
- Phases: infrastructure, capture (chunking), processing, UI
- Dependencies on RFC-0005, RFC-0006, RFC-0007
- Gates for each phase

**Language**: Russian (matches existing roadmaps)

### Component 2: Updated Documentation Files

#### Foundation Documents Updates

| Document | Updates |
|----------|---------|
| `00_project_overview.md` | Add Capture Profile, Evidence-Mode (L3), Provider, Pipeline |
| `index.md` | Add ADR-0003, RFC-0007, new user stories, new roadmap; rename section |
| `glossary.md` | Add 10 new terms with proper definitions |

#### ADR Updates

| Document | Updates |
|----------|---------|
| `adr/README.md` | Add ADR-0003 to index table |
| `adr/0001-initial-architecture.md` | Add forward reference to Evidence-Mode as Level 3 |
| `adr/0002-mvp-manual-first.md` | Add forward reference to ADR-0003 |

#### RFC Updates

| Document | Updates |
|----------|---------|
| `rfc/README.md` | Add RFC-0007 to index table |
| `rfc/0001-mvp-inventory-design.md` | Add "Future: Level 3 Evidence-Mode" section |
| `rfc/0002-system-topology-and-component-map.md` | Add Screen Evidence SourceNode |
| `rfc/0003-client-app-suite-architecture.md` | Add Evidence-Mode UI components |
| `rfc/0004-local-api.md` | Add Evidence-Mode API endpoints, Provider API |
| `rfc/0005-event-ingest-source-nodes.md` | Add Screen Evidence collector type |
| `rfc/0006-retention-ttl-distillation.md` | Add Evidence Artifact TTL, Storage Budget, Purge |

#### MVP Updates

| Document | Updates |
|----------|---------|
| `mvp/README.md` | Add Evidence-Mode stories with Level 3 marker |
| `mvp/01_user_story_context_capture.md` | Add forward reference to Evidence-Mode |
| `mvp/02_manual_inventory_ui_ux.md` | Add future Evidence-Mode integration section |

#### Roadmap Updates

| Document | Updates |
|----------|---------|
| `roadmap/README.md` | Add Level 3 Evidence-Mode roadmap |
| `roadmap/0001-mvp-execution-roadmap.md` | Add reference to future Evidence-Mode phase |

## Data Models

### New Glossary Terms

```yaml
Capture Profile:
  definition: "Профиль захвата данных, определяющий уровень автоматизации"
  levels:
    - Level 0: Manual-first (без фонового сбора)
    - Level 2: Semantics-first (явный захват по команде)
    - Level 3: Full context (always-on collectors)
  level: Level 0+

Evidence-Mode:
  definition: "Режим Level 3 (opt-in) для захвата screen evidence chunks и их дистилляции в Cards/Episodes"
  key_properties:
    - Строго opt-in
    - Chunking model (frames/chunks, не одиночные скриншоты)
    - TTL для артефактов
    - Purge по команде пользователя
  level: Level 3

Evidence Artifact:
  definition: "Chunk — чувствительный артефакт с TTL"
  canonical_type: chunk (обязательно)
  frames: "derived/temporary для дистилляции, не хранятся как artifacts"
  storage: blob-store
  indexed: true
  ttl: configurable (recommended 72h for privacy-first baseline)
  level: Level 3

Card:
  definition: "Timeline Card / Episode Card — derived view/presentation of Episode"
  note: "View-model, не новая доменная сущность. Может опционально ссылаться на evidence artifacts"
  level: Level 2+
  storage: "derived cache (episode_card_cache), пересчитываемо"

Provider:
  definition: "Абстракция AI-провайдера для обработки артефактов"
  types:
    - local: обработка на устройстве
    - remote: облачный AI-сервис
  privacy_mode: reported to UI
  level: Level 2+

Storage Budget:
  definition: "Лимит хранилища для артефактов Evidence-Mode"
  default: 5 GB
  actions_on_limit:
    - warning
    - accelerated GC
    - stop capture
  level: Level 3

Purge:
  definition: "Удаление evidence artifacts (ephemeral) и связанных индексов/пойнтеров по команде пользователя"
  scope: evidence artifacts + evidence pointers (NOT derived Timeline Cards/Episodes)
  note: "Derived сохраняются как Distilled Snapshots, помечаются 'evidence purged'. НЕ равен Revocation"
  audit: creates tombstone event (evidence.artifact_purged)
  level: Level 3

Revocation:
  definition: "Отзыв источника: удаление canonical events + ephemeral artifacts по provenance"
  scope: canonical events + artifacts from source_id
  derived_handling: "пересчёт derived без этого источника, или удаление если пересчёт невозможен"
  note: "Используется при отзыве доверия к источнику"
  audit: logged
  level: Level 2+

Distilled Snapshot:
  definition: "Derived представление, сохраняемое после удаления upstream-сырья"
  note: "Не пересчитываемое, но содержит извлечённую ценность"
  use_case: "Timeline Cards после purge evidence"
  level: Level 2+

Distraction Mark:
  definition: "Авто-mark/label на эпизоде (off-task), классификация активности"
  note: "НЕ механизм исключения, только классификация"
  configurable: true
  level: Level 3

Redaction Rule:
  definition: "Механизм исключения/редакции данных на входе PolicyGate"
  note: "Доступные типы правил зависят от Capture Profile"
  types_by_level:
    - Level 0: ref/domain denylist
    - Level 2+: apps/domains/patterns
    - Level 3: evidence-specific exclusions
  level: Level 0+ (расширяется по уровням)

Sensitivity Level:
  definition: "Атрибут данных для применения политик retention/redaction"
  note: "НЕ пользовательская метка (Mark), а технический атрибут"
  levels:
    - normal: обычные данные, TTL 90d
    - private: приватные данные, TTL 7d
    - high: высокочувствительные, TTL 24h
  level: Level 2+

Screen Evidence SourceNode:
  definition: "SourceNode для захвата screen evidence chunks"
  capabilities:
    - chunking
    - evidence delivery
    - configurable fps/duration
    - frame_sampling (optional)
  permissions: screen capture
  level: Level 3

# Philosophy Note
Evidence-Mode Philosophy:
  principle: "Evidence-Mode — сенсор для восстановления контекста, НЕ трекер дисциплины"
  key_points:
    - Evidence-Mode помогает восстановить контекст работы
    - Work Items остаются источником истины для управления работой
    - Derived Cards/Episodes — вспомогательная память, не планировщик
    - Manual-first философия сохраняется на всех уровнях
```

### RFC-0007 Data Structures

```typescript
// Screen Evidence SourceNode Manifest
interface ScreenEvidenceManifest {
  source_id: "timeskein.collector.screen-evidence";
  source_type: "collector";
  version: string;
  name: "Screen Evidence Collector";
  description: string;
  
  capabilities: ["screen_capture", "chunking", "frame_sampling"];
  
  // Note: OCR extraction is optional future capability, not required
  
  permissions: {
    system: ["screen_capture"];
    data: ["screen_content", "window_info"];
    sensitivity: {
      screen_content: "sensitive";
      window_info: "sensitive"; // Window titles often contain private info
    };
  };
  
  // Note: Evidence events are ContextEvent subtypes (kind: "evidence.*")
  event_types: ["context_event.evidence.chunk_captured", "context_event.evidence.chunk_processed"];
  
  config_schema: {
    // Recommended (non-normative) defaults - actual values may vary
    fps: { type: "number"; default: 1; min: 0.1; max: 5; note: "recommended starting point" };
    chunk_duration_sec: { type: "number"; default: 15; min: 10; max: 300; note: "Dayflow-class: 15s" };
    distill_interval_sec: { type: "number"; default: 900; min: 60; max: 3600; note: "Dayflow-class: 15min" };
    storage_budget_mb: { type: "number"; default: 5120; note: "example: ~5GB" };
  };
}

// Evidence Artifact (capture-time only, no extracted data)
interface EvidenceArtifact {
  id: string;
  chunk_id: string;
  type: "chunk"; // Canonical type is always chunk
  ts_start: string; // ISO 8601
  ts_end: string;
  
  storage: {
    path: string;
    size_bytes: number;
    format: "webp" | "mp4";
  };
  
  // Capture-time metadata only (extracted data is in Derived store)
  capture_metadata: {
    app_id?: string; // if permitted
    // Note: extracted_text and extracted_refs are in Derived annotations (Distill stage)
  };
  
  provenance: {
    source_id: string;
    source_version: string;
    device_id: string;
    captured_at: string;
  };
  
  ttl: {
    expires_at: string;
    sensitivity: "normal" | "private" | "high"; // Sensitivity Level attribute
    // Recommended: 72h for privacy-first baseline (configurable)
  };
  
  // Tombstone info (set after purge)
  purged_at?: string;
}

// Timeline Card (derived view of Episode, NOT a new domain entity)
// Note: Cards = UI view model, Episodes = domain model
interface TimelineCard {
  episode_id: string; // Primary key - links to Episode
  
  time_range: {
    start: string;
    end: string;
  };
  
  summary: string;
  refs: RefView[];
  marks: Mark[];
  
  evidence_pointers?: {
    artifact_ids: string[];
    preview_url?: string;
    thumbnail_url?: string;
    evidence_purged?: boolean; // True if artifacts were purged
    purged_at?: string;
  };
  
  classification?: {
    distraction_mark: boolean;
    confidence: number;
  };
}

// Derived Annotations (from Distill stage)
interface DerivedAnnotations {
  artifact_id: string;
  processed_at: string;
  provider_id: string;
  
  extracted_text?: string;
  extracted_refs: RefView[];
  keywords?: string[];
}

// Provider
interface Provider {
  id: string;
  name: string;
  type: "local" | "remote";
  
  capabilities: string[];
  
  privacy: {
    data_leaves_device: boolean;
    encryption: boolean;
    retention_policy?: string;
  };
  
  status: "active" | "inactive" | "error";
}
```

### Local API Extensions (RFC-0004)

**Note**: These are illustrative draft endpoints. Final names and structure TBD in RFC-0004 update.

```typescript
// Evidence-Mode API methods (DRAFT - for future RFC-0004 section)
// Minimal control API - queries are separate
interface EvidenceModeAPI {
  // Evidence control (minimal)
  "evidence.enable": () => void;
  "evidence.disable": () => void;
  "evidence.pause": () => void;
  "evidence.resume": () => void;
  "evidence.purge": (confirm: string) => PurgeResult; // Purge evidence artifacts only
  "evidence.status": () => EvidenceStatus;
  
  // Providers (Level 2+)
  "providers.list": () => Provider[];
  "providers.get_active": () => Provider;
  "providers.set_active": (provider_id: string) => void;
  
  // Retention/Storage
  "retention.get": () => RetentionSettings;
  "retention.set": (settings: RetentionSettings) => void;
  
  // Export (queries)
  "export.timeline_markdown": (filter?: TimelineFilter) => string;
  
  // Note: Revocation is handled via sources.revoke() in RFC-0005
  // Note: cards.list, artifacts.get etc. are future optional extensions
}

interface EvidenceStatus {
  enabled: boolean;
  paused: boolean;
  provider: Provider;
  storage: StorageStatus;
  last_capture_at?: string;
  chunks_today: number;
}

interface StorageStatus {
  used_mb: number;
  budget_mb: number;
  artifacts_count: number;
  oldest_artifact_at?: string;
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following correctness properties have been identified. Note that most acceptance criteria for this documentation feature are example-based (verifying specific file contents) rather than property-based (universal quantification over inputs). However, several cross-cutting properties apply to all documents.

### Property 1: Language Preservation

*For any* document that is updated or created, the document language SHALL be preserved as it exists in the original file. Before making changes, determine the language from existing content.

**Validates: Requirements 1.7, 2.12, 3.8, 4.9, 5.6, 6.6, 7.6, 14.6**

### Property 2: Evidence-Mode Level 3 Opt-in Marking

*For any* document that mentions Evidence-Mode, the document SHALL include both:
1. A "Level 3" marker indicating the maturity level
2. An "opt-in" or equivalent marker indicating explicit user activation is required

**Validates: Requirements 1.4, 3.2, 5.2, 6.2, 14.2**

### Property 3: Privacy Controls Inclusion

*For any* document that describes Evidence-Mode functionality (RFC-0007, User Story 03, UI/UX 03), the document SHALL include a section describing privacy controls including at minimum: pause/resume, purge, and redaction rules.

**Validates: Requirements 2.8, 3.5, 4.3, 14.3**

### Property 4: Canonical Terminology

*For any* document that is created or updated, all references to the screen evidence feature SHALL use "Evidence-Mode" (with hyphen) and NOT "Evidence_Mode" (with underscore) or other variations.

**Validates: Requirements 14.8**

### Property 5: No .qoder/repowiki Modifications

*For any* file operation performed during this feature implementation, the file path SHALL NOT be within the `.qoder/repowiki/` directory.

**Validates: Requirements 14.7**

### Property 6: Distraction Mark vs Redaction Rule Distinction

*For any* document that defines both Distraction Mark and Redaction Rule terms, the definitions SHALL clearly distinguish:
- Distraction Mark: classification/label for off-task activity (NOT exclusion)
- Redaction Rule: privacy exclusion mechanism

**Validates: Requirements 3.7, 4.6, 4.7, 14.4**

## Error Handling

### File Creation Errors

| Error | Handling |
|-------|----------|
| Directory does not exist | Create parent directories automatically |
| File already exists | Fail with error (new files should not overwrite) |
| Permission denied | Report error, suggest manual intervention |

### File Update Errors

| Error | Handling |
|-------|----------|
| File does not exist | Report error (expected file missing) |
| File format unexpected | Report error, provide expected format |
| Content not found for replacement | Report error, show expected content |

### Content Validation Errors

| Error | Handling |
|-------|----------|
| Missing required section | Add section with appropriate content |
| Wrong language detected | Report warning, proceed with correct language |
| Invalid terminology used | Replace with canonical terminology |

## Testing Strategy

### Document Lint Checks

For documentation updates, testing focuses on automated lint checks:

1. **Language Consistency**
   - Verify Russian documents remain in Russian
   - Verify English documents remain in English

2. **Terminology Consistency**
   - Verify "Evidence-Mode" (with hyphen) is used consistently
   - Verify no "Evidence_Mode" or other variations

3. **Cross-Reference Validation**
   - Verify all forward references point to existing documents
   - Verify all backward references are consistent
   - Verify index.md tables match actual files

4. **Opt-in Marker Presence**
   - Verify all Evidence-Mode mentions include Level 3 marker
   - Verify opt-in language is present

5. **No .qoder Modifications**
   - Verify no files in .qoder/repowiki/ are modified

6. **Glossary Consistency**
   - Verify all new terms in glossary are used in at least one document
   - Verify all Evidence-Mode terms in documents are defined in glossary

### Manual Review Checklist

- [ ] Evidence-Mode never implied as default behavior
- [ ] MVP manual-first approach preserved
- [ ] Privacy controls documented in all Evidence-Mode docs
- [ ] Distraction Mark vs Redaction Rule clearly distinguished
- [ ] Purge vs Revocation semantics clear
