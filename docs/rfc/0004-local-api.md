<!-- File: docs/rfc/0004-local-api.md -->

# RFC-0004: Local API (Surface ↔ Agent)

## Статус

**Реализованный развивающийся контракт.**

Граница Surface ↔ Agent работает в browser mock и macOS-приложении. Этот RFC
фиксирует архитектурный стиль; точные методы, DTO и ошибки определяются
`packages/contracts`, Rust API и [Current Implementation](../current-implementation.md).

## Уровень зрелости

**Level 0+** (применяется на всех уровнях)

## Связанные документы

- [RFC-0001: Дизайн MVP](0001-mvp-inventory-design.md)
- [RFC-0002: Топология системы](0002-system-topology-and-component-map.md)
- [RFC-0003: Архитектура клиентов](0003-client-app-suite-architecture.md)
- [Глоссарий](../glossary.md)

---

## 1. Цель

Определить контракт взаимодействия между Surface (UI) и Device Agent.

Local API — единственный способ для Surface:
- Запрашивать данные (инвентарь, состояние)
- Выполнять команды (создание, редактирование Work Items)
- Получать уведомления об изменениях

---

## 2. Принципы

### 2.1. Surface — тонкий клиент

- Surface не хранит "истину"
- Surface не содержит бизнес-логики
- Surface отображает данные и передаёт команды

### 2.2. Только локальное взаимодействие

- Local API работает только на localhost
- Нет прослушивания внешних интерфейсов
- Безопасность на уровне процесса/системы

### 2.3. Версионирование

- Каждый запрос/ответ содержит версию протокола
- Backward compatibility документирована
- Deprecation с предупреждением

---

## 3. Транспорт

### 3.1. Требования к транспорту

| Требование | Обязательно |
|------------|-------------|
| Локальность | Да |
| Безопасность (не слушать наружу) | Да |
| Поддержка request/response | Да |
| Поддержка subscriptions | Желательно |
| Кроссплатформенность | Да |

### 3.2. Варианты транспорта

| Вариант | Windows | macOS | Android | Примечание |
|---------|---------|-------|---------|------------|
| localhost HTTP | + | + | + | Универсален |
| Unix domain sockets | - | + | + | Не Windows-native |
| Named pipes | + | - | - | Windows-only |
| In-process | + | + | + | Для embedded agent |

**Рекомендация:** localhost HTTP (127.0.0.1) как базовый вариант, in-process для Android embedded.

### 3.3. Текущая реализация 2026-06-30

В macOS `.app` agent запускается embedded внутри Tauri-процесса, но Local API остаётся HTTP boundary:

1. agent bind-ится на `127.0.0.1:0`;
2. ОС выбирает свободный порт;
3. agent пишет порт в `~/Library/Application Support/Timeskein/agent.port`;
4. Tauri хранит API URL в managed state;
5. frontend получает URL через команду `get_api_url`;
6. browser development mode вместо этого использует mock server `http://127.0.0.1:3456/api`.

### 3.4. Формат данных

- JSON как основной формат
- DTO определены в TS-SCHEMA
- Все строки в UTF-8

---

## 4. Модель запросов/ответов

### 4.1. Структура запроса

```json
{
  "version": "1.0",
  "request_id": "uuid",
  "method": "inventory.list",
  "params": { ... }
}
```

### 4.2. Структура успешного ответа

```json
{
  "version": "1.0",
  "request_id": "uuid",
  "result": { ... }
}
```

### 4.3. Структура ошибки

```json
{
  "version": "1.0",
  "request_id": "uuid",
  "error": {
    "code": "validation_error",
    "message": "Title is required",
    "details": { ... }
  }
}
```

---

## 5. Модель ошибок

### 5.1. Коды ошибок

| Код | Описание |
|-----|----------|
| `validation_error` | Невалидные входные данные |
| `not_found` | Ресурс не найден |
| `conflict` | Конфликт (например, ref уже привязан) |
| `privacy_blocked` | Заблокировано политикой приватности |
| `internal_error` | Внутренняя ошибка агента |
| `version_mismatch` | Несовместимая версия протокола |

### 5.2. Обработка конфликтов

При конфликте (например, ref уже привязан к другому Work Item):

```json
{
  "error": {
    "code": "conflict",
    "message": "Ref already attached to another Work Item",
    "details": {
      "conflict_type": "ref_already_attached",
      "existing_work_item": {
        "id": "uuid",
        "title": "Existing Item"
      },
      "options": ["attach_anyway", "open_existing", "cancel"]
    }
  }
}
```

---

## 6. API методы (Level 0)

### 6.1. Inventory

```
inventory.list(filter?, sort?) -> WorkItemView[]
inventory.get(work_item_id) -> WorkItemView
```

### 6.2. Work Items

```
work_item.create(title, state?, note?, refs[]) -> work_item_id
work_item.touch(work_item_id)
work_item.set_state(work_item_id, state)
work_item.set_note(work_item_id, note)
work_item.toggle_pin(work_item_id)
work_item.delete(work_item_id, mode: soft|hard)
```

### 6.3. Refs

```
ref.add(work_item_id, kind, value) -> ref_id | conflict
ref.remove(work_item_id, ref_id)
ref.open(work_item_id, ref_id?)
ref.check_conflict(kind, value) -> existing_work_item?
```

### 6.4. Settings

```
settings.get() -> Settings
settings.set(key, value)
settings.get_denylist() -> string[]
settings.add_to_denylist(pattern)
settings.remove_from_denylist(pattern)
```

### 6.5. System

```
agent.status() -> AgentStatus
agent.ping() -> "pong"
agent.version() -> VersionInfo
```

---

## 7. Subscriptions (уведомления)

### 7.1. Модель подписок

Surface может подписаться на изменения:

```
subscribe.inventory() -> subscription_id
unsubscribe(subscription_id)
```

### 7.2. Уведомления

При изменении данных агент отправляет уведомление:

```json
{
  "type": "notification",
  "subscription_id": "uuid",
  "event": "inventory_changed",
  "data": {
    "changed_ids": ["uuid1", "uuid2"]
  }
}
```

### 7.3. Типы уведомлений

| Событие | Описание |
|---------|----------|
| `inventory_changed` | Изменился список Work Items |
| `work_item_updated` | Изменился конкретный Work Item |
| `settings_changed` | Изменились настройки |

---

## 8. Безопасность

### 8.1. Только локально

- Сервер слушает только 127.0.0.1
- Нет привязки к внешним интерфейсам
- Нет TLS (трафик локальный)

### 8.2. Аутентификация

В Level 0 аутентификация не требуется (доверяем локальным процессам).

В Level 2+ возможно добавление токена для идентификации Surface:
- Токен генерируется при первом запуске
- Хранится локально
- Передаётся в заголовке запроса

---

## 9. DTO (основные типы)

### 9.1. WorkItemView

```typescript
interface WorkItemView {
  id: string;
  title: string;
  type?: "task" | "project" | "question";
  state: "active" | "waiting" | "blocked" | "done" | "someday" | "unknown";
  pinned: boolean;
  note?: string;
  refs_count: number;
  created_at: string; // ISO 8601
  updated_at: string;
  last_seen_at?: string;
}
```

### 9.2. RefView

```typescript
interface RefView {
  id: string;
  kind: "url" | "file_path" | "issue_key" | "custom";
  value: string;
  is_primary: boolean;
}
```

### 9.3. AgentStatus

```typescript
interface AgentStatus {
  version: string;
  uptime_seconds: number;
  work_items_count: number;
  storage_path: string;
  paused: boolean; // для Level 2+
}
```

---

## 10. Версионирование

### 10.1. Формат версии

Версия протокола: `MAJOR.MINOR`

- MAJOR: несовместимые изменения
- MINOR: обратно совместимые добавления

### 10.2. Совместимость

| Клиент | Сервер | Результат |
|--------|--------|-----------|
| 1.0 | 1.0 | OK |
| 1.0 | 1.1 | OK (сервер поддерживает 1.0) |
| 1.1 | 1.0 | Warning (новые методы недоступны) |
| 2.0 | 1.x | Error (version_mismatch) |

---

## 11. Тестирование контрактов

### 11.1. Contract tests

- Тесты на соответствие DTO схеме
- Тесты на обработку ошибок
- Тесты на версионирование

### 11.2. Mock server

Для разработки UI без агента предоставляется mock server с фиксированными ответами.

Текущая реализация mock server слушает `http://127.0.0.1:3456/api` и используется только в browser development mode. macOS `.app` использует embedded Rust agent.

---

## 12. Связь с SourceNode API

### 12.1. Два API — две роли

Timeskein имеет два разных API-интерфейса:

| API | RFC | Назначение | Участники |
|-----|-----|------------|-----------|
| **Local API** | Этот документ | UX-взаимодействие | Surface ↔ Agent |
| **SourceNode API** | [RFC-0005](0005-event-ingest-source-nodes.md) | Event ingest | SourceNode ↔ Agent |

### 12.2. Почему разные стили

- **Local API** использует RPC-стиль (методы через dot-notation: `inventory.list`, `work_item.create`), потому что это удобнее для UI-клиентов, работающих как "тонкие клиенты".

- **SourceNode API** использует REST-стиль (`POST /ingest/events`, `GET /control/sources`), потому что это инфраструктурный интерфейс для внешних источников событий, где REST более естественен.

### 12.3. Общие контракты

Несмотря на разный стиль API, оба интерфейса используют:

- **Общие DTO** — типы данных (WorkItem, Ref, Event) определены в TS-SCHEMA
- **Общее версионирование** — те же правила MAJOR.MINOR
- **Единый агент** — оба API реализованы одним TS-AGENT

---

## 13. Evidence-Mode API (Level 3, Draft)

Дополнительные методы Local API для управления Evidence-Mode. Эти методы доступны только при включённом Level 3.

**Статус:** Draft — финальные имена и структура TBD.

### 13.1. Evidence Control

```
evidence.enable() -> void
evidence.disable() -> void
evidence.pause() -> void
evidence.resume() -> void
evidence.status() -> EvidenceStatus
```

### 13.2. Evidence Purge

```
evidence.purge(scope: PurgeScope, confirm: "CONFIRM_PURGE") -> PurgeResult
```

**PurgeScope:**
- `all` — все evidence artifacts
- `time_range` — за указанный период
- `app` — связанные с приложением

### 13.3. Evidence DTO

```typescript
interface EvidenceStatus {
  enabled: boolean;
  paused: boolean;
  provider: Provider;
  storage: StorageStatus;
  last_capture_at?: string;
  chunks_today: number;
}

interface PurgeResult {
  success: boolean;
  artifacts_purged: number;
  bytes_freed: number;
  distilled_snapshots_created: number;
  tombstones_created: number;
}
```

---

## 14. Provider API (Level 2+, Draft)

Методы для управления AI-провайдерами.

**Статус:** Draft — финальные имена и структура TBD.

### 14.1. Provider Methods

```
providers.list() -> Provider[]
providers.get_active() -> Provider
providers.set_active(provider_id: string) -> void
providers.get_status(provider_id: string) -> ProviderStatus
```

### 14.2. Provider DTO

```typescript
interface Provider {
  id: string;
  name: string;
  type: "local" | "remote";
  capabilities: string[];
  privacy: {
    data_leaves_device: boolean;
    encryption: boolean;
    retention_policy?: string;
    consent_required: boolean;
  };
  status: "active" | "inactive" | "error";
}

interface ProviderStatus {
  provider_id: string;
  status: "active" | "inactive" | "error";
  last_used_at?: string;
  error_message?: string;
}
```

---

## 15. Retention API (Level 2+, Draft)

Методы для управления политиками хранения.

**Статус:** Draft — финальные имена и структура TBD.

### 15.1. Retention Methods

```
retention.get() -> RetentionSettings
retention.set(settings: RetentionSettings) -> void
retention.get_storage_status() -> StorageStatus
retention.trigger_gc(target?: string) -> GCResult
```

### 15.2. Retention DTO

```typescript
interface RetentionSettings {
  ttl_policies: {
    context_events: Record<SensitivityLevel, string>;
    artifacts: Record<string, string>;
    evidence_artifacts?: Record<string, string>;
  };
  storage_budget_mb?: number;
  gc_interval_min?: number;
}

interface StorageStatus {
  used_mb: number;
  budget_mb: number;
  usage_pct: number;
  level: "normal" | "warning" | "critical";
  artifacts_count: number;
  oldest_artifact_at?: string;
  newest_artifact_at?: string;
}

type SensitivityLevel = "normal" | "sensitive" | "private" | "high";
```

**Подробности:** см. [RFC-0006: Retention, TTL и Distillation](0006-retention-ttl-distillation.md) и [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md).
