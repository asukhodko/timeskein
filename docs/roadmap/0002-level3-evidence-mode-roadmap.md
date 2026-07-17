<!-- File: docs/roadmap/0002-level3-evidence-mode-roadmap.md -->

# Roadmap 0002: Level 3 Evidence-Mode (Post-MVP)

## Статус

**Планируется** (post-MVP).

С 2026-07-10 этот документ описывает дальний Full Context слой. Он не является
следующим исполнительным планом. [Roadmap 0005](0005-causal-work-memory-roadmap.md)
раньше проверяет bounded Context Probe с одним источником, видимым контролем и
коротким TTL. Только успешный value/trust gate разблокирует обобщение в
SourceNodes и затем полный Evidence Mode.

## Уровень зрелости

**Level 3** (Opt-in Evidence-Mode)

## Связанные документы

- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md)
- [RFC-0005: Event Ingest + SourceNode](../rfc/0005-event-ingest-source-nodes.md)
- [RFC-0006: Retention/TTL + Distillation](../rfc/0006-retention-ttl-distillation.md)
- [RFC-0007: Screen Evidence Source Node](../rfc/0007-evidence-mode-screen-evidence-source-node.md)
- [User Story: Evidence-Mode](../mvp/03_user_story_evidence_mode.md)
- [UI/UX: Evidence-Mode](../mvp/03_evidence_mode_ui_ux.md)
- [Глоссарий](../glossary.md)
- [Roadmap 0005: Causal Work Memory and Context Fabric](0005-causal-work-memory-roadmap.md)

---

## Цель

Реализовать Evidence-Mode как строго opt-in функцию Level 3, позволяющую пользователю захватывать экранные свидетельства (screen evidence) для обогащения контекста Work Items.

**Ключевой принцип:** Evidence-Mode — это сенсор, а не источник истины. Work Items остаются источником истины пользователя.

---

## Предварительные требования

Перед началом работы над Evidence-Mode должны быть завершены:

- [x] MVP Manual-first (Level 0) — см. [Roadmap 0001](0001-mvp-execution-roadmap.md)
- [ ] Level 2 Context Capture — базовая инфраструктура SourceNode
- [ ] RFC-0005 реализован — Event Ingest + SourceNode + Pairing
- [ ] RFC-0006 реализован — Retention/TTL + Distillation

---

## Фаза 1: Инфраструктура (Infrastructure)

### Цели фазы

Подготовить техническую базу для Evidence-Mode без включения захвата экрана.

### Задачи

1. **Storage Budget система**
   - Реализовать конфигурацию storage budget
   - Реализовать GC (garbage collection) для evidence artifacts
   - Интегрировать с RFC-0006 retention policies

2. **Provider абстракция**
   - Реализовать Provider интерфейс (local/remote)
   - Реализовать LocalProvider (базовый)
   - Подготовить точки расширения для RemoteProvider

3. **Evidence Artifact storage**
   - Реализовать хранение chunks (canonical artifacts)
   - Реализовать индексацию по времени и provenance
   - Реализовать TTL enforcement

4. **Purge и Revocation механизмы**
   - Реализовать Purge (удаление evidence, сохранение Distilled Snapshots)
   - Реализовать Revocation (удаление canonical + ephemeral, пересчёт derived)
   - Реализовать audit trail (tombstone events)

### Гейты фазы 1

- [ ] Storage Budget конфигурируется и применяется
- [ ] GC работает корректно
- [ ] Purge создаёт Distilled Snapshots
- [ ] Revocation пересчитывает derived artifacts
- [ ] Тесты покрывают все сценарии lifecycle

---

## Фаза 2: Захват (Capture)

### Цели фазы

Реализовать Screen Evidence SourceNode с chunking моделью.

### Задачи

1. **Screen Evidence SourceNode**
   - Реализовать SourceNode manifest (RFC-0005 формат)
   - Реализовать permission request flow (screen_capture)
   - Реализовать pairing flow

2. **Chunking Pipeline**
   - Реализовать capture stage (screen capture)
   - Реализовать chunking (объединение frames в chunks)
   - Реализовать chunk storage с TTL

3. **Capture Controls**
   - Реализовать enable/disable Evidence-Mode
   - Реализовать pause/resume capture
   - Реализовать capture status indicators

4. **Platform Adapters**
   - Windows: screen capture adapter
   - macOS: screen capture adapter
   - (Android: отложено до следующей фазы)

### Гейты фазы 2

- [ ] Screen Evidence SourceNode регистрируется через pairing
- [ ] Chunks создаются и хранятся корректно
- [ ] Pause/resume работает без потери данных
- [ ] Capture status отображается в UI
- [ ] Тесты покрывают capture pipeline

---

## Фаза 3: Обработка (Processing)

### Цели фазы

Реализовать Distillation Pipeline для извлечения полезной информации из evidence.

### Задачи

1. **Distillation Pipeline**
   - Реализовать distill stage (извлечение metadata)
   - Реализовать OCR/text extraction (опционально)
   - Реализовать activity detection

2. **Episode Generation**
   - Реализовать группировку chunks в Episodes
   - Реализовать Episode metadata
   - Интегрировать с Work Items

3. **Distilled Snapshots**
   - Реализовать создание Distilled Snapshots при Purge
   - Реализовать хранение snapshots отдельно от evidence
   - Реализовать просмотр snapshots после Purge

4. **Sensitivity Classification**
   - Реализовать Sensitivity Levels (normal/private/high)
   - Реализовать автоматическую классификацию
   - Реализовать TTL guidance по sensitivity

### Гейты фазы 3

- [ ] Distillation извлекает полезную информацию
- [ ] Episodes группируют связанные chunks
- [ ] Distilled Snapshots сохраняются при Purge
- [ ] Sensitivity Levels применяются корректно
- [ ] Тесты покрывают processing pipeline

---

## Фаза 4: Презентация (UI)

### Цели фазы

Реализовать UI для Evidence-Mode согласно [03_evidence_mode_ui_ux.md](../mvp/03_evidence_mode_ui_ux.md).

### Задачи

1. **Timeline Cards**
   - Реализовать Timeline Card компонент
   - Реализовать группировку по Episodes
   - Реализовать навигацию по времени

2. **Evidence Controls**
   - Реализовать Evidence-Mode toggle в Settings
   - Реализовать pause/resume в tray/menubar
   - Реализовать capture status indicator

3. **Provider Management**
   - Реализовать Provider selector UI
   - Реализовать privacy mode indicators
   - Реализовать Provider settings

4. **Privacy Controls**
   - Реализовать Purge UI
   - Реализовать Redaction Rules UI
   - Реализовать Distraction Mark UI

5. **Storage Management**
   - Реализовать Storage Budget UI
   - Реализовать usage indicators
   - Реализовать cleanup controls

### Гейты фазы 4

- [ ] Timeline Cards отображают evidence корректно
- [ ] Evidence controls работают из всех точек входа
- [ ] Provider selection работает
- [ ] Privacy controls (Purge, Redaction) работают
- [ ] Storage Budget отображается и управляется
- [ ] UX соответствует спецификации

---

## Фаза 5: Интеграция и полировка

### Цели фазы

Интегрировать все компоненты и подготовить к релизу.

### Задачи

1. **End-to-end тестирование**
   - Полный цикл: enable → capture → distill → view → purge
   - Тестирование на всех платформах
   - Performance testing

2. **Privacy Audit**
   - Аудит всех точек сбора данных
   - Проверка Redaction Rules
   - Проверка Purge/Revocation

3. **Documentation**
   - User documentation
   - Privacy policy updates
   - Onboarding flow

4. **Platform-specific polish**
   - Windows: permissions, notifications
   - macOS: permissions, notifications
   - (Android: если включён)

### Гейты фазы 5

- [ ] End-to-end тесты проходят на всех платформах
- [ ] Privacy audit завершён
- [ ] Документация готова
- [ ] Onboarding flow работает
- [ ] Ready for release

---

## Риски и митигации

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Privacy concerns от пользователей | Высокая | Высокое | Строгий opt-in, прозрачность, Purge controls |
| Performance impact от capture | Средняя | Среднее | Chunking, adaptive fps, background processing |
| Storage growth | Средняя | Среднее | Storage Budget, aggressive TTL, GC |
| Platform permission issues | Средняя | Высокое | Graceful degradation, clear error messages |

---

## Метрики успеха

1. **Adoption**: % пользователей, включивших Evidence-Mode
2. **Retention**: % пользователей, продолжающих использовать после 7 дней
3. **Trust**: % пользователей, использующих Purge (показатель доверия к контролю)
4. **Performance**: capture не влияет на UX основного приложения

---

## Связь с MVP

Evidence-Mode **не входит в MVP**. MVP фокусируется на Manual-first (Level 0).

Путь развития:
1. **Level 0 (MVP)**: Manual-first Work Inventory
2. **Level 2**: Context Capture (по команде)
3. **Level 3**: Evidence-Mode (opt-in screen evidence) — этот roadmap

---

[Back to Roadmap Index](README.md) | [Back to Documentation Index](../index.md)
