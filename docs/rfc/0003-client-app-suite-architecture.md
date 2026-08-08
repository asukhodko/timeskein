<!-- File: docs/rfc/0003-client-app-suite-architecture.md -->

# RFC 0003: Концептуальная архитектура клиентских приложений Timeskein

## Статус

**Стратегический draft, частично реализован desktop-срез.**

Browser и macOS Surface используют общий контракт с агентом. Android,
multi-device suite, Hub и внешние источники не реализованы. Документ сохраняет
архитектурные границы тонких клиентов, но не описывает текущий интерфейс
покомандно.

## Уровень зрелости

- Level 0: Manual-first основа
- Level 1+: Sync, connectors, collectors

## Связанные документы

* [RFC-0002: Топология системы](0002-system-topology-and-component-map.md)
* [ADR-0002: MVP = Manual-first](../adr/0002-mvp-manual-first.md)
* [User Story: Ручной инвентарь](../mvp/02_user_story_manual_inventory.md)
* [Глоссарий](../glossary.md)
* [RFC-0005: Event Ingest + SourceNode](0005-event-ingest-source-nodes.md)

---

## 1. Зачем этот документ

Timeskein — это не одно приложение, а набор клиентских компонентов на устройствах пользователя (Windows, macOS, Android), который со временем должен вырасти до системы "личного контекстного журнала" и помощника/секретаря.

Этот RFC фиксирует:

* как концептуально устроены клиентские приложения на всех платформах,
* какие роли и границы мы закладываем с самого начала,
* как мы шарим один код на максимум устройств, не теряя доступ к нативным фичам,
* как выбранный подход сохраняет возможность будущего "always-on" сбора контекста.

---

## 2. Scope

В рамках RFC:

* роли клиентских компонентов (surface/agent/collectors),
* рекомендуемая модель процессов и связей,
* единая стратегия shared-code и нативных адаптеров,
* принципы Local API (UI ↔ Agent) и Event Ingest (Collectors → Agent),
* устройство "клиентского набора" на Windows/macOS/Android.

---

## 3. Non-goals

Этот RFC намеренно не фиксирует:

* конкретный runtime web‑контейнера (Electron/Tauri/иное),
* конкретный язык core/agent (Rust/Go/…),
* точную схему БД,
* дизайн синхронизации и конфликтов (это отдельные RFC),
* конкретный список коллекторов и их системные разрешения (будет отдельный RFC про collectors).

---

## 4. Базовая позиция: "вариант A" и почему он подходит Timeskein

Выбранная стратегия для клиентских приложений:

* UI-поверхности (surfaces) реализуем как единый web‑UI, который упаковывается в разные контейнеры под платформы.
* Нативные системные возможности (трей, хоткей, background service, сбор контекста, разрешения, file picker и т.п.) реализуем отдельным нативным слоем адаптеров/плагинов.

Ключевая оговорка:

* web‑контейнер — это решение про UI/UX и скорость разработки.
* "секретарь/наблюдение/контекст" живёт не в UI, а в отдельном контуре Agent + Collectors.

Именно это гарантирует, что выбор web‑контейнера не "закроет" будущие полноценные фичи.

---

## 5. Принципы архитектуры клиентских приложений

### 5.1. Разделение ролей: Surface vs Agent vs Collectors

* Surface: то, что пользователь видит (палитра, трей, экран в Android приложении).
* Agent: локальный бэкенд на устройстве, единственная точка правды для данных.
* Collectors: источники событий, которые собирают активность и отправляют в Agent.

Ни Surface, ни Collectors не должны напрямую работать с БД, sync и бизнес-правилами — это обязанность Agent.

### 5.2. Core-first / ports & adapters

Внутри Agent:

* домен и use-cases независимы от платформы,
* всё OS-специфичное — отдельные адаптеры.

Это нужно по двум причинам:

* тестируемость и переносимость,
* возможность добавлять новые платформы и новые collectors без переписывания ядра.

### 5.3. Local-first и offline-first

Клиентские приложения обязаны:

* работать без сети,
* хранить данные локально,
* синхронизацию рассматривать как "добавочную функцию", а не условие работоспособности.

### 5.4. Безопасность и приватность как дизайн-ограничение

Системные разрешения (screen capture, accessibility и т.п.) — только если пользователь включил конкретную возможность, и только для конкретного коллектора.
Manual-first режим должен требовать почти ноль разрешений.

### 5.5. Контракты и версионирование

* Всё общение Surface ↔ Agent идёт по версионированному Local API.
* Collectors → Agent — по версионированному Event Ingest API.
* Вся сериализация/DTO живёт в shared контрактной библиотеке.

---

## 6. Концептуальная модель клиентского набора

### 6.1. Логическая схема

```
Surfaces (UI)  ─────── Local API ───────>  Device Agent  <────── Event Ingest ───────  Collectors/Connectors
   |                                                |
   | (optional) user actions                         |  Sync (optional)
   |                                                v
   +---------------------------------------------> Hub Backend
```

Где:

* Device Agent — центр "на устройстве".
* Surfaces — клиенты, которые вызывают use-cases.
* Collectors/Connectors — "поставщики фактов", не владеющие истиной.
* Hub Backend — слой объединения устройств (multi-device).

---

## 7. Как устроены client apps по платформам

### 7.1. Desktop (Windows/macOS): рекомендуемая двухпроцессная модель

Рекомендуемый целевой вариант (не обязательно MVP, но он должен быть "виден" сразу):

* `timeskein-agent` — фоновый процесс/служба (всегда доступен).
* `timeskein-desktop` — UI-хост (web‑контейнер): палитра, трей, (опционально) full UI.

Связь: `timeskein-desktop` общается с `timeskein-agent` через Local API (локальный IPC/RPC).

Почему так:

* agent может жить и собирать контекст, даже если UI закрыт,
* UI можно перезапускать без риска повредить данные,
* проще масштабировать и отлаживать.

#### MVP-допущение (если хочется быстрее)

Допускается стартовать с "монолитного" desktop-приложения, где agent встроен в тот же процесс.
Но границы модулей должны быть такие же, как в двухпроцессной модели:

* UI не лезет в БД,
* UI общается с agent через внутренний API (пусть даже in-process),
* потом это можно "вынести" в отдельный процесс минимальными изменениями.

#### Текущая реализация 2026-06-30

macOS recovery-baseline использует это MVP-допущение:

* `timeskein-desktop` запускает Rust agent как embedded runtime внутри Tauri-процесса;
* UI всё равно не ходит в SQLite напрямую;
* связь UI → agent идёт через Local API на `127.0.0.1:<dynamic-port>/api`;
* URL агента отдаётся frontend через Tauri-команду `get_api_url`;
* browser development mode использует mock server на `127.0.0.1:3456`.

Это не отменяет целевую двухпроцессную модель для production/always-on сценариев.

### 7.2. Android: приложение как контейнер для Surface + embedded Agent

На Android из-за модели жизненного цикла разумнее считать, что:

* APK включает Surface (UI) и embedded Agent (служба/компонент).
* Agent живёт как Android Service (в будущем — часто как foreground service, если включён always-on сбор контекста).
* Collectors (android) чаще всего будут частью того же APK (плагины/модули).

Ключевое:

* Surface и Agent всё равно разделены логически и общаются через тот же контракт (Local API), но технически это может быть in-process.

---

## 8. Единая стратегия shared-code: что общее, что платформенное

### 8.1. Что должно быть общим (shared) на всех устройствах

1. Domain + Use-cases (ядро логики)

* Work Items, refs engine, state transitions, touch semantics, правила сортировки, policy denylist и т.п.

2. DTO/контракты/версионирование

* схемы Local API и Event Ingest
* структуры для sync (когда появится)

3. (По возможности) Sync Engine

* алгоритмика синхронизации и формат событий/патчей лучше держать общей.

4. Тестовый корпус

* unit/contract tests должны быть одинаковыми на всех платформах.

### 8.2. Что неизбежно платформенное

1. Surface host runtime

* "как запустить web‑UI" на платформе (desktop container, android WebView/runtime)

2. OS capabilities adapters

* tray/menubar
* global hotkey
* file picker
* open url/file
* notifications
* background service plumbing
* permission flows

3. Collectors

* доступ к сигналам ОС везде разный; тут нет "одного кода".

---

## 9. Web Surfaces: концепция "один UI, разные хосты"

### 9.1. Web UI как отдельный артефакт

Мы рассматриваем web‑UI как независимый пакет, который:

* умеет работать на desktop и android,
* не содержит прямых вызовов OS API,
* общается наружу только через абстрактный "Bridge API".

Таким образом, web‑UI можно:

* переупаковывать в разные контейнеры,
* тестировать в браузере (в dev-mode, с мок-bridge),
* обновлять независимо (в рамках версионирования).

### 9.2. Bridge API: единая точка контакта web ↔ native

Bridge API — это строго определённый интерфейс, который предоставляет web‑UI:

* `inventory.list()`
* `workItem.create(...)`
* `workItem.touch(id)`
* `workItem.setState(id, state)`
* `workItem.setNote(id, note)`
* `refs.add(id, ref)`
* `refs.open(id, refId?)`
* `settings.get()/set()`
* и т.д.

Важно:

* Bridge API — это не "тонкая обёртка над SQLite".
* Bridge API — это интерфейс вызова use-cases агента.
* Bridge API версионируется и имеет договор о совместимости.

### 9.3. Host implementations

Разные платформы реализуют Bridge API по-разному:

* Desktop host:

  * bridge вызывает Local API агента по IPC/RPC
  * часть функций (например, file picker) может выполняться в host, но в идеале — через agent или через строго ограниченные host функции.

* Android host:

  * bridge вызывает embedded agent напрямую (in-process), либо через локальный канал внутри приложения.

---

## 10. Local API: интерфейс Surface ↔ Agent

### 10.1. Требования к Local API

* строгая типизация (DTO из shared schema),
* стабильное версионирование,
* понятная модель ошибок (validation, conflict, privacy_blocked, not_found),
* возможность "subscribe" на изменения (UI должен обновляться без polling, если возможно).

### 10.2. Транспорт (не фиксируем, но фиксируем свойства)

Транспорт Local API должен:

* работать локально,
* быть безопасным (не слушать наружу),
* быть удобным для desktop и android.

Варианты:

* named pipes / unix domain sockets,
* localhost HTTP (127.0.0.1),
* embedded RPC (in-process на Android).

Решение будет в отдельном RFC про Local API.

---

## 11. Event Ingest: интерфейс Collectors → Agent

Чтобы Timeskein стал "секретарём", collectors/коннекторы должны отправлять события в agent.

### 11.1. Требования к Event Ingest API

Event Ingest API должен:

* принимать события пачками (batch),
* поддерживать провенанс (источник, версия коллектора, device id),
* применять denylist/policies на стороне агента,
* быть идемпотентным по идентификаторам событий.

В manual-first MVP Event Ingest может быть "пустым", но контракт стоит заложить заранее.

### 11.2. Source Identity (идентификация источника)

Каждый источник событий должен иметь уникальную идентичность:

| Поле | Описание |
|------|----------|
| `source_id` | Уникальный идентификатор источника |
| `source_type` | Тип: `collector`, `connector`, `extension` |
| `version` | Версия источника |
| `device_id` | Идентификатор устройства |

### 11.3. Pairing (сопряжение источников)

Новый источник не начинает кормить память без явного одобрения:

1. Источник отправляет запрос на pairing с манифестом
2. Agent показывает пользователю информацию об источнике
3. Пользователь одобряет или отклоняет
4. При одобрении источник получает токен
5. Дальнейшие события принимаются только с валидным токеном

### 11.4. Permissions/Capabilities (разрешения)

Источник объявляет требуемые разрешения в манифесте:

* **System permissions**: accessibility, screen capture, microphone
* **Data capabilities**: window_title, url, content, clipboard
* **Sensitivity levels**: normal, sensitive, private

Пользователь может одобрить все, частично или отклонить.

### 11.5. Event Envelope (конверт события)

| Поле | Описание |
|------|----------|
| `event_id` | Уникальный идентификатор для идемпотентности |
| `idempotency_key` | Ключ для предотвращения дублирования |
| `ts` | Timestamp события |
| `source_id` | Идентификатор источника |
| `device_id` | Идентификатор устройства |
| `event_type` | Тип события |
| `payload` | Данные события |
| `provenance` | Метаданные о происхождении |

### 11.6. Provenance (провенанс)

Каждое событие хранит информацию о происхождении, что позволяет:

* Удалить все данные от конкретного источника при revocation
* Аудитировать происхождение данных
* Применять политики ретроактивно

### 11.7. Revocation (отзыв)

При отзыве доверия к источнику:

1. Токен источника аннулируется
2. Новые события отклоняются
3. Пользователь выбирает: сохранить или удалить данные
4. При удалении — удаляются все данные с provenance этого источника

**Подробности:** см. будущий RFC: Event Ingest + SourceNode + Pairing.

---

## 12. Уровни зрелости клиента (эволюционный план без миграционного ада)

Важно зафиксировать, что клиенты эволюционируют по слоям:

### Уровень 0: Manual-first inventory (Level 0)

* агент + surfaces
* минимум OS capabilities: hotkey, tray, opener, clipboard (по явной команде)
* collectors отсутствуют или выключены
* **Нет фонового наблюдения**

### Уровень 1: Sync (multi-device)

* добавляется hub и sync engine
* пользователь видит один inventory на всех устройствах

### Уровень 2: Semantics-first connectors (Level 2)

* добавляются **connectors** (браузер, IDE, заметки, мессенджеры)
* **Явный захват контекста по команде** ("Capture current context")
* Подсказки по сильным refs
* Connectors требуют **явного одобрения (pairing)**
* Всё ещё без "тотального наблюдения"

### Уровень 3: Full context collection (Level 3)

* добавляются **collectors** per platform (active window, idle)
* Always-on режим **включается пользователем per-collector**
* Каждый collector требует отдельного toggle + permissions
* появляются Episodes/Threads, ответы "что я делал в момент X"
* появляется "передача контекста ИИ‑агентам" как прикладной use-case

Ключ: выбор web surfaces не мешает этому росту, потому что "наблюдение" живёт в Agent/Collectors.

---

## 13. Установка и пользовательская картина мира

### 13.1. Что установлено у пользователя

Desktop:

* Timeskein Desktop (UI host: палитра/трей)
* Timeskein Agent (служба/фон)

Android:

* Timeskein App (UI + embedded Agent)
* (будущее) collectors внутри приложения

### 13.2. Кто "живёт постоянно"

* Agent должен уметь жить постоянно (особенно для контекст-сбора).
* Surface может быть "по вызову" (палитра появляется по хоткею, tray может быть всегда).

---

## 14. Непрерывный сбор контекста: что важно заложить уже сейчас

Чтобы позже не упереться в ограничения, уже сейчас нужно:

* держать Agent отдельным слоем (не в UI),
* заложить ingest контракт (collectors → agent),
* проектировать permissions как "per collector feature toggle",
* предусмотреть, что на Android always-on почти наверняка = foreground service (и это влияет на UX и батарею).

---

## 15. Риски и как их нейтрализуем

### Риск: web‑контейнер "не даст" глубокие системные фичи

Нейтрализация:

* глубокие системные фичи делаются в нативных adapters/collectors, не в web‑UI.

### Риск: разъезд поведения на платформах

Нейтрализация:

* единый bridge API и единый agent use-case слой;
* UI максимально общий, а нюансы — только в адаптерах.

### Риск: невозможность always-on на Android

Нейтрализация:

* проектируем несколько режимов: manual-only, periodic collection, foreground always-on;
* UX явно показывает режим и потребление ресурсов.

### Риск: "слишком чувствительно" (доверие/корп‑политики)

Нейтрализация:

* semantics-first коннекторы как приоритет;
* always-on collectors — опционально, прозрачно, с сильными privacy controls и провенансом.

---

## 16. Открытые вопросы (для следующих RFC)

1. Local API transport и model (request/response + subscriptions)
2. Versioning strategy: как долго поддерживать старые surfaces/agents
3. Packaging strategy desktop: один инсталлятор, два процесса, автозапуск агента
4. Android service model: режимы, foreground notification UX
5. Как безопасно реализовать plugin model для collectors/connectors
6. Политика хранения и TTL для чувствительных данных (когда появятся collectors)

---

## 17. Итог: что мы фиксируем этим RFC

1. Timeskein clients на всех платформах строятся вокруг Device Agent как локального бэкенда.
2. UI-поверхности (surfaces) реализуем web‑first и упаковываем в платформенные хосты.
3. Нативные возможности и "секретарские" функции реализуются через отдельный нативный контур адаптеров и collectors, подключаемых к agent.
4. Это сохраняет единый UI, ускоряет разработку и не блокирует будущее "full context collection".

---

## 18. Evidence-Mode UI Components (Level 3, opt-in)

При включении Evidence-Mode (Level 3) в клиентских приложениях появляются дополнительные UI-компоненты.

### 18.1. Evidence-Mode Settings Panel

Панель настроек Evidence-Mode в Settings UI:

| Компонент | Описание |
|-----------|----------|
| Enable/Disable toggle | Главный переключатель Evidence-Mode (opt-in) |
| Status indicator | Текущий статус: enabled/disabled/paused |
| Provider selector | Выбор AI-провайдера (local/remote) с privacy indicators |
| Storage Budget display | Использование и лимит хранилища |
| TTL configuration | Настройка времени жизни артефактов |
| Capture settings | fps, chunk_duration (advanced) |

### 18.2. Evidence-Mode Status Indicator

Постоянный индикатор в tray/menubar:

| Состояние | Индикатор | Описание |
|-----------|-----------|----------|
| Disabled | Нет иконки | Evidence-Mode выключен |
| Enabled | 🔴 Красная точка | Активный захват |
| Paused | ⏸️ Пауза | Захват приостановлен |
| Error | ⚠️ Предупреждение | Ошибка (нет места, provider недоступен) |

### 18.3. Timeline View (Evidence-Mode)

Расширение Timeline для отображения Evidence-based данных:

| Компонент | Описание |
|-----------|----------|
| Timeline Cards | Карточки эпизодов с evidence_pointers |
| Evidence preview | Опциональный превью артефакта (если не purged) |
| Distraction marks | Визуальная индикация off-task активности |
| Purge controls | Кнопки purge для отдельных карточек или периодов |

### 18.4. Privacy Controls UI

Компоненты для управления приватностью:

| Компонент | Описание |
|-----------|----------|
| Pause/Resume button | Быстрая приостановка захвата |
| Purge dialog | Диалог подтверждения purge с выбором scope |
| Redaction Rules editor | Управление правилами исключения |
| Provider privacy info | Информация о privacy-атрибутах провайдера |

### 18.5. Bridge API Extensions (Evidence-Mode)

Дополнительные методы Bridge API для Evidence-Mode:

```typescript
// Evidence-Mode control
evidence.enable(): void
evidence.disable(): void
evidence.pause(): void
evidence.resume(): void
evidence.status(): EvidenceStatus

// Purge
evidence.purge(scope: PurgeScope, confirm: string): PurgeResult

// Provider
providers.list(): Provider[]
providers.getActive(): Provider
providers.setActive(providerId: string): void

// Storage
storage.status(): StorageStatus
storage.setbudget(budgetMb: number): void
```

**Подробности:** см. [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md).
