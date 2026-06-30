<!-- File: docs/rfc/0001-mvp-inventory-design.md -->

# RFC-0001: Дизайн реализации MVP-фичи "Инвентарь текущей работы"

## Статус

**Draft** (предложение к реализации).

Текущая реализация 2026-06-30 частично закрывает Part A для browser dev mode и macOS `.app`: UI, mock server, Rust agent, SQLite и Local API работают в recovery-baseline. Полная приёмка MVP, e2e, CI и Windows packaging ещё не закрыты. См. [Current Implementation](../current-implementation.md).

## Уровень зрелости

- **Part A:** Level 0 (Manual-first) — нормативная часть MVP
- **Part B:** Level 2/3 — расширения (не входят в MVP)

## Связанные документы

- [ADR-0001: Начальная архитектура](../adr/0001-initial-architecture.md)
- [ADR-0002: MVP = Manual-first](../adr/0002-mvp-manual-first.md)
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md) (Level 3)
- [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md) (Level 3)
- [User Story: Ручной инвентарь](../mvp/02_user_story_manual_inventory.md)
- [Глоссарий](../glossary.md)

---

# Part A: Level 0 (Manual-first) — Нормативная часть MVP

## A.1. Проблема

Пользователь параллельно ведёт много задач и контекстов (тикеты, документы, чаты, репозитории). Через несколько часов/дней он теряет "карту текущей работы":

- что именно у меня сейчас актуально,
- где это лежит (ссылка/файл/тикет),
- в каком состоянии (делаю / жду / заблокировано),
- что следующий шаг.

Цель MVP — дать быстрый, устойчивый и приватный способ восстановить эту карту в любой момент.

## A.2. Цели и не-цели

### Цели (Level 0)
1) Дать "инвентарь" актуальных Work Items с состояниями.
2) Позволить вручную создавать Work Items и привязывать refs.
3) Обеспечить ручное управление состоянием (как источник истины).
4) Работать полностью локально, оффлайн.
5) Минимизировать сбор данных (только то, что вводит пользователь).

### Не-цели (в рамках Part A)
- Автоматический сбор контекста (collectors, ContextEvent) — см. Part B.
- Автоматическое построение Episodes и Threads.
- Семантический поиск по содержимому страниц/документов.
- Скриншоты/аудио.
- Multi-device sync.

## A.3. Пользовательский опыт (UX) — Level 0

### A.3.1 Команда "Инвентарь"
Открывает список Work Items:
- Title
- State (badge)
- Last seen (например: "12 мин назад")
- Note (1–2 строки)
- Refs (количество или "есть/нет")

Быстрые действия:
- смена state (hotkeys 1–6 или контекстное меню),
- pin/unpin,
- edit note,
- add/open ref,
- touch (явно отметить возврат),
- delete (с подтверждением).

### A.3.2 Создание Work Item (вручную)
- Пользователь вводит title, опционально state, note, refs.
- Refs добавляются вручную (paste/выбор файла).
- Нет авто-извлечения из текущего контекста.

### A.3.3 Приватность в Level 0
- **Нет фонового наблюдения.**
- Refs добавляются только явным действием пользователя.
- Настройка denylist доменов для URL refs.

## A.4. Дизайн данных (Level 0)

### A.4.1 WorkItem (таблица `work_items`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | ULID/UUID |
| `title` | TEXT NOT NULL | Название |
| `type` | TEXT NULL | `task\|project\|question` (опционально) |
| `state` | TEXT NOT NULL | `active\|waiting\|blocked\|done\|someday\|unknown` |
| `pinned` | INTEGER NOT NULL | 0/1 |
| `note` | TEXT NULL | Следующий шаг / блокер |
| `created_at` | DATETIME NOT NULL | |
| `updated_at` | DATETIME NOT NULL | |
| `last_seen_at` | DATETIME NULL | Обновляется по явным действиям пользователя |
| `deleted_at` | DATETIME NULL | Soft delete |

### A.4.2 Refs (таблица `refs`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | ULID/UUID |
| `kind` | TEXT | `url\|file_path\|issue_key\|custom` |
| `value` | TEXT | Нормализованное значение |
| `created_at` | DATETIME | |

### A.4.3 Связи Work Item ↔ Ref

Таблица `work_item_refs`:

| Поле | Тип | Описание |
|------|-----|----------|
| `work_item_id` | TEXT | FK → work_items |
| `ref_id` | TEXT | FK → refs |
| `created_at` | DATETIME | |
| `is_primary` | INTEGER | 0/1 (опционально) |

### A.4.4 WorkItemEvent (таблица `work_item_events`)

Append-only журнал изменений:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | ULID/UUID |
| `ts` | DATETIME | Время события |
| `work_item_id` | TEXT | FK → work_items |
| `kind` | TEXT | `created\|touched\|state_changed\|note_changed\|pinned\|unpinned\|ref_attached\|ref_removed\|opened_ref\|deleted` |
| `payload` | JSON/TEXT | Детали изменения |

## A.5. Нормализация refs

### URL
- Trim пробелов
- Привести схему/хост к нижнему регистру
- Убрать якорь `#...` (опционально)
- (Опционально) убрать tracking параметры (utm_*)

### File path
- Trim
- Нормализовать разделители под текущую OS

### Custom
- Trim
- Запретить пустые строки

## A.6. Определение "актуальности" и сортировка

### Актуально (MVP правило)
WorkItem попадает в инвентарь, если:
- `state in (active, waiting, blocked)`, **или**
- `pinned = true`, **или**
- `state != done` и `last_seen_at >= now - recency_window`

`recency_window` по умолчанию: 14 дней.

### Сортировка
1) pinned (true) сверху
2) state order: active → blocked → waiting → unknown → someday → done
3) last_seen_at desc (NULL в конец)

## A.7. Политики приватности (Level 0)

### Denylist
- Список доменов, которые нельзя добавлять как refs.
- Политика: `block` (отклонить) или `redact_to_domain` (сохранить только домен).

### Нет "Pause"
- В Level 0 нет фонового сбора, поэтому Pause не требуется.

### Храним минимум
- Только то, что пользователь явно ввёл.
- Нет скриншотов, нет контента страниц.

## A.8. API/интерфейсы (внутренние use-cases)

Минимальные команды для Level 0:

```
list_inventory(now, window) -> WorkItemView[]
create_work_item(title, state?, note?, refs[]) -> work_item_id
touch_work_item(work_item_id)
set_state(work_item_id, state)
set_note(work_item_id, note)
toggle_pin(work_item_id)
add_ref(work_item_id, ref_kind, ref_value)
remove_ref(work_item_id, ref_id)
open_ref(work_item_id, ref_id? | last_primary)
delete_work_item(work_item_id, mode=soft|hard)
```

Везде, где есть действие пользователя:
- Обновлять `work_items.updated_at`
- Обновлять `work_items.last_seen_at`
- Писать `work_item_events`

## A.9. Механизм дедупликации refs

При `add_ref`:
1. Найти `refs` по (`kind`, `value`) после нормализации
2. Если нет — создать ref
3. Если ref уже привязан к этому Work Item — no-op
4. Если ref привязан к другому Work Item:
   - Вернуть предупреждение "ref уже использован" + список кандидатов
   - UI решает: открыть существующий / продолжить

## A.10. Schema-first boundary

Контракты между Surface и Agent должны быть строго типизированы:

- **DTO** для всех запросов/ответов
- **Ошибки**: validation_error, conflict, not_found, privacy_blocked
- **Версионирование**: схема имеет версию, совместимость документирована

См. будущий RFC: Local API.

---

# Part B: Level 2/3 — Расширения (не входят в MVP)

## B.1. ContextEvent log (Level 2+)

Append-only журнал событий внешнего контекста:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | |
| `ts` | DATETIME | |
| `device_id` | TEXT | (опционально в начале) |
| `source_id` | TEXT | Идентификатор SourceNode |
| `app_id` | TEXT | Приложение |
| `window_title` | TEXT NULL | Может быть NULL если приватно |
| `url` | TEXT NULL | |
| `url_title` | TEXT NULL | |
| `is_private` | BOOL | Флаг приватности |
| `raw` | JSON NULL | Для расширения |

**Требует:** RFC Event Ingest + SourceNode.

## B.2. Collectors и Connectors (Level 2/3)

### Collectors (Level 3)
- Active window watcher
- Browser extension (always-on)
- AFK/idle detector

**Требуют системных разрешений.**

### Connectors (Level 2)
- "Захватить текущий контекст" по команде
- Интеграции с приложениями

**Требуют разрешений конкретных источников.**

## B.3. Ref Extractor (Level 2+)

Детерминированные правила извлечения refs из контекста:

- Если `url`:
  - ref `url:<full>`
  - ref `domain:<host>`
  - "strong keys" из URL и title:
    - `ISSUE_KEY`: `\b[A-Z][A-Z0-9]+-\d+\b`
    - GitHub: `/issues/\d+`, `/pull/\d+`

- Если нет URL:
  - Извлекаем "узнаваемое" из window_title (repo/file patterns)

## B.4. WorkItem Resolver (Level 2+)

Сопоставление `ContextEvent` → `WorkItem`:

**Приоритет 1: сильные refs**
- Если event содержит `ISSUE_KEY` или конкретный issue/pull URL, и в базе есть WorkItem с таким ref → это он.

**Приоритет 2: явная привязка пользователя**
- Если пользователь ранее привязал ref к WorkItem, и текущий ref совпал → это он.

**Иначе**
- Не создаём WorkItem автоматически.
- Сохраняем событие контекста для возможной ручной привязки.

## B.5. Автоматическое обновление last_seen (Level 2+)

Если `ContextEvent` однозначно сопоставился WorkItem:
- Обновляем `work_items.last_seen_at = event.ts`
- Добавляем `work_item_events(kind=seen)`

**Принцип:** автоматика не переписывает `state` и `note` — это источник истины пользователя.

## B.6. Distill before forget (Level 2+)

Перед удалением/сжатием сырых данных (ContextEvents, артефакты):
1. Обновить Episodes/Threads на основе удаляемых данных
2. Зафиксировать "итоги/выводы" если включено
3. Записать provenance "что было дистиллировано и чем"

**Требует:** RFC Retention/TTL + Distillation.

## B.7. Артефакты с TTL (Level 3)

Слои данных:
- **Canonical** — события/журналы (append-only, долгоживущие)
- **Derived** — эпизоды/нити (пересчитываемые)
- **Ephemeral** — скриншоты, транскрипты (с TTL)

TTL правила по уровням чувствительности.

---

# Приложения

## Риски и меры

1) **Мусорные Work Items**
   - Мера: manual-first создание; подсказки вместо автогенерации.

2) **Слипание разных задач в одну**
   - Мера: сопоставление только по "сильным" refs; слабые сигналы не мержат автоматически.

3) **Приватность**
   - Мера: denylist + (в Level 2+) pause + минимум данных; режим "без заголовков".

4) **Быстродействие**
   - Мера: (в Level 2+) дебаунс событий; индексы по `ts`, `last_seen_at`, `state`.

## План реализации Level 0

1) Storage schema + миграции
2) Manual UI: create/touch/set_state/note/inventory list
3) Refs engine: add/remove/open/normalize/dedup
4) Settings: denylist доменов
5) WorkItemEvents logging

## Миграционный путь к Level 2/3

При добавлении collectors/connectors:
- Добавляется `context_events` таблица
- Появляется Ref Extractor и Resolver
- Появляется автоматический `last_seen_at`
- Manual-first механика остаётся базовой

---

# Part C: Level 3 Evidence-Mode (не входит в MVP)

## C.1. Обзор Evidence-Mode

**Evidence-Mode** — строго opt-in функция Level 3 для захвата screen evidence chunks и их дистилляции в Timeline Cards/Episodes.

**Ключевые принципы:**
- **Строго opt-in:** Evidence-Mode никогда не включается по умолчанию
- **Chunking model:** канонический тип артефакта — `chunk` (серия кадров за период времени)
- **Privacy-first:** короткий TTL (72h), pause/resume, purge, redaction rules
- **Manual-first сохраняется:** Evidence-Mode расширяет, но не заменяет ручное управление Work Items

**Важно:** Evidence-Mode не меняет manual-first подход MVP. Work Items остаются источником истины для управления работой. Evidence-Mode — сенсор для восстановления контекста, не трекер дисциплины.

## C.2. Связь с MVP

| Аспект | MVP (Level 0) | Evidence-Mode (Level 3) |
|--------|---------------|-------------------------|
| Создание Work Items | Ручное | Ручное (без изменений) |
| Управление state/note | Ручное | Ручное (без изменений) |
| Refs | Ручное добавление | + Автоматическое извлечение из evidence |
| Контекст | Нет фонового сбора | Screen evidence chunks (opt-in) |
| Timeline | Нет | Timeline Cards из evidence |

## C.3. Техническая спецификация

Детальная техническая спецификация Evidence-Mode описана в:
- [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md) — SourceNode manifest, Pipeline, Privacy Controls
- [RFC-0006: Retention, TTL и Distillation](0006-retention-ttl-distillation.md) — TTL политики, Purge, Revocation
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md) — архитектурное решение

## C.4. Гарантии доверия

Evidence-Mode предоставляет следующие гарантии:

| Гарантия | Описание |
|----------|----------|
| Explicit Opt-in | Захват начинается только после явного включения |
| Pause/Resume | Приостановка захвата без потери настроек |
| TTL | Автоматическое удаление по истечении времени (72h default) |
| Purge | Удаление evidence по команде (derived сохраняются) |
| Revoke | Отзыв источника с удалением всех данных |
