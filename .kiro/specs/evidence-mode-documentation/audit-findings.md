# Repository Audit Findings for Evidence-Mode Documentation

## Task 0: Repository Audit and Language Detection

**Date:** Audit completed
**Validates:** Requirements 14.6

---

## 1. File Existence Verification

All 19 target files exist in `docs/**`:

| File | Exists | Status |
|------|--------|--------|
| `docs/00_project_overview.md` | ✅ | Ready for update |
| `docs/index.md` | ✅ | Ready for update |
| `docs/glossary.md` | ✅ | Ready for update |
| `docs/adr/README.md` | ✅ | Ready for update |
| `docs/adr/0001-initial-architecture.md` | ✅ | Ready for update |
| `docs/adr/0002-mvp-manual-first.md` | ✅ | Ready for update |
| `docs/rfc/README.md` | ✅ | Ready for update |
| `docs/rfc/0001-mvp-inventory-design.md` | ✅ | Ready for update |
| `docs/rfc/0002-system-topology-and-component-map.md` | ✅ | Ready for update |
| `docs/rfc/0003-client-app-suite-architecture.md` | ✅ | Ready for update |
| `docs/rfc/0004-local-api.md` | ✅ | Ready for update |
| `docs/rfc/0005-event-ingest-source-nodes.md` | ✅ | Ready for update |
| `docs/rfc/0006-retention-ttl-distillation.md` | ✅ | Ready for update |
| `docs/mvp/README.md` | ✅ | Ready for update |
| `docs/mvp/01_user_story_context_capture.md` | ✅ | Ready for update |
| `docs/mvp/02_manual_inventory_ui_ux.md` | ✅ | Ready for update |
| `docs/mvp/02_user_story_manual_inventory.md` | ✅ | Ready for update |
| `docs/roadmap/README.md` | ✅ | Ready for update |
| `docs/roadmap/0001-mvp-execution-roadmap.md` | ✅ | Ready for update |

---

## 2. Language Detection

### Russian Documents (RU)

| File | Language | Evidence |
|------|----------|----------|
| `docs/00_project_overview.md` | **Russian** | "Timeskein — общее описание проекта", "Статус", "Связанные документы" |
| `docs/glossary.md` | **Russian** | "Глоссарий Timeskein", "Основные сущности", "Архитектурные компоненты" |
| `docs/adr/0001-initial-architecture.md` | **Russian** | "Начальная архитектура Timeskein", "Статус", "Принято" |
| `docs/adr/0002-mvp-manual-first.md` | **Russian** | "MVP = Manual-first", "Статус", "Принято" |
| `docs/rfc/0001-mvp-inventory-design.md` | **Russian** | "Дизайн реализации MVP-фичи", "Статус", "Draft" |
| `docs/rfc/0002-system-topology-and-component-map.md` | **Russian** | "Топология системы и карта компонентов", "Зачем этот документ" |
| `docs/rfc/0003-client-app-suite-architecture.md` | **Russian** | "Концептуальная архитектура клиентских приложений", "Зачем этот документ" |
| `docs/rfc/0004-local-api.md` | **Russian** | "Local API (Surface ↔ Agent)", "Цель", "Принципы" |
| `docs/rfc/0005-event-ingest-source-nodes.md` | **Russian** | "Event Ingest + SourceNode + Pairing", "Цель", "Модель SourceNode" |
| `docs/rfc/0006-retention-ttl-distillation.md` | **Russian** | "Retention, TTL и Distillation Pipeline", "Цель", "Слои данных" |
| `docs/mvp/01_user_story_context_capture.md` | **Russian** | "Захват текущего контекста", "Статус", "Короткое описание" |
| `docs/mvp/02_manual_inventory_ui_ux.md` | **Russian** | "UI/UX концепт для MVP", "Назначение документа" |
| `docs/mvp/02_user_story_manual_inventory.md` | **Russian** | "Ручной инвентарь работы", "Статус", "Короткое описание" |
| `docs/roadmap/0001-mvp-execution-roadmap.md` | **Russian** | "MVP Execution Plan", "Статус", "Актуальный" |

### English Documents (EN)

| File | Language | Evidence |
|------|----------|----------|
| `docs/index.md` | **English** | "Timeskein Documentation", "Overview", "Core Principles" |
| `docs/adr/README.md` | **English** | "Architecture Decision Records", "What is an ADR?" |
| `docs/rfc/README.md` | **English** | "Technical Specifications (RFC)", "What is an RFC?" |
| `docs/mvp/README.md` | **English** | "MVP User Stories", "Implementation Order" |
| `docs/roadmap/README.md` | **English** | "Roadmap", "Roadmap Documents" |

---

## 3. Existing Term Analysis

### Term: "Artifact" / "Артефакт"

**Current Usage:**
- `docs/glossary.md`: Defined as "Вложение к событию — тяжёлые данные с ограниченным временем жизни" (Level 3)
- `docs/rfc/0006-retention-ttl-distillation.md`: Used in "Ephemeral" layer (Screenshot, Transcript, FullContent)
- `docs/rfc/0001-mvp-inventory-design.md`: Mentioned in Part B as "Артефакты с TTL (Level 3)"

**Conflict Assessment:** ⚠️ **Minor update needed**
- Current definition is generic ("вложение к событию")
- Evidence-Mode introduces "Evidence Artifact" as a specific type (chunk with TTL)
- Need to clarify that "chunk" is the canonical type for Evidence Artifacts

### Term: "Revocation" / "Отзыв"

**Current Usage:**
- `docs/glossary.md`: Defined as "Отключение источника + удаление всех данных с его provenance" (Level 2+)
- `docs/rfc/0005-event-ingest-source-nodes.md`: Full section on Revocation process
- `docs/adr/0001-initial-architecture.md`: Mentioned in "Принципы безопасности источников"

**Conflict Assessment:** ✅ **Compatible, needs extension**
- Current definition focuses on source revocation
- Evidence-Mode adds nuance: revocation = delete canonical + ephemeral, then recompute derived
- Need to add distinction from "Purge" (which only deletes ephemeral, preserves derived as Distilled Snapshots)

### Term: "Sensitivity" / "Чувствительность"

**Current Usage:**
- `docs/glossary.md`: Not explicitly defined as a term, but mentioned in context
- `docs/rfc/0006-retention-ttl-distillation.md`: Uses "Уровни чувствительности" with `normal`, `sensitive`, `private`
- `docs/rfc/0005-event-ingest-source-nodes.md`: Uses `sensitivity_defaults` in manifests

**Conflict Assessment:** ⚠️ **Terminology alignment needed**
- RFC-0006 uses: `normal`, `sensitive`, `private`
- Evidence-Mode spec uses: `normal`, `private`, `high`
- Need to align terminology or clarify that Evidence-Mode uses different levels

**Recommendation:** Update Evidence-Mode to use existing terminology (`normal`, `sensitive`, `private`) OR add "Sensitivity Level" as a new glossary term with the Evidence-Mode specific levels.

### Term: "Purge"

**Current Usage:**
- Not currently defined in glossary
- Not used in existing documentation

**Conflict Assessment:** ✅ **No conflict - new term**
- "Purge" is a new concept for Evidence-Mode
- Definition: Delete evidence artifacts (ephemeral) and related indexes/pointers, preserve derived as Distilled Snapshots
- Distinct from Revocation

### Additional Terms to Watch

| Term | Current Status | Action |
|------|----------------|--------|
| "Episode" | Defined in glossary | Compatible - Evidence-Mode extends with evidence pointers |
| "TTL" | Defined in glossary | Compatible - Evidence-Mode adds specific TTL policies |
| "Distillation" | Defined in glossary | Compatible - Evidence-Mode adds "Distilled Snapshot" concept |
| "Provider" | Not defined | New term for Evidence-Mode |
| "Storage Budget" | Not defined | New term for Evidence-Mode |
| "Capture Profile" | Not defined | New term for Evidence-Mode |
| "Timeline Card" | Not defined | New term for Evidence-Mode (derived view of Episode) |
| "Distraction Mark" | Not defined | New term for Evidence-Mode |
| "Redaction Rule" | Not defined | New term for Evidence-Mode |

---

## 4. Document Structure Patterns

### ADR Format (Russian)
```markdown
# ADR-XXXX: [Title in Russian]

## Статус
**Принято** / **Draft**

## Уровень зрелости
**Level X**

## Связанные документы
- [links]

## Контекст
## Решение
## Последствия
```

### RFC Format (Russian)
```markdown
# RFC-XXXX: [Title in Russian]

## Статус
**Draft**

## Уровень зрелости
**Level X+**

## Связанные документы
- [links]

## 1. Цель
## 2. [Sections]
```

### User Story Format (Russian)
```markdown
# User Story: [Title in Russian]

## Статус
**Level X**

## Связанные документы
- [links]

## Название
## Короткое описание
## Контекст и ценность
## User Story
## Acceptance Criteria
```

---

## 5. Cross-Reference Patterns

### Index Tables (English - docs/index.md)
- ADR table: Document | Status | Summary
- RFC table: Document | Maturity | Summary
- User Stories table: Document | Description
- Roadmap table: Document | Description

### README Tables (English)
- ADR README: ADR | Status | Maturity | Title
- RFC README: RFC | Status | Maturity | Title
- MVP README: Document | Level | Priority | Description
- Roadmap README: Document | Description

---

## 6. Recommendations for Subsequent Tasks

### Language Preservation
- **Russian documents:** All ADRs, RFCs, User Stories, Roadmaps (content files)
- **English documents:** All README.md files, index.md

### Terminology Alignment
1. **Sensitivity Level:** Align with existing `normal`/`sensitive`/`private` OR explicitly define new levels
2. **Artifact:** Extend definition to include "Evidence Artifact (chunk)" as canonical type
3. **Revocation:** Extend definition to clarify relationship with Purge

### New Terms to Add to Glossary
1. Capture Profile
2. Evidence-Mode (with Level 3 marker)
3. Evidence Artifact (chunk canonical, frames derived/temporary)
4. Timeline Card (derived view of Episode)
5. Provider
6. Storage Budget
7. Purge (distinct from Revocation)
8. Distilled Snapshot
9. Distraction Mark
10. Redaction Rule
11. Sensitivity Level (if using different levels than existing)
12. Screen Evidence SourceNode

### Document Creation Order
1. Update Glossary first (foundation for all other docs)
2. Update RFC-0006 (retention/purge/revocation semantics)
3. Create ADR-0003 (Evidence-Mode decision)
4. Update RFC-0005 (SourceNode types)
5. Create RFC-0007 (Screen Evidence SourceNode)
6. Create User Stories and UX docs
7. Update remaining documents with cross-references
8. Create Roadmap

---

## 7. Files NOT to Modify

Per Requirements 14.7:
- `.qoder/repowiki/**` - Do NOT modify any files in this directory

---

## Summary

✅ All 19 target files exist and are ready for update
✅ Language detection complete (14 Russian, 5 English)
⚠️ Minor terminology alignment needed for "Sensitivity Level"
⚠️ "Artifact" definition needs extension for Evidence Artifacts
✅ "Revocation" compatible, needs extension to distinguish from "Purge"
✅ "Purge" is a new term with no conflicts
✅ Document structure patterns identified for consistent formatting
