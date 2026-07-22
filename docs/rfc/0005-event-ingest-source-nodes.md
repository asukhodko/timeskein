<!-- File: docs/rfc/0005-event-ingest-source-nodes.md -->

# RFC-0005: Event Ingest + SourceNode + Pairing

## Статус

**Draft**.

Стратегическое уточнение 2026-07-10: полная SourceNode-платформа не является
следующим обязательным слоем. Сначала [Roadmap 0005](../roadmap/0005-causal-work-memory-roadmap.md)
проверяет один focus-scoped источник через bounded Context Probe. Этот RFC
становится контрактом обобщения только после прохождения value/trust gate.

## Уровень зрелости

**Level 2+** (не входит в MVP)

## Связанные документы

- [RFC-0002: Топология системы](0002-system-topology-and-component-map.md)
- [RFC-0003: Архитектура клиентов](0003-client-app-suite-architecture.md)
- [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md) — детальная спецификация Screen Evidence SourceNode (Level 3)
- [ADR-0002: MVP = Manual-first](../adr/0002-mvp-manual-first.md)
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md) — решение о Evidence-Mode как строго opt-in Level 3
- [RFC-0009: Causal Work Memory and Operational Reality](0009-causal-work-memory-and-operational-reality.md)
- [ADR-0005: Недоверенный контекст и независимая память](../adr/0005-untrusted-context-and-consumer-neutral-memory.md)
- [RFC-0010: Артефакты, наблюдения и Context Pack](0010-artifacts-observations-and-context-packs.md)
- [Глоссарий](../glossary.md)

---

## Transport Note

Этот RFC описывает API в REST-стиле (`POST /ingest/events`, `GET /control/sources`), в отличие от [RFC-0004: Local API](0004-local-api.md), который использует RPC-стиль (`inventory.list`, `work_item.create`).

**Почему разные стили:**
- **SourceNode API (этот RFC)** — инфраструктурный интерфейс для внешних источников; REST более естественен для HTTP-интеграций
- **Local API (RFC-0004)** — UX-интерфейс для Surface; RPC удобнее для UI-клиентов

Оба API используют общие DTO-типы из TS-SCHEMA и единые правила версионирования.

---

## 1. Цель

Определить контракт для подключения источников событий (Collectors, Connectors, Extensions) к Device Agent.

**Ключевой принцип:** новый источник не начинает кормить память, пока его явно
не одобрили. Его содержимое остаётся недоверенными данными и входит в общую
модель через Artifact/Observation contract, а не как инструкция или отдельная
система истины.

---

## 2. Модель SourceNode

### 2.1. Типы источников

| Тип | Описание | Уровень |
|-----|----------|---------|
| `collector` | Фоновый сбор (always-on) | Level 3 |
| `connector` | Интеграция с приложением | Level 2 |
| `extension` | Плагин/расширение | Level 2 |

#### Collector: Screen Evidence (Level 3, opt-in)

**Screen Evidence Collector** — специализированный collector для захвата screen evidence chunks. Это строго opt-in функция Level 3.

**Ключевые характеристики:**
- **Chunking model:** канонический тип артефакта — `chunk` (серия кадров за период времени). Frames — derived/temporary для дистилляции, не хранятся как отдельные артефакты.
- **События:** генерирует ContextEvent subtypes с kind `evidence.*` (см. раздел 2.4)
- **Permissions:** требует `screen_capture` system permission
- **Privacy:** pause/resume, purge, redaction rules

> **Детальная спецификация:** см. [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md)

### 2.2. Манифест SourceNode

Каждый источник объявляет манифест при регистрации:

```json
{
  "source_id": "timeskein.collector.active-window",
  "source_type": "collector",
  "version": "1.0.0",
  "name": "Active Window Collector",
  "description": "Отслеживает активное окно и заголовок приложения",
  "vendor": "Timeskein",
  
  "capabilities": ["window_title", "app_id", "window_change_events"],
  
  "permissions": {
    "system": ["accessibility"],
    "data": ["window_title", "app_id"],
    "sensitivity": {
      "window_title": "normal",
      "app_id": "normal"
    }
  },
  
  "event_types": [
    "context_event.window_change",
    "context_event.app_change"
  ],
  
  "config_schema": {
    "debounce_ms": {
      "type": "integer",
      "default": 1000,
      "min": 100,
      "max": 10000
    }
  }
}
```

### 2.3. Обязательные поля манифеста

| Поле | Тип | Описание |
|------|-----|----------|
| `source_id` | string | Уникальный идентификатор (формат: `vendor.type.name`) |
| `source_type` | enum | `collector`, `connector`, `extension` |
| `version` | string | Семантическая версия |
| `name` | string | Человекочитаемое название |
| `description` | string | Описание функциональности |
| `permissions` | object | Требуемые разрешения |
| `event_types` | string[] | Типы генерируемых событий |

### 2.4. Evidence Events (Level 3)

Evidence events — это подтипы ContextEvent с kind `evidence.*`. Используются Screen Evidence Collector для передачи информации о захваченных chunks.

**Типы evidence events:**

| Event Type | Kind | Описание |
|------------|------|----------|
| `context_event.evidence.chunk_captured` | `evidence.chunk_captured` | Chunk захвачен и сохранён |
| `context_event.evidence.chunk_processed` | `evidence.chunk_processed` | Chunk обработан (дистилляция завершена) |
| `context_event.evidence.artifact_purged` | `evidence.artifact_purged` | Артефакт удалён по команде purge (tombstone) |

**Пример evidence event:**

```json
{
  "event_id": "uuid",
  "idempotency_key": "timeskein.collector.screen-evidence:chunk:456",
  "ts": "2025-01-28T10:00:00Z",
  "event_type": "context_event.evidence.chunk_captured",
  "payload": {
    "chunk_id": "chunk-uuid",
    "ts_start": "2025-01-28T09:59:45Z",
    "ts_end": "2025-01-28T10:00:00Z",
    "format": "webp",
    "size_bytes": 524288,
    "sensitivity": "normal"
  },
  "provenance": {
    "source_id": "timeskein.collector.screen-evidence",
    "source_version": "1.0.0",
    "device_id": "device-uuid",
    "collected_at": "2025-01-28T10:00:00Z"
  }
}
```

> **Примечание:** Evidence events доступны только при включённом Evidence-Mode (Level 3, opt-in). Детальная спецификация артефактов, pipeline и privacy controls — см. [RFC-0007](0007-evidence-mode-screen-evidence-source-node.md).

---

## 3. Pairing Flow (сопряжение)

### 3.1. Процесс сопряжения

```
SourceNode                Agent                     User
    |                        |                        |
    |-- pairing_request ---->|                        |
    |   (manifest)           |                        |
    |                        |-- show_approval_ui --->|
    |                        |   (manifest summary)   |
    |                        |                        |
    |                        |<-- approve/reject -----|
    |                        |   (selected perms)     |
    |                        |                        |
    |<-- pairing_result -----|                        |
    |   (token/rejected)     |                        |
```

### 3.2. Запрос на сопряжение

```json
{
  "type": "pairing_request",
  "manifest": { ... },
  "challenge": "random_string"
}
```

### 3.3. Результат сопряжения

**Успех:**
```json
{
  "type": "pairing_result",
  "status": "approved",
  "token": "jwt_or_uuid",
  "approved_permissions": {
    "system": ["accessibility"],
    "data": ["window_title", "app_id"]
  },
  "expires_at": null
}
```

**Отказ:**
```json
{
  "type": "pairing_result",
  "status": "rejected",
  "reason": "user_declined"
}
```

### 3.4. Частичное одобрение

Пользователь может одобрить только часть разрешений:

- Одобрить `app_id`, но не `window_title`
- Одобрить `collector`, но с ограничением приложений

---

## 4. Event Ingest API

### 4.1. Endpoint

```
POST /ingest/events
Authorization: Bearer <pairing_token>
```

### 4.2. Event Envelope

```json
{
  "batch_id": "uuid",
  "events": [
    {
      "event_id": "uuid",
      "idempotency_key": "source_id:local_seq:123",
      "ts": "2025-01-28T10:00:00Z",
      "event_type": "context_event.window_change",
      "payload": {
        "app_id": "com.example.app",
        "window_title": "Document.md - Editor",
        "is_private": false
      },
      "provenance": {
        "source_id": "timeskein.collector.active-window",
        "source_version": "1.0.0",
        "device_id": "device-uuid",
        "collected_at": "2025-01-28T10:00:00Z"
      }
    }
  ]
}
```

### 4.3. Ответ

```json
{
  "batch_id": "uuid",
  "accepted": 10,
  "rejected": 0,
  "rejected_details": []
}
```

### 4.4. Идемпотентность

- `idempotency_key` уникален для каждого события
- Повторная отправка того же события — no-op
- Агент хранит ключи в течение 24 часов

---

## 5. Provenance (провенанс)

### 5.1. Структура провенанса

```json
{
  "source_id": "string",
  "source_version": "string",
  "device_id": "string",
  "collected_at": "ISO 8601",
  "ingested_at": "ISO 8601",
  "policies_applied": ["denylist_check", "sensitivity_tag"],
  "original_sensitivity": "normal",
  "effective_sensitivity": "normal"
}
```

### 5.2. Использование провенанса

- **Аудит:** отслеживание происхождения данных
- **Revocation:** удаление всех данных от источника
- **Ретроактивные политики:** применение новых правил к старым данным
- **Диагностика:** понимание, откуда пришли данные

---

## 6. Revocation (отзыв)

### 6.1. Процесс отзыва

1. Пользователь запрашивает отзыв источника
2. Агент показывает информацию:
   - Сколько событий от этого источника
   - Какие Work Items затронуты
3. Пользователь выбирает:
   - Только отключить (данные остаются)
   - Отключить и удалить все данные

### 6.2. API отзыва

```
POST /control/sources/{source_id}/revoke
{
  "delete_data": true,
  "confirm": "DELETE_ALL_DATA_FROM_SOURCE"
}
```

### 6.3. Результат отзыва

```json
{
  "source_id": "timeskein.collector.active-window",
  "status": "revoked",
  "token_invalidated": true,
  "data_deleted": true,
  "events_deleted": 1234,
  "refs_affected": 56
}
```

---

## 7. Source Management API

### 7.1. Список источников

```
GET /control/sources
```

```json
{
  "sources": [
    {
      "source_id": "timeskein.collector.active-window",
      "name": "Active Window Collector",
      "status": "enabled",
      "paired_at": "2025-01-28T09:00:00Z",
      "last_event_at": "2025-01-28T10:00:00Z",
      "events_total": 1234,
      "approved_permissions": { ... }
    }
  ]
}
```

### 7.2. Управление источником

```
POST /control/sources/{source_id}/enable
POST /control/sources/{source_id}/disable
POST /control/sources/{source_id}/revoke
```

### 7.3. Health/Status источника

```
GET /control/sources/{source_id}/health
```

```json
{
  "source_id": "timeskein.collector.active-window",
  "status": "healthy",
  "last_heartbeat": "2025-01-28T10:00:00Z",
  "events_last_hour": 120,
  "errors_last_hour": 0
}
```

---

## 8. Политики и фильтрация

### 8.1. Применение политик на входе

При получении события агент:

1. Проверяет валидность токена
2. Проверяет, что событие соответствует approved_permissions
3. Применяет denylist (app_id, domain)
4. Применяет sensitivity tagging
5. Сохраняет событие с провенансом

### 8.2. Denylist для источников

```json
{
  "source_id": "timeskein.collector.active-window",
  "denylist": {
    "apps": ["com.1password.*", "com.bitwarden.*"],
    "window_title_patterns": ["*password*", "*secret*"]
  }
}
```

---

## 9. Безопасность

### 9.1. Токены

- JWT или UUID, выданный при pairing
- Срок действия: бессрочный или настраиваемый
- Можно отозвать без удаления данных

### 9.2. Изоляция

- Источник видит только свои данные
- Источник не может запрашивать данные других источников
- Источник не может отправлять события от имени другого источника

### 9.3. Rate limiting

- Максимум событий в секунду per source
- Максимум размера batch
- Backoff при превышении лимитов
