<!-- File: docs/rfc/0001-mvp-inventory-design.md -->

# RFC-0001: Дизайн реализации MVP-фичи “Инвентарь текущей работы”

## Статус

**Draft** (предложение к реализации).

## 1. Проблема

Пользователь параллельно ведёт много задач и контекстов (тикеты, документы, чаты, репозитории). Через несколько часов/дней он теряет “карту текущей работы”:

- что именно у меня сейчас актуально,
- где это лежит (ссылка/файл/тикет),
- в каком состоянии (делаю / жду / заблокировано),
- что следующий шаг.

Цель MVP — дать быстрый, устойчивый и приватный способ восстановить эту карту в любой момент.

## 2. Цели и не-цели

### Цели
1) Дать “инвентарь” актуальных Work Items с состояниями.
2) Позволить быстро создавать/привязывать Work Items к текущему контексту.
3) Обеспечить ручное управление состоянием (как источник истины).
4) Работать полностью локально, оффлайн.
5) Минимизировать сбор чувствительных данных.

### Не-цели (в рамках этого RFC)
- Автоматическое построение Episodes и Threads (это следующий слой).
- Семантический поиск по содержимому страниц/документов.
- Скриншоты/аудио по умолчанию.
- Полноценные интеграции с таск-трекерами.
- Multi-device sync.

## 3. Пользовательский опыт (UX) — минимальный, но жизнеспособный

### 3.1 Команда “Инвентарь”
Открывает список Work Items:
- Title
- State (badge)
- Last seen (например: “12 мин назад”)
- Note (1–2 строки)
- “Open last ref” (кнопка)

Быстрые действия:
- смена state (hotkeys 1–6 или контекстное меню),
- pin/unpin,
- edit note,
- attach current context,
- delete (с подтверждением).

### 3.2 Команда “Сохранить текущий контекст”
В текущем окне/вкладке:
- Timeskein показывает извлечённые refs (например, URL, `ABC-123`, `repo#123`).
- Пользователь выбирает:
  - создать новый Work Item, или
  - привязать к существующему.

MVP принцип: **автоматизация не должна создавать мусор**. Поэтому создание нового элемента должно быть явным действием.

### 3.3 “Pause” и исключения
- “Pause” мгновенно останавливает запись.
- Настройки denylist: приложения и домены.

## 4. Дизайн данных

### 4.1 WorkItem (таблица `work_items`)
Минимальные поля:
- `id` (ULID/UUID)
- `title` (TEXT)
- `type` (TEXT, nullable; `task|project|question` — опционально)
- `state` (TEXT: `active|waiting|blocked|done|someday|unknown`)
- `pinned` (BOOL)
- `created_at` (DATETIME)
- `updated_at` (DATETIME)
- `last_seen_at` (DATETIME, nullable)
- `note` (TEXT, nullable)
- `deleted_at` (DATETIME, nullable) — soft delete для MVP (опционально)

### 4.2 ContextEvent (таблица `context_events`)
Append-only:
- `id`
- `ts`
- `device_id` (опционально в MVP)
- `source` (например: `window_watcher`, `browser_ext`)
- `app_id` (TEXT)
- `window_title` (TEXT, редактируемо/может быть NULL если приватно)
- `url` (TEXT, может быть NULL)
- `url_title` (TEXT, может быть NULL)
- `is_private` (BOOL) — быстрый флаг приватности
- `raw` (JSON, nullable) — для расширения без миграций

### 4.3 Refs (таблица `refs`)
Нормализованные привязки:
- `id`
- `kind` (TEXT: `url|issue_key|repo_issue|file_path|domain|custom`)
- `value` (TEXT) — нормализованное значение
- `confidence` (REAL) — для будущего расширения

### 4.4 Связи
- `work_item_refs(work_item_id, ref_id, created_at)`
- `context_event_refs(context_event_id, ref_id)` — опционально (можно хранить refs прямо в raw JSON на старте)

### 4.5 WorkItemEvent (таблица `work_item_events`)
Append-only:
- `id`
- `ts`
- `work_item_id`
- `kind` (`created|seen|state_changed|note_changed|pinned|unpinned|ref_attached|deleted`)
- `payload` (JSON)

> Примечание: даже если в MVP мы обновляем `work_items` “в лоб”, наличие `work_item_events` оставляет путь к будущему event-sourcing и аудиту изменений.

## 5. Пайплайн обработки контекста

### 5.1 Сбор (Collectors)
MVP достаточно двух источников:
1) watcher активного окна (app_id + window_title),
2) browser extension (active tab URL + title).

События пишутся с дебаунсом (например, не чаще раза в 1–2 секунды при “дёрганье” фокуса).

### 5.2 Извлечение refs (Ref Extractor)
Детерминированные правила (без ML) + нормализация:

- Если `url`:
  - ref `url:<full>`
  - ref `domain:<host>`
  - ref “strong keys” из URL и title (регулярки):
    - `ISSUE_KEY`: `\b[A-Z][A-Z0-9]+-\d+\b`
    - GitHub: `/issues/\d+`, `/pull/\d+` + `owner/repo`
    - (дальше расширяемо)

- Если нет URL:
  - извлекаем “узнаваемое” из window_title (repo/file patterns), но с более низкой уверенностью.

### 5.3 Разрешение (WorkItem Resolver)
Правила сопоставления `ContextEvent` → `WorkItem`:

**Приоритет 1: сильные refs**
- Если event содержит `ISSUE_KEY` или конкретный issue/pull URL,
  и в базе есть WorkItem с таким ref → это он.

**Приоритет 2: явная привязка пользователя**
- Если пользователь ранее “Attach current context” к WorkItem,
  и текущий ref совпал → это он.

**Иначе**
- Не создаём WorkItem автоматически.
- Просто сохраняем событие контекста (для возможной ручной привязки).

### 5.4 Обновление last_seen
Если `ContextEvent` однозначно сопоставился WorkItem:
- обновляем `work_items.last_seen_at = event.ts`
- добавляем `work_item_events(kind=seen)`

## 6. Определение “актуальности” и сортировка

### 6.1 Актуально (MVP правило)
WorkItem попадает в инвентарь, если:
- `state in (active, waiting, blocked)`  
  **или**
- `pinned = true`  
  **или**
- `state != done` и `last_seen_at >= now - recency_window`

`recency_window` по умолчанию: 14 дней (настраиваемо).

### 6.2 Сортировка
1) pinned (true) сверху
2) state order: active → blocked → waiting → unknown → someday → done
3) last_seen_at desc (NULL в конец)

## 7. Политики приватности (MVP)

### 7.1 Denylist
- список приложений (app_id) и доменов (domain), которые не записываются.
- опция “в приватных приложениях записывать только app_id без window_title”.

### 7.2 Pause
- флаг `paused=true` мгновенно прекращает сохранение `context_events` (и резолвинг).

### 7.3 Храним минимум
- без скриншотов и без контента страниц по умолчанию.
- только метаданные (title/url), которые уже часто содержат достаточно информации для refs и навигации.

## 8. Варианты реализации и выбранный путь

### Вариант A: Manual-first ledger (явное создание/привязка)
**Идея:** Work Items появляются только по действию пользователя.  
**Плюсы:** мало мусора, высокое доверие, простота.  
**Минусы:** нужна дисциплина “помечать”.

### Вариант B: Suggestions (предложение на основе сильных refs)
**Идея:** система не создаёт автоматически, но предлагает: “это похоже на ABC-123 / этот PR”.  
**Плюсы:** снижает трение, не создаёт мусор без подтверждения.  
**Минусы:** надо сделать UI предложения.

### Вариант C: Auto-create из частых контекстов
**Идея:** если часто открывается один и тот же домен/заголовок — создать Work Item.  
**Плюсы:** меньше ручной работы.  
**Минусы:** высокий риск мусора и “слипаний”.

**Решение для MVP:** **A + B**, без C.  
То есть: manual-first, плюс подсказки по сильным refs.

## 9. API/интерфейсы (внутренние)

Минимальные команды (в терминах use-cases):
- `capture_context(event)`
- `extract_refs(event) -> refs[]`
- `resolve_work_item(event, refs) -> work_item_id?`
- `list_inventory(now, window) -> WorkItemView[]`
- `create_work_item_from_current_context(title?, refs)`
- `attach_current_context(work_item_id, refs)`
- `set_state(work_item_id, state)`
- `set_note(work_item_id, note)`
- `toggle_pin(work_item_id)`
- `delete_work_item(work_item_id, mode=soft|hard)`

## 10. Миграционный путь к будущим фичам

Этот дизайн оставляет пространство для:
- Episodes: строятся как производное представление из `context_events`.
- Threads: строятся поверх WorkItems и/или Episodes, используя refs и историю seen.
- Семантика: добавление embeddings к WorkItems/Episodes без ломки схемы.
- Коннекторы: добавление новых `source` и новых kinds of refs.
- Sync: репликация таблиц (или журналов) позже; `work_item_events` пригодится для merge/аудита.

## 11. Риски и меры

1) **Мусорные Work Items**
- мера: manual-first создание; подсказки вместо автогенерации.

2) **Слипание разных задач в одну**
- мера: сопоставление только по “сильным” refs; слабые сигналы не мержат автоматически.

3) **Приватность**
- мера: denylist + pause + минимум данных; режим “без заголовков”.

4) **Быстродействие**
- мера: дебаунс событий; индексы по `ts`, `last_seen_at`, `state`.

## 12. План реализации (в порядке ценности)

1) Storage schema + миграции.
2) Collector активного окна.
3) Browser extension (URL/title) или OS-канал (если доступно).
4) Ref extractor (минимальный набор regex).
5) Manual UI: create/attach + set_state + note + inventory list.
6) Suggestions по сильным refs.
7) Settings: denylist + pause.
