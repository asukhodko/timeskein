<!-- File: docs/adr/0003-evidence-mode-opt-in.md -->

# ADR-0003: Evidence-Mode как строго opt-in функция Level 3

## Статус

**Proposed** (Draft).

## Уровень зрелости

**Level 3** (Full context) — строго opt-in.

## Связанные документы

- [ADR-0001: Начальная архитектура](0001-initial-architecture.md) — базовая архитектура
- [ADR-0002: MVP = Manual-first](0002-mvp-manual-first.md) — фундамент настоящего решения
- [RFC-0007: Screen Evidence Source Node](../rfc/0007-evidence-mode-screen-evidence-source-node.md) — техническая спецификация (будущий)
- [RFC-0006: Retention, TTL и Distillation](../rfc/0006-retention-ttl-distillation.md) — политики хранения
- [RFC-0005: Event Ingest + SourceNode](../rfc/0005-event-ingest-source-nodes.md) — модель источников
- [Глоссарий](../glossary.md) — определения терминов

---

## Контекст

### Предпосылки

[ADR-0002](0002-mvp-manual-first.md) установил Manual-first (Level 0) как философию MVP Timeskein: никакого фонового наблюдения, все действия явные, пользователь контролирует что система знает.

По мере развития системы возникает потребность в расширенном захвате контекста для восстановления "что я делал". Dayflow-class системы (Rewind, Recall) демонстрируют ценность screen evidence для контекстного поиска и восстановления памяти.

### Проблема

Как добавить возможности захвата screen evidence, не нарушая Manual-first философию и не создавая рисков приватности?

Ключевые вопросы:
1. **Приватность**: Screen evidence содержит чувствительные данные (пароли, личная переписка, финансы).
2. **Доверие**: Пользователь должен точно понимать, что система записывает.
3. **Контроль**: Пользователь должен иметь полный контроль над захватом и хранением.
4. **Философия**: Work Items остаются источником истины для управления работой.

### Модель захвата: Chunking vs Continuous Recording

Evidence-Mode использует **chunking model** — захват коротких чанков (серий кадров), а не непрерывную запись экрана:

- **Chunk** — канонический тип Evidence Artifact (например, 15 секунд при 1 fps = 15 кадров)
- **Frames** — derived/temporary данные для дистилляции, не хранятся как отдельные артефакты
- Chunking позволяет применять TTL, purge и privacy controls на уровне чанков

Детали chunking model, параметры (fps, chunk_duration, distill_interval) и pipeline обработки описаны в [RFC-0007](../rfc/0007-evidence-mode-screen-evidence-source-node.md).

---

## Решение

### Evidence-Mode — строго opt-in Level 3

**Evidence-Mode никогда не включается по умолчанию.**

Это означает:

1. **Явное включение** — пользователь должен явно активировать Evidence-Mode через настройки.

2. **Level 3 only** — Evidence-Mode доступен только на Level 3 (Full context), не на Level 0/1/2.

3. **Отдельное разрешение** — включение Evidence-Mode требует отдельного подтверждения, даже если другие collectors уже активны.

4. **Прозрачность** — UI всегда показывает статус Evidence-Mode (включён/выключен/приостановлен).

### Гарантии доверия (Trust Guarantees)

Evidence-Mode предоставляет следующие гарантии пользователю:

| Гарантия | Описание |
|----------|----------|
| **Explicit Opt-in** | Захват начинается только после явного включения пользователем |
| **Pause/Resume** | Пользователь может приостановить захват в любой момент без потери настроек |
| **TTL** | Все Evidence Artifacts имеют ограниченное время жизни (configurable, рекомендуется 72h для privacy-first baseline) |
| **Purge** | Пользователь выбирает очистку сырья с сохранением разрешённой производной памяти или полное забывание с каскадным удалением |
| **Revoke** | Пользователь может отозвать доверие к источнику, удалив все данные с его provenance |

### Purge vs Revocation

Важно различать два механизма удаления:

**Purge (Очистка evidence)**:
- Удаляет evidence artifacts (ephemeral) и связанные индексы/пойнтеры
- В режиме `purge-raw` уже разрешённые Derived Timeline Cards/Episodes могут сохраниться
- В режиме `forget-completely` производные записи удаляются или инвалидируются без новой дистилляции
- Создаёт tombstone event для аудита
- Используется для освобождения места или удаления чувствительных данных

**Revocation (Отзыв источника)**:
- Удаляет canonical events + ephemeral artifacts по provenance
- Derived представления **пересчитываются** без этого источника (или удаляются, если пересчёт невозможен)
- Используется при отзыве доверия к источнику
- Более радикальная операция, чем Purge

Семантика Purge и Revocation детально описана в [RFC-0006](../rfc/0006-retention-ttl-distillation.md).

### Философия: Evidence-Mode как сенсор

**Evidence-Mode — сенсор для восстановления контекста, НЕ трекер дисциплины.**

Ключевые принципы:

1. **Work Items остаются источником истины** — Evidence-Mode помогает восстановить контекст, но не заменяет ручное управление работой.

2. **Derived Cards/Episodes — вспомогательная память** — Timeline Cards и Episodes, построенные из evidence, служат для поиска и восстановления контекста, не для планирования.

3. **Manual-first сохраняется** — даже с включённым Evidence-Mode, пользователь явно управляет состоянием Work Items.

4. **Distraction Mark — классификация, не исключение** — автоматическая пометка off-task активности служит для классификации, а не для исключения данных. Для исключения используются Redaction Rules.

### Privacy Controls

Evidence-Mode включает следующие механизмы приватности:

1. **Redaction Rules** — правила исключения/редакции данных на входе PolicyGate:
   - Исключение приложений (app denylist)
   - Исключение доменов (domain denylist)
   - Паттерны для редакции (regex patterns)

2. **Sensitivity Levels** — атрибуты данных для применения политик retention:
   - `normal` — обычные данные, TTL 90d
   - `private` — приватные данные, TTL 7d
   - `high` — высокочувствительные, TTL 24h

3. **Provider Selection** — выбор AI-провайдера для обработки:
   - Local provider — обработка на устройстве, данные не покидают устройство
   - Remote provider — облачный AI, требует явного согласия на передачу данных

4. **Storage Budget** — лимит хранилища для Evidence Artifacts с автоматическим GC.

---

## Последствия

### Плюсы

- **Приватность по умолчанию** — без явного включения система не записывает screen evidence.
- **Полный контроль пользователя** — pause/resume, purge, revoke в любой момент.
- **Прозрачность** — пользователь всегда знает, что система записывает.
- **Совместимость с Manual-first** — Evidence-Mode расширяет, но не заменяет ручное управление.
- **Chunking model** — позволяет гранулярный контроль над данными (TTL, purge на уровне чанков).

### Компромиссы

- **Требует явного действия** — пользователь должен сам включить Evidence-Mode для получения ценности.
- **Сложность настройки** — больше опций для конфигурации (TTL, providers, redaction rules).
- **Зависимость от Level 3** — Evidence-Mode недоступен на более низких уровнях зрелости.

### Что меняется в системе

1. **Новый SourceNode** — Screen Evidence SourceNode для захвата чанков (RFC-0007).
2. **Расширение Retention** — политики TTL и Purge для Evidence Artifacts (RFC-0006).
3. **UI компоненты** — настройки Evidence-Mode, индикаторы статуса, Timeline Cards.
4. **Provider abstraction** — абстракция AI-провайдера для обработки артефактов.

---

## Рассмотренные альтернативы

### Альтернатива 1: Evidence-Mode как Level 2 feature

Сделать Evidence-Mode доступным на Level 2 (Semantics-first) с явным захватом по команде.

**Отклонено**: Screen evidence требует системных разрешений (screen capture), что соответствует Level 3. Явный захват по команде — это другая функция (screenshot по запросу), не continuous chunking.

### Альтернатива 2: Evidence-Mode включён по умолчанию на Level 3

Если пользователь перешёл на Level 3, Evidence-Mode включается автоматически.

**Отклонено**: Нарушает принцип explicit opt-in. Даже на Level 3 пользователь должен явно включить каждый источник чувствительных данных.

### Альтернатива 3: Continuous recording вместо chunking

Записывать непрерывный видеопоток вместо дискретных чанков.

**Отклонено**: Chunking model даёт лучший контроль над данными (TTL, purge, privacy на уровне чанков), меньше требований к хранилищу, проще обработка.

---

## Open Questions

1. **Точные параметры chunking** — оптимальные значения fps, chunk_duration, distill_interval требуют экспериментальной валидации. Текущие рекомендации (1 fps, 15s chunks, 15min distill) основаны на Dayflow-class системах.

2. **Взаимодействие с Redaction Rules** — как применять redaction rules к уже захваченным чанкам? Текущее решение: redaction применяется на входе (PolicyGate), ретроактивная редакция требует purge + re-capture.

3. **Multi-monitor support** — как обрабатывать несколько мониторов? Варианты: все мониторы как один чанк, отдельные чанки на монитор, выбор пользователя.

---

## Связанные решения (ожидаемые будущие ADR/RFC)

- [RFC-0007: Screen Evidence Source Node](../rfc/0007-evidence-mode-screen-evidence-source-node.md) — техническая спецификация
- [ADR-0005: Недоверенный контекст и независимая память](0005-untrusted-context-and-consumer-neutral-memory.md) — граница доверия и независимость от поставщика
- [RFC-0010: Артефакты, наблюдения и Context Pack](../rfc/0010-artifacts-observations-and-context-packs.md) — общий контракт данных и удаления
- ADR: "Provider selection и privacy modes" — выбор AI-провайдера
- ADR: "Storage Budget и GC policies" — управление хранилищем
- RFC: "Evidence-Mode API" — API для управления Evidence-Mode
