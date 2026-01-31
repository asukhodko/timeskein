<!-- File: docs/mvp/03_user_story_evidence_mode.md -->

# User Story: Evidence-Mode (Screen Evidence Capture)

## Статус

**Draft** (post-MVP функция).

## Уровень зрелости

**Level 3** (Full context) — **строго opt-in**

## Связанные документы

- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md)
- [RFC-0007: Screen Evidence Source Node](../rfc/0007-evidence-mode-screen-evidence-source-node.md)
- [RFC-0006: Retention, TTL и Distillation](../rfc/0006-retention-ttl-distillation.md)
- [RFC-0005: Event Ingest + SourceNode](../rfc/0005-event-ingest-source-nodes.md)
- [UI/UX документ](03_evidence_mode_ui_ux.md)
- [Глоссарий](../glossary.md)

---

## Название

Evidence-Mode (Screen Evidence Capture / Режим доказательств)

## Короткое описание

Evidence-Mode — это **строго opt-in** функция Level 3, которая позволяет захватывать screen evidence chunks (серии кадров за период времени) и дистиллировать их в Timeline Cards/Episodes для восстановления контекста "что я делал".

**Ключевые принципы:**
- **Строго opt-in:** Evidence-Mode никогда не включается по умолчанию
- **Chunking model:** канонический тип артефакта — `chunk` (не одиночные скриншоты)
- **Privacy-first:** короткий TTL (72h), pause/resume, purge, redaction rules
- **Manual-first сохраняется:** Evidence-Mode расширяет, но не заменяет ручное управление Work Items

## Контекст и ценность

### Проблема

После прерывания или переключения контекста пользователь часто не может вспомнить:
- Что именно он делал в конкретный момент времени
- Какие страницы/документы/приложения были открыты
- Какой был контекст принятия решения

Manual-first инвентарь (Level 0) решает проблему "что у меня на столе", но не отвечает на вопрос "что я делал в 14:37".

### Ценность Evidence-Mode

Evidence-Mode добавляет возможность восстановления контекста через screen evidence:
- **Timeline Cards** показывают, чем занимался пользователь в каждый период времени
- **Extracted refs** автоматически извлекают URL, файлы, ключи тикетов из экрана
- **Distraction marks** помогают понять паттерны отвлечений (для самоанализа, не для контроля)

### Философия

**Evidence-Mode — сенсор для восстановления контекста, НЕ трекер дисциплины.**

- Work Items остаются источником истины для управления работой
- Timeline Cards — вспомогательная память, не планировщик
- Distraction Mark — классификация для самоанализа, не механизм наказания

## User Story

Как пользователь, который хочет восстанавливать контекст "что я делал",
я хочу иметь возможность включить захват screen evidence с полным контролем над приватностью,
чтобы видеть Timeline Cards с summary и refs за любой период времени.

---

## Основные понятия

### Evidence-Mode

Режим Level 3 (строго opt-in) для захвата screen evidence chunks. Включается явным действием пользователя в настройках.

### Evidence Artifact (Chunk)

Канонический тип артефакта — `chunk` (серия кадров за период времени, например 15 секунд при 1 fps = 15 кадров).

**Важно:** Frames — это derived/temporary данные для дистилляции, не хранятся как отдельные артефакты.

### Timeline Card

Derived view/presentation of Episode — UI-представление эпизода с:
- `time_range` — временной диапазон
- `summary` — краткое описание активности
- `refs` — извлечённые ссылки (URL, файлы, тикеты)
- `marks` — метки (включая distraction mark)
- `evidence_pointers` — опциональные ссылки на артефакты

### Provider

Абстракция AI-провайдера для обработки артефактов:
- **Local:** обработка на устройстве (privacy-first)
- **Remote:** облачный AI-сервис (требует явного согласия)

### Distraction Mark vs Redaction Rule

| Концепция | Назначение | Тип |
|-----------|------------|-----|
| **Distraction Mark** | Классификация off-task активности | Analytics (для самоанализа) |
| **Redaction Rule** | Исключение чувствительных данных | Privacy (защита данных) |

**Важно:** Distraction Mark — это метка для классификации, НЕ механизм исключения данных.

---

## Гарантии доверия (Trust Guarantees)

Evidence-Mode предоставляет следующие гарантии пользователю:

| Гарантия | Описание |
|----------|----------|
| **Explicit Opt-in** | Захват начинается только после явного включения пользователем |
| **Pause/Resume** | Пользователь может приостановить захват в любой момент без потери настроек |
| **TTL** | Все Evidence Artifacts имеют ограниченное время жизни (рекомендуется 72h) |
| **Purge** | Пользователь может удалить все evidence artifacts по команде |
| **Revoke** | Пользователь может отозвать доверие к источнику, удалив все данные |
| **Local-first** | По умолчанию используется local provider (данные не покидают устройство) |

---

## Acceptance Criteria (критерии приёмки)

### 1) Включение Evidence-Mode (Opt-in)

**WHEN** пользователь хочет включить Evidence-Mode,
**THE System** SHALL требовать явного действия в настройках (не включать по умолчанию).

**WHEN** пользователь включает Evidence-Mode,
**THE System** SHALL показать информацию о:
- Какие данные будут захватываться
- Какой TTL применяется
- Какой provider используется
- Как приостановить/отключить

### 2) Статус Evidence-Mode

**WHEN** Evidence-Mode включён,
**THE System** SHALL показывать постоянный индикатор статуса:
- Enabled (активный захват)
- Paused (приостановлен)
- Error (ошибка)

**WHEN** пользователь открывает настройки,
**THE System** SHALL показывать:
- Текущий статус
- Использование Storage Budget
- Количество chunks за сегодня
- Активный provider

### 3) Pause/Resume

**WHEN** пользователь нажимает Pause,
**THE System** SHALL:
- Немедленно остановить захват
- Сохранить все настройки
- Показать индикатор "Paused"

**WHEN** пользователь нажимает Resume,
**THE System** SHALL возобновить захват с теми же настройками.

### 4) Timeline Cards

**WHEN** Evidence-Mode включён и есть обработанные chunks,
**THE System** SHALL показывать Timeline Cards с:
- Временным диапазоном
- Summary (краткое описание)
- Extracted refs (URL, файлы, тикеты)
- Marks (включая distraction mark, если применимо)
- Опциональный preview (если артефакты не purged)

**WHEN** артефакты были purged,
**THE System** SHALL показывать Timeline Card с пометкой "evidence purged" и сохранённым summary/refs.

### 5) Purge

**WHEN** пользователь запрашивает Purge,
**THE System** SHALL:
- Показать диалог подтверждения с объяснением последствий
- Требовать явного подтверждения (например, ввод "CONFIRM_PURGE")

**WHEN** пользователь подтверждает Purge,
**THE System** SHALL:
- Удалить evidence artifacts (chunks)
- Сохранить Timeline Cards как Distilled Snapshots
- Пометить Timeline Cards как "evidence purged"
- Создать tombstone event для аудита
- Показать результат (сколько удалено, сколько места освобождено)

### 6) Redaction Rules

**WHEN** пользователь настраивает Redaction Rules,
**THE System** SHALL позволять:
- Исключать приложения по app_id
- Исключать домены по URL
- Исключать по паттернам заголовков окон

**WHEN** активно Redaction Rule,
**THE System** SHALL:
- Не захватывать данные, соответствующие правилу
- Показывать индикатор "Redaction active" (опционально)

### 7) Provider Selection

**WHEN** пользователь выбирает provider,
**THE System** SHALL показывать:
- Тип provider (local/remote)
- Privacy indicators (data_leaves_device, encryption)
- Capabilities (OCR, summarization, etc.)

**WHEN** пользователь выбирает remote provider,
**THE System** SHALL требовать явного согласия на передачу данных.

### 8) Storage Budget

**WHEN** Storage Budget достигает warning threshold (80%),
**THE System** SHALL уведомить пользователя и предложить purge.

**WHEN** Storage Budget достигает critical threshold (95%),
**THE System** SHALL:
- Приостановить захват
- Уведомить пользователя
- Предложить purge или увеличение бюджета

### 9) Distraction Mark

**WHEN** система классифицирует активность как off-task,
**THE System** SHALL:
- Добавить distraction mark к Timeline Card
- НЕ исключать данные (это классификация, не редакция)
- Показывать mark как информационную метку

**WHEN** пользователь просматривает Timeline,
**THE System** SHALL позволять фильтровать по distraction mark (для самоанализа).

### 10) Revocation

**WHEN** пользователь запрашивает Revocation источника,
**THE System** SHALL:
- Показать диалог с объяснением последствий (удаление всех данных от источника)
- Требовать явного подтверждения

**WHEN** пользователь подтверждает Revocation,
**THE System** SHALL:
- Удалить все canonical events от источника
- Удалить все evidence artifacts от источника
- Пересчитать derived представления без этого источника
- Показать результат

---

## Примеры взаимодействия

### История: "Вспомнить, что делал утром"

1. Пользователь включил Evidence-Mode неделю назад.

2. Сегодня в 15:00 он хочет вспомнить, что делал утром в 10:00:
   - Открывает Timeline
   - Находит Timeline Card за 10:00-10:30
   - Видит: "Работа над RFC-0007, редактирование docs/rfc/0007.md"
   - Видит refs: `docs/rfc/0007.md`, `https://github.com/...`

3. Пользователь кликает на ref и открывает файл.

### История: "Удалить чувствительные данные"

1. Пользователь понимает, что утром работал с конфиденциальным документом.

2. Он открывает настройки Evidence-Mode и выбирает Purge:
   - Выбирает scope: "Time range: 09:00-11:00"
   - Подтверждает: вводит "CONFIRM_PURGE"

3. Система удаляет chunks за этот период, но сохраняет Timeline Cards с summary (без preview).

### История: "Настроить исключение банковских приложений"

1. Пользователь хочет исключить банковское приложение из захвата.

2. Он открывает Redaction Rules и добавляет:
   - Тип: App Denylist
   - App ID: `com.bank.app`
   - Action: Exclude

3. С этого момента система не захватывает экран, когда активно банковское приложение.

---

## Out of Scope (для этой юзерстори)

- Автоматическое создание Work Items из evidence (остаётся manual-first)
- Автоматическое изменение state/note Work Items
- Sharing Timeline Cards с другими пользователями
- Cloud backup evidence artifacts
- Real-time streaming evidence

---

## Зависимости

| Зависимость | Описание |
|-------------|----------|
| [RFC-0005](../rfc/0005-event-ingest-source-nodes.md) | Event Ingest + SourceNode + Pairing |
| [RFC-0006](../rfc/0006-retention-ttl-distillation.md) | Retention, TTL, Distillation, Purge, Revocation |
| [RFC-0007](../rfc/0007-evidence-mode-screen-evidence-source-node.md) | Screen Evidence Source Node |
| [ADR-0003](../adr/0003-evidence-mode-opt-in.md) | Evidence-Mode Opt-in Decision |

---

## Приложение: Сравнение с Manual-first

| Аспект | Manual-first (Level 0) | Evidence-Mode (Level 3) |
|--------|------------------------|-------------------------|
| Создание Work Items | Ручное | Ручное (без изменений) |
| Управление state/note | Ручное | Ручное (без изменений) |
| Refs | Ручное добавление | + Автоматическое извлечение из evidence |
| Контекст | Нет фонового сбора | Screen evidence chunks (opt-in) |
| Timeline | Нет | Timeline Cards из evidence |
| Приватность | Минимальный сбор | TTL, Purge, Redaction Rules |
| Разрешения | Нет системных | screen_capture (opt-in) |
