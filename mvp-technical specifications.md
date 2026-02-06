# Техническое задание

## Timeskein MVP v0.1 — Manual‑first Work Inventory (Desktop + Local Agent)

### 0) Цель и критерий успеха

**Цель MVP:** сделать локальное desktop‑приложение, которое позволяет пользователю за 10–60 секунд:

* создать/найти **Work Item** (задача/проект/вопрос),
* “поднять” его (touch),
* сменить состояние,
* записать следующий шаг (note),
* привязать/открыть **ref** (URL/путь к файлу/issue key/кастом),
* управлять приватностью через denylist.

**Критерий успеха (Definition of Done):**

* Пользовательский “golden path” проходит **автоматизированными e2e‑тестами** на real agent и на mock server.
* Контракт Local API покрыт контрактными тестами (DTO + ошибки + версии).
* Собираются релизные артефакты для Windows и macOS (минимум: build + installer/bundle).
* Проект соответствует принципу **manual‑first** (нет фонового мониторинга/collectors/evidence/sync).

---

## 1) Объём работ (Scope)

### 1.1 Входит в MVP

1. **Local Agent (`timeskein-agent`)**

* локальная БД (SQLite) с миграциями,
* доменная логика Work Items/Refs/Settings,
* локальный API (localhost, 127.0.0.1),
* denylist‑политики `block` / `redact_to_domain`,
* управление жизненным циклом (single instance, health/status, port management),
* механизм обновления инвентаря (в MVP: polling + ETag/updated_at).

2. **Desktop UI (`timeskein-desktop`)**

* overlay **палитра** по глобальному хоткею,
* список Work Items, поиск, сортировки,
* клавиатурные действия: create/touch/state/note/pin/refs/open,
* трей/менюбар с быстрыми действиями,
* минимальные настройки (hotkey, denylist, экспорт/backup stub),
* onboarding “что делаем/что не делаем” (manual‑first доверие).

3. **Контракт Local API + Mock server**

* спецификация методов, DTO, error model, versioning,
* mock server для разработки UI и e2e на моках.

4. **Тестирование и CI**

* contract tests (agent),
* UI smoke/regression,
* e2e golden path (mock и real agent),
* cross‑platform CI (Windows + macOS).

5. **Packaging и релизная документация**

* Windows build + installer + data paths,
* macOS build + bundle + (опционально) минимальная база под notarization,
* quickstart + troubleshooting + release notes.

### 1.2 Не входит в MVP (жёсткие non‑goals)

* Level 1: Sync (между девайсами),
* Level 2: Context Capture (SourceNode),
* Level 3: Evidence‑Mode (скрин/аудио и т.п.),
* любые фоновые collectors (активное окно, ввод, вкладки, скриншоты) — **запрещены**.

---

## 2) Термины и сущности

### 2.1 Work Item

Единица “рабочего намерения” пользователя: задача/проект/вопрос.

**Минимальные поля (логическая модель):**

* `id` (UUID/ULID/строка, стабильный),
* `title` (строка, обязательна),
* `type` ∈ {`task`, `project`, `question`} (опционально),
* `state` ∈ {`active`, `waiting`, `blocked`, `done`, `someday`, `unknown`},
* `pinned` (bool),
* `note` (строка/многострочная, опционально),
* `created_at`, `updated_at` (timestamp),
* `last_seen_at` (timestamp, опционально),
* `deleted_at` (timestamp, для soft delete, опционально).

### 2.2 Ref

Привязка контекста к Work Item.

**Поля:**

* `id`,
* `work_item_id`,
* `kind` ∈ {`url`, `file_path`, `issue_key`, `custom`},
* `value` (строка),
* `is_primary` (bool),
* `created_at`.

**Правило uniqueness (для конфликта):**

* один и тот же ref (нормализованный `kind+value`) **не может** одновременно принадлежать двум Work Items, если не выбран “attach anyway” режим (см. конфликт‑UX).

### 2.3 Denylist

Набор правил приватности для refs:

* правило `block` — запретить сохранение/использование ref,
* правило `redact_to_domain` — сохранить в редуцированном виде (например, только домен для URL).

---

## 3) Ключевые пользовательские сценарии (E2E Golden Path)

**Сценарии обязательны как e2e‑тесты (mock и real):**

1. `Create item → Add ref → Open ref → Touch → Change state → Edit note → Pin`
2. `Refs conflict resolution` (ref уже привязан к другому item)
3. `Denylist`: `block` и `redact_to_domain`
4. `Recovery`: перезапуск агента/приложения — данные сохраняются

---

## 4) Архитектура MVP

### 4.1 Компоненты

1. **timeskein-agent**

* отдельный процесс (в dev — отдельный, в prod — отдельный или запускаемый UI как child‑process, но с сохранением границ модулей),
* владеет БД и доменной логикой,
* предоставляет Local API на 127.0.0.1.

2. **timeskein-desktop**

* UI‑клиент,
* **не хранит истину**, не пишет в БД напрямую,
* общается только через Local API.

3. **mock server**

* реализует тот же Local API контракт,
* используется для UI‑разработки и e2e‑harness на моках.

### 4.2 Принципы

* Local‑first и offline‑first: работа полностью локальна.
* Privacy by default: нет сборов данных без явного действия.
* API‑контракт первичен (“contract‑first”).
* Вся функциональность должна быть воспроизводима в автоматизированных тестах.

---

## 5) Требования к Local API (контракт)

> Транспорт и формат выбираются на этапе `tech_stack_lock`, но требования ниже должны соблюдаться независимо от реализации.

### 5.1 Общие требования

* Слушать **только** `127.0.0.1` (loopback).
* Иметь `api_version`/`agent_version` и механизм `version_mismatch`.
* Единый формат ошибок (см. 5.4).
* Должны быть реализованы все методы MVP.

### 5.2 Методы (обязательный минимум)

**Agent/System**

* `agent.ping()`
* `agent.status()` (включая readiness, db ok, api_version, uptime)
* `agent.version()` (agent build/version + api_version)

**Inventory**

* `inventory.list(filter/sort/search/pagination?)`
  Минимум: `search` по `title/note`, сортировка по `pinned` и `last_seen_at`.
* `inventory.get(work_item_id)`

**Work Item**

* `work_item.create(title, type?, state?, note?)`
* `work_item.touch(id)`
* `work_item.set_state(id, state)`
* `work_item.set_note(id, note)`
* `work_item.toggle_pin(id)`
* `work_item.delete(id, mode: soft|hard)`
  MVP: допускается реализовать только soft delete, но контракт должен быть согласован.

**Refs**

* `ref.add(work_item_id, kind, value, is_primary?)`
* `ref.remove(ref_id)`
* `ref.open(ref_id)` (или open by value; но открытие должно быть через агент)
* `ref.check_conflict(kind, value)` → возвращает conflict info (если есть)

**Settings**

* `settings.get() / settings.set(patch)`
* Denylist:

  * `settings.get_denylist()`
  * `settings.add_to_denylist(rule)`
  * `settings.remove_from_denylist(rule_id)`

### 5.3 DTO (минимальные поля)

**WorkItemView**

* `id`, `title`, `type?`, `state`, `pinned`, `note?`, `refs_count`,
* `created_at`, `updated_at`, `last_seen_at?`

**RefView**

* `id` (или `ref_id`), `kind`, `value`, `is_primary`

### 5.4 Модель ошибок (обязательные коды)

Единый error envelope должен содержать:

* `code` (строка),
* `message` (человеко‑читаемо),
* `details` (объект, опционально).

**Обязательные `code`:**

* `validation_error`
* `not_found`
* `conflict` (refs conflict)
* `privacy_blocked` (denylist block)
* `version_mismatch`

### 5.5 Обновления инвентаря (MVP‑решение)

В MVP требуется **обновление UI без перезапуска**.
Разрешённый минимум (рекомендуемый): **polling + ETag** или `updated_at` watermark.

Требование:

* UI должен уметь периодически получать изменения, не создавая заметную нагрузку и не теряя актуальность после действий.

---

## 6) Требования к Agent (timeskein-agent)

### 6.1 Хранилище и миграции (SQLite)

* SQLite DB в корректном data directory ОС (см. раздел 10).
* Миграции схемы (версионирование БД).
* Индексы под:

  * сортировки `pinned`, `last_seen_at`, `state`,
  * поиск по `title`/`note` (можно LIKE; FTS опционально).

### 6.2 Доменная логика

**Work Items**

* `create`: создаёт item, выставляет `created_at/updated_at/last_seen_at`.
* `touch`: обновляет `last_seen_at`, `updated_at`.
* `set_state`, `set_note`, `toggle_pin`: обновляют `updated_at` и (опционально) `last_seen_at` как явное действие.
* `delete`:

  * soft delete: помечает `deleted_at` и исключает из `inventory.list` по умолчанию.

**last_seen_at — жёсткое правило MVP**

* `last_seen_at` обновляется **только** через явные действия в Timeskein:

  * touch,
  * open ref,
  * create,
  * изменения state/note/pin (как действия пользователя).
* Никакой автоматической “подсветки по активности ОС”.

### 6.3 Refs: нормализация и конфликты

* Нормализовать ref значения:

  * URL: нормализованный вид (минимум: trim + lower для схемы/домена; договориться в контракте).
  * file_path: абсолютный путь (если возможно) или сохранение как есть с ясной семантикой.
  * issue_key: trim/upper при необходимости.
* Конфликт: если ref уже привязан к другому item — вернуть `conflict` с `details`:

  * `existing_work_item_id`, `existing_work_item_title`, `ref_kind`, `ref_value`.

### 6.4 Denylist политики

При `ref.add`:

* Если совпадает с denylist и политика `block` → вернуть `privacy_blocked`.
* Если `redact_to_domain` → сохранить редуцированное значение (например `https://example.com/*` или просто `example.com`), и отметить в `details`, что было редактирование.

### 6.5 Open ref

`ref.open` должен:

* инициировать открытие (через OS handler),
* при успехе обновлять `last_seen_at`,
* при ошибке возвращать `validation_error` или специализированную ошибку (допускается как `validation_error` с деталями).

### 6.6 Lifecycle, single instance, port management

* Агент не должен запускаться в двух экземплярах.
* Должен иметь предсказуемый механизм обнаружения endpoint UI‑клиентом:

  * фиксированный порт **или**
  * файл с портом/endpoint в data dir **или**
  * иной механизм, закреплённый в `packaging_strategy`.
* `agent.status()` должен быть доступен для диагностики.

---

## 7) Требования к Desktop UI (timeskein-desktop)

### 7.1 Палитра (overlay) и хоткей

* Глобальный хоткей (настраиваемый минимумом) открывает/закрывает палитру.
* Палитра — всегда поверх, корректный фокус ввода.
* `Esc` закрывает палитру.
* UI должен корректно работать при отсутствии агента:

  * показать понятное состояние “agent offline”,
  * предложить перезапуск/ожидание (без “магии”).

### 7.2 Список, поиск, сортировка

* Показать список Work Items с ключевыми атрибутами: `title`, `state`, `pinned`, `note preview`, `refs_count`, `last_seen_at`.
* Поиск по `title`/`note` (достаточно substring).
* Сортировка по умолчанию:

  * pinned сверху,
  * далее по `last_seen_at` desc,
  * далее по `updated_at` desc.

### 7.3 Клавиатурные действия (обязательный набор)

* `Enter`: Open (primary ref или меню refs)
* `T`: Touch (обновляет last_seen)
* `S` или цифровые шорткаты: Change state
* `N`: Edit note (многострочный редактор)
* `P`: Pin/unpin
* `R`: Refs menu (add/remove/open/primary)

### 7.4 Refs UX (обязательные потоки)

* Add ref:

  * from clipboard (основной),
  * paste input,
  * custom (ручной ввод),
  * file picker (для file_path).
* Conflict UX:

  * показать, к какому item уже привязан ref,
  * дать варианты: `Open existing` / `Attach anyway` / `Cancel`.
  * Если реализуете “Attach anyway”, это должно быть явной, осознанной опцией (и отражено в контракте).

### 7.5 Обработка ошибок (UI envelope)

* Все ошибки API отображаются дружелюбно и предсказуемо:

  * conflict → диалог разрешения,
  * privacy_blocked → объяснение denylist,
  * version_mismatch → предложение обновить/перезапустить,
  * validation/not_found → корректное сообщение без падений.
* Для оптимистичных обновлений обязателен rollback при ошибке.

### 7.6 Tray/menubar

* Иконка в трее/менюбаре.
* Меню: Open Inventory, Quick Add, Settings, Quit.
* Индикация состояния агента (connected/disconnected).

### 7.7 Settings UI

* Hotkey (минимально),
* denylist editor (домены/правила),
* export/backup stub (например, экспорт JSON).

### 7.8 Onboarding

* First run экран:

  * что делает Timeskein (manual‑first inventory),
  * чего не делает (нет фонового наблюдения),
  * быстрый туториал: create, add ref, touch, open.

---

## 8) Тестирование (обязательные гейты)

### 8.1 Agent contract tests

* Проверка соответствия Local API контракту:

  * DTO структура,
  * коды ошибок,
  * versioning,
  * конфликт refs,
  * denylist.

### 8.2 Persistence/edge tests

* Миграции,
* сохранность после restart,
* корректность сортировки,
* last_seen обновляется только явными действиями.

### 8.3 UI smoke/regression

* “keyboard‑only pass” по основным потокам.
* Фокус/ESC/Enter, корректность overlay.

### 8.4 E2E golden path

* На mock server: e2e harness должен гоняться в CI.
* На real agent: e2e сценарии должны подтверждать “реальную склейку”.

---

## 9) CI/CD требования

* CI pipeline:

  * lint + unit tests,
  * contract tests,
  * e2e mock (минимум),
  * сборка на Windows и macOS (минимум).
* Артефакты сборки (если возможно) сохраняются как CI artifacts для smoke.

---

## 10) Packaging и операционные требования

### 10.1 Data paths

Должны быть корректные директории данных по ОС (выбираются в `packaging_strategy`, но обязателен принцип):

* данные пользователя и БД не лежат в директории установки,
* есть возможность полностью удалить данные (manual cleanup).

### 10.2 Windows

* build + installer,
* корректные права и отсутствие “лишних” разрешений,
* hotkey/overlay работает стабильно.

### 10.3 macOS

* app bundle,
* (опционально) минимальный baseline под notarization,
* корректные права и отсутствие фоновых разрешений.

---

## 11) Документация (минимум для MVP)

* Quickstart: установка, запуск, хоткей, основные команды.
* Privacy statement: manual‑first, no collectors/evidence/sync.
* Troubleshooting: agent offline, reset data, logs, где хранится БД.
* Release notes v0.1.

---

## 12) Трассировка требований к плану opskarta

Чтобы было удобно исполнять ИИ‑агентами, каждый большой блок требований бьётся на узлы плана:

* **Scope/DoD/stack/packaging** → `kickoff`, `mvp_scope_freeze`, `tech_stack_lock`, `packaging_strategy`
* **Local API contract + errors + versioning** → `local_api_contract`
* **Mock server** → `mock_server`
* **E2E spec** → `e2e_golden_path_spec`
* **CI baseline + cross‑platform** → `ci_tooling`, `ci_cross_platform`
* **Agent DB/domain/API/lifecycle/denylist/refs/tests** → `agent_*`, `milestone_agent_ready`
* **UI overlay/hotkey/list/actions/errors/refs/tray/settings/onboarding/tests** → `ui_*`, `milestone_ui_ready`
* **Integration + real e2e + packaging + docs + stabilization** → `integrate_ui_agent`, `e2e_tests`, `packaging_*`, `docs_release_notes`, `bugfix_buffer`, `milestone_mvp_ready`

---

## 13) Приёмка (Acceptance Criteria)

MVP считается реализованным, если одновременно выполнено:

1. **Функционально**

* Все сценарии Golden Path выполняются вручную и автоматизированно (mock + real).
* UI реализует полный набор keyboard‑действий.
* denylist работает (block и redact_to_domain).

2. **Технически**

* Agent хранит данные в SQLite, миграции работают.
* Local API соответствует контракту и проходит contract tests.
* Нет фоновых collectors/evidence/sync.

3. **Качество/релиз**

* CI зелёный на Windows и macOS.
* Собраны релизные артефакты: Windows installer, macOS bundle.
* Есть quickstart + troubleshooting + release notes.
