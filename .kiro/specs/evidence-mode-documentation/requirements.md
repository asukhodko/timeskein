# Requirements Document

## Introduction

Обновление документации Timeskein для интеграции Evidence-Mode (Dayflow-class) функциональности. Evidence-Mode — это строго opt-in функция Level 3, которая позволяет захватывать screen evidence chunks (серии кадров/короткие чанки) и дистиллировать их в Cards/Episodes. Документация должна чётко позиционировать Evidence-Mode как опциональное расширение, не меняющее MVP manual-first подход.

## Glossary

- **Evidence-Mode**: Режим Level 3 (opt-in) для захвата screen evidence chunks (серии кадров/коротких чанков) и их дистилляции в Cards/Episodes. Строго opt-in.
- **Capture Profile**: Профиль захвата данных, определяющий уровень автоматизации (Level 0/2/3).
- **Evidence Artifact**: Chunk — чувствительный артефакт с TTL. Канонический тип = chunk. Frames — только derived/temporary для дистилляции.
- **Card**: Timeline Card / Episode Card — derived view/presentation of Episode. Level 2+. Может опционально ссылаться на evidence artifacts.
- **Provider**: Абстракция AI-провайдера для обработки артефактов (локальный/удалённый). Level 2+.
- **Storage Budget**: Лимит хранилища для артефактов Evidence-Mode.
- **Purge**: Удаление evidence artifacts (ephemeral) и связанных индексов/пойнтеров по команде пользователя. Derived Timeline Cards/Episodes сохраняются как distilled snapshots (помечаются "evidence purged"). НЕ равен Revocation.
- **Revocation**: Отзыв источника: удаление canonical events + ephemeral artifacts по provenance, затем пересчёт derived представлений без этого источника (или удаление derived, если пересчёт невозможен).
- **Distilled Snapshot**: Derived представление, сохраняемое после удаления upstream-сырья. Не пересчитываемое, но содержит извлечённую ценность.
- **Distraction Mark**: Авто-mark/label на эпизоде (off-task), классификация активности. НЕ механизм исключения.
- **Redaction Rule**: Механизм исключения/редакции данных на входе PolicyGate. Доступные типы правил зависят от Capture Profile (Level 0: ref/domain; Level 2+: apps/domains/patterns; Level 3: evidence-specific rules).
- **Sensitivity Level**: Атрибут данных для применения политик retention/redaction. НЕ пользовательская метка. Уровни: normal (обычные данные, TTL 90d), private (приватные, TTL 7d), high (высокочувствительные, TTL 24h).
- **Pipeline**: Цепочка обработки данных: Capture → Distill → Present → Cleanup.
- **Screen Evidence SourceNode**: SourceNode для захвата screen evidence chunks (chunking + evidence delivery).

## Requirements

### Requirement 1: ADR для Evidence-Mode opt-in решения

**User Story:** As a документатор проекта, I want создать ADR, фиксирующий решение о Evidence-Mode как строго opt-in Level 3 функции, so that архитектурное решение было задокументировано и обосновано.

#### Acceptance Criteria

1. THE Documentation_System SHALL create file `docs/adr/0003-evidence-mode-opt-in.md`
2. WHEN creating ADR-0003, THE Documentation_System SHALL include context explaining why Evidence-Mode is opt-in
3. THE ADR SHALL reference ADR-0002 (MVP = Manual-first) as foundation
4. THE ADR SHALL explicitly state that Evidence-Mode is Level 3 only
5. THE ADR SHALL document trust guarantees: explicit opt-in, pause/resume, TTL, purge, revoke
6. THE ADR SHALL state the principle: evidence capture is chunked (not raw continuous recording), details in RFC-0007
7. THE ADR SHALL be written in Russian to match existing ADR documents

### Requirement 2: RFC для Screen Evidence Source Node

**User Story:** As a разработчик, I want иметь техническую спецификацию Screen Evidence Source Node, so that я мог реализовать захват screen evidence согласно архитектуре SourceNode.

#### Acceptance Criteria

1. THE Documentation_System SHALL create file `docs/rfc/0007-evidence-mode-screen-evidence-source-node.md`
2. THE RFC SHALL define Screen Evidence SourceNode manifest following RFC-0005 format
3. THE RFC SHALL specify required permissions (screen capture)
4. THE RFC SHALL define event types for screen evidence events (chunks, not single frames)
5. THE RFC SHALL specify Evidence Artifact structure (frame/chunk) with TTL
6. THE RFC SHALL define Provider abstraction for AI processing (local/remote)
7. THE RFC SHALL specify Pipeline stages: Capture → Distill → Present → Cleanup
8. THE RFC SHALL include privacy controls: pause/resume, purge, redaction rules
9. THE RFC SHALL specify recommended (non-normative) configurable defaults: fps, chunk_duration, distill_interval
10. THE RFC SHALL specify storage budget integration, GC hooks, and purge vs revocation semantics (reference RFC-0006)
11. THE RFC SHALL specify revocation flow and "delete all evidence from this source_id" behavior
12. THE RFC SHALL be written in Russian to match existing RFC documents

### Requirement 3: User Story для Evidence-Mode

**User Story:** As a пользователь, I want понимать как работает Evidence-Mode, so that я мог принять осознанное решение о его включении.

#### Acceptance Criteria

1. THE Documentation_System SHALL create file `docs/mvp/03_user_story_evidence_mode.md`
2. THE User_Story SHALL clearly state Evidence-Mode is Level 3 opt-in only
3. THE User_Story SHALL describe value proposition (context recovery from screen evidence chunks)
4. THE User_Story SHALL include acceptance criteria with EARS patterns
5. THE User_Story SHALL document privacy controls and trust guarantees
6. THE User_Story SHALL reference dependencies (RFC-0005, RFC-0006, RFC-0007)
7. THE User_Story SHALL distinguish Distraction Mark (classification) from Redaction Rule (privacy)
8. THE User_Story SHALL be written in Russian to match existing user story documents

### Requirement 4: UI/UX спецификация для Evidence-Mode

**User Story:** As a дизайнер, I want иметь UX-спецификацию Evidence-Mode, so that интерфейс был согласован с Manual-first философией.

#### Acceptance Criteria

1. THE Documentation_System SHALL create file `docs/mvp/03_evidence_mode_ui_ux.md`
2. THE UX_Spec SHALL describe Card-based presentation (time range + summary + refs + marks + optional preview)
3. THE UX_Spec SHALL specify controls: enable/disable, pause/resume, purge
4. THE UX_Spec SHALL describe Provider selection UI (local/remote AI) with privacy mode indicators
5. THE UX_Spec SHALL specify Storage Budget management UI
6. THE UX_Spec SHALL describe Distraction Mark as classification label (not exclusion mechanism)
7. THE UX_Spec SHALL describe Redaction Rules UI for privacy exclusions
8. THE UX_Spec SHALL emphasize opt-in nature in all UI flows
9. THE UX_Spec SHALL be written in Russian to match existing UX documents

### Requirement 5: Roadmap для Level 3 Evidence-Mode

**User Story:** As a менеджер проекта, I want иметь roadmap для Evidence-Mode, so that планирование разработки было структурировано.

#### Acceptance Criteria

1. THE Documentation_System SHALL create file `docs/roadmap/0002-level3-evidence-mode-roadmap.md`
2. THE Roadmap SHALL position Evidence-Mode as post-MVP Level 3 feature
3. THE Roadmap SHALL define phases: infrastructure, capture (chunking), processing, UI
4. THE Roadmap SHALL specify dependencies on RFC-0005, RFC-0006, RFC-0007
5. THE Roadmap SHALL include gates for each phase
6. THE Roadmap SHALL be written in Russian to match existing roadmap documents

### Requirement 6: Обновление Project Overview

**User Story:** As a читатель документации, I want видеть Evidence-Mode в общем описании проекта, so that я понимал место этой функции в системе.

#### Acceptance Criteria

1. WHEN updating `docs/00_project_overview.md`, THE Documentation_System SHALL add Capture Profile concept
2. THE Project_Overview SHALL describe Evidence-Mode as Level 3 opt-in feature with chunking model
3. THE Project_Overview SHALL add Provider abstraction to architecture components
4. THE Project_Overview SHALL add Pipeline concept to data processing
5. THE Project_Overview SHALL NOT imply screen recording is default behavior
6. THE Project_Overview SHALL preserve existing Russian language

### Requirement 7: Обновление Index документации

**User Story:** As a читатель документации, I want видеть новые документы в индексе, so that я мог найти информацию о Evidence-Mode.

#### Acceptance Criteria

1. WHEN updating `docs/index.md`, THE Documentation_System SHALL add ADR-0003 to ADR table
2. THE Index SHALL add RFC-0007 to RFC table with Level 3 maturity
3. THE Index SHALL add new user stories to User Stories table
4. THE Index SHALL rename "MVP User Stories" section to "User Stories (MVP + Future)" or add Level column
5. THE Index SHALL add new roadmap to Roadmap table
6. THE Index SHALL preserve existing English language

### Requirement 8: Обновление Glossary

**User Story:** As a читатель документации, I want видеть определения новых терминов, so that я понимал концепции Evidence-Mode.

#### Acceptance Criteria

1. WHEN updating `docs/glossary.md`, THE Documentation_System SHALL add Capture Profile definition
2. THE Glossary SHALL add Evidence-Mode definition with Level 3 marker and chunking model
3. THE Glossary SHALL add Evidence Artifact definition (frame/chunk with TTL)
4. THE Glossary SHALL add Timeline Card definition (derived view of Episode, Level 2+)
5. THE Glossary SHALL add Provider definition
6. THE Glossary SHALL add Storage Budget definition
7. THE Glossary SHALL add Purge definition
8. THE Glossary SHALL add Distraction Mark definition (classification, NOT exclusion)
9. THE Glossary SHALL add Redaction Rule definition (privacy exclusion mechanism, Level 0+)
10. THE Glossary SHALL add Sensitivity Level definition (data attribute, NOT user mark)
11. THE Glossary SHALL preserve existing Russian language

### Requirement 9: Обновление ADR README и существующих ADR

**User Story:** As a читатель документации, I want видеть связи между ADR, so that я понимал эволюцию архитектурных решений.

#### Acceptance Criteria

1. WHEN updating `docs/adr/README.md`, THE Documentation_System SHALL add ADR-0003 to index
2. WHEN updating `docs/adr/0001-initial-architecture.md`, THE Documentation_System SHALL add reference to Evidence-Mode as Level 3 extension
3. WHEN updating `docs/adr/0002-mvp-manual-first.md`, THE Documentation_System SHALL add forward reference to ADR-0003
4. THE Updates SHALL preserve existing Russian language in Russian documents

### Requirement 10: Обновление RFC README и существующих RFC

**User Story:** As a разработчик, I want видеть связи между RFC, so that я понимал техническую архитектуру Evidence-Mode.

#### Acceptance Criteria

1. WHEN updating `docs/rfc/README.md`, THE Documentation_System SHALL add RFC-0007 to index
2. WHEN updating `docs/rfc/0002-system-topology-and-component-map.md`, THE Documentation_System SHALL add Screen Evidence SourceNode to component map
3. WHEN updating `docs/rfc/0003-client-app-suite-architecture.md`, THE Documentation_System SHALL add Evidence-Mode UI components
4. WHEN updating `docs/rfc/0004-local-api.md`, THE Documentation_System SHALL add section for future Evidence-Mode API endpoints (draft)
5. WHEN updating `docs/rfc/0004-local-api.md`, THE Documentation_System SHALL add section for future provider listing/selection API (draft)
6. WHEN updating `docs/rfc/0005-event-ingest-source-nodes.md`, THE Documentation_System SHALL add Screen Evidence collector type with chunking
7. WHEN updating `docs/rfc/0006-retention-ttl-distillation.md`, THE Documentation_System SHALL add Evidence Artifact TTL policies
8. WHEN updating `docs/rfc/0006-retention-ttl-distillation.md`, THE Documentation_System SHALL add Storage Budget + GC policy + Purge semantics + audit trail
9. WHEN updating `docs/rfc/0006-retention-ttl-distillation.md`, THE Documentation_System SHALL add Distilled Snapshot concept (derived preserved after upstream deletion)
10. THE Updates SHALL preserve document language (determine language from existing content)

### Requirement 11: Обновление MVP README и существующих User Stories

**User Story:** As a читатель документации, I want видеть Evidence-Mode в контексте MVP, so that я понимал что это post-MVP функция.

#### Acceptance Criteria

1. WHEN updating `docs/mvp/README.md`, THE Documentation_System SHALL add Evidence-Mode user stories with Level 3 marker
2. WHEN updating `docs/mvp/01_user_story_context_capture.md`, THE Documentation_System SHALL add forward reference to Evidence-Mode
3. WHEN updating `docs/mvp/02_manual_inventory_ui_ux.md`, THE Documentation_System SHALL add section about future Evidence-Mode integration
4. THE Updates SHALL clearly state Evidence-Mode is NOT part of MVP
5. THE Updates SHALL preserve existing Russian language

### Requirement 12: Обновление Roadmap README и существующего Roadmap

**User Story:** As a менеджер проекта, I want видеть Evidence-Mode в общем roadmap, so that планирование было согласовано.

#### Acceptance Criteria

1. WHEN updating `docs/roadmap/README.md`, THE Documentation_System SHALL add Level 3 Evidence-Mode roadmap
2. WHEN updating `docs/roadmap/0001-mvp-execution-roadmap.md`, THE Documentation_System SHALL add reference to future Evidence-Mode phase
3. THE Updates SHALL preserve existing Russian language

### Requirement 13: Обновление RFC-0001 (MVP Inventory Design)

**User Story:** As a разработчик, I want видеть явное разграничение MVP и Evidence-Mode в RFC-0001, so that границы MVP были чёткими.

#### Acceptance Criteria

1. WHEN updating `docs/rfc/0001-mvp-inventory-design.md`, THE Documentation_System SHALL add section "Future: Level 3 Evidence-Mode (non-MVP)"
2. THE RFC-0001 SHALL add forward links to ADR-0003 and RFC-0007
3. THE RFC-0001 SHALL explicitly state that manual-first approach is not changed by Evidence-Mode
4. THE Updates SHALL preserve existing Russian language

### Requirement 14: Критические ограничения документации

**User Story:** As a пользователь, I want быть уверен что документация не вводит в заблуждение о приватности, so that я доверял системе.

#### Acceptance Criteria

1. THE Documentation_System SHALL NEVER imply screen recording is default behavior
2. THE Documentation_System SHALL ALWAYS mark Evidence-Mode as Level 3 opt-in
3. THE Documentation_System SHALL ALWAYS include privacy controls in Evidence-Mode documentation
4. THE Documentation_System SHALL distinguish Distraction Mark (classification) from Redaction Rule (privacy)
5. THE Documentation_System SHALL NOT modify MVP manual-first approach
6. THE Documentation_System SHALL preserve document language (Russian stays Russian, English stays English)
7. THE Documentation_System SHALL NOT modify `.qoder/repowiki/**` files
8. THE Documentation_System SHALL use canonical term names (Evidence-Mode with hyphen, not underscore)
