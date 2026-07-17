<!-- File: docs/rfc/0007-evidence-mode-screen-evidence-source-node.md -->

# RFC-0007: Screen Evidence Source Node

## Статус

**Draft**.

Стратегическое уточнение 2026-07-10: Full Evidence Mode остаётся дальним
opt-in слоем. Ранний bounded Context Probe из [Roadmap 0005](../roadmap/0005-causal-work-memory-roadmap.md)
может проверить активное приложение и URL внутри ручного Focus Session, но не
считается реализацией этого RFC и не разрешает always-on screen capture.

## Уровень зрелости

**Level 3** (строго opt-in, не входит в MVP)

## Связанные документы

- [RFC-0005: Event Ingest + SourceNode](0005-event-ingest-source-nodes.md) — формат манифеста SourceNode
- [RFC-0006: Retention, TTL и Distillation](0006-retention-ttl-distillation.md) — политики retention, purge, revocation
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md) — решение о Evidence-Mode как строго opt-in
- [RFC-0009: Causal Work Memory and Operational Reality](0009-causal-work-memory-and-operational-reality.md)
- [Глоссарий](../glossary.md)

---

## 1. Цель

Определить техническую спецификацию Screen Evidence SourceNode — специализированного collector для захвата screen evidence chunks в рамках Evidence-Mode.

**Ключевые принципы:**
- **Строго opt-in:** Evidence-Mode никогда не включается по умолчанию
- **Chunking model:** канонический тип артефакта — `chunk` (серия кадров за период времени)
- **Privacy-first:** короткий TTL, pause/resume, purge, redaction rules
- **Distill before forget:** перед удалением chunks извлекается ценность

---

## 2. SourceNode Manifest

Screen Evidence SourceNode объявляет манифест согласно формату [RFC-0005](0005-event-ingest-source-nodes.md):

```json
{
  "source_id": "timeskein.collector.screen-evidence",
  "source_type": "collector",
  "version": "1.0.0",
  "name": "Screen Evidence Collector",
  "description": "Захват screen evidence chunks для дистилляции в Timeline Cards/Episodes. Строго opt-in Level 3.",
  "vendor": "Timeskein",
  
  "capabilities": [
    "screen_capture",
    "chunking",
    "frame_sampling"
  ],
  
  "permissions": {
    "system": ["screen_capture"],
    "data": ["screen_content", "window_info"],
    "sensitivity": {
      "screen_content": "sensitive",
      "window_info": "sensitive"
    }
  },
  
  "event_types": [
    "context_event.evidence.chunk_captured",
    "context_event.evidence.chunk_processed",
    "context_event.evidence.artifact_purged"
  ],
  
  "config_schema": {
    "fps": {
      "type": "number",
      "default": 1,
      "min": 0.1,
      "max": 5,
      "description": "Кадров в секунду (рекомендуемое начальное значение)"
    },
    "chunk_duration_sec": {
      "type": "number",
      "default": 15,
      "min": 10,
      "max": 300,
      "description": "Длительность chunk в секундах (Dayflow-class: 15s)"
    },
    "distill_interval_sec": {
      "type": "number",
      "default": 900,
      "min": 60,
      "max": 3600,
      "description": "Интервал дистилляции в секундах (Dayflow-class: 15min)"
    },
    "storage_budget_mb": {
      "type": "number",
      "default": 5120,
      "description": "Бюджет хранения в MB (пример: ~5GB)"
    }
  },
  
  "level": 3,
  "opt_in_required": true
}
```

### 2.1. Обязательные поля манифеста

| Поле | Тип | Описание |
|------|-----|----------|
| `source_id` | string | `timeskein.collector.screen-evidence` |
| `source_type` | enum | `collector` |
| `version` | string | Семантическая версия |
| `name` | string | "Screen Evidence Collector" |
| `permissions` | object | Требуемые разрешения (см. раздел 3) |
| `event_types` | string[] | Типы генерируемых событий (см. раздел 4) |
| `level` | number | `3` — уровень зрелости |
| `opt_in_required` | boolean | `true` — требуется явное включение |

### 2.2. Capabilities

| Capability | Описание |
|------------|----------|
| `screen_capture` | Захват содержимого экрана |
| `chunking` | Группировка кадров в chunks |
| `frame_sampling` | Опциональная выборка кадров (не все кадры сохраняются) |

---

## 3. Permissions (Разрешения)

### 3.1. Системные разрешения

| Разрешение | Описание | Обязательное |
|------------|----------|--------------|
| `screen_capture` | Доступ к захвату экрана | **Да** |

**Примечание:** На разных платформах `screen_capture` требует различных системных разрешений:
- **macOS:** Screen Recording permission
- **Windows:** Нет специального разрешения (но требуется согласие пользователя)
- **Linux:** Зависит от display server (X11/Wayland)

### 3.2. Разрешения на данные

| Разрешение | Описание | Sensitivity |
|------------|----------|-------------|
| `screen_content` | Содержимое экрана (пиксели) | `sensitive` |
| `window_info` | Информация об окне (заголовок, app_id) | `sensitive` |

**Примечание:** `window_info` помечен как `sensitive`, поскольку заголовки окон часто содержат приватную информацию (имена файлов, URL, имена контактов).

### 3.3. Sensitivity Levels

Согласно [RFC-0006](0006-retention-ttl-distillation.md), Evidence Artifacts используют уровень `high`:

| Уровень | TTL по умолчанию | Применение |
|---------|------------------|------------|
| `high` | 24 часа | Evidence Chunks |
| `sensitive` | 30 дней | Метаданные окон |

**Рекомендуемый TTL для Evidence Chunks:** 72 часа (privacy-first baseline).

---

## 4. Event Types (Типы событий)

Evidence events — это подтипы ContextEvent с kind `evidence.*`. Определены в [RFC-0005](0005-event-ingest-source-nodes.md).

### 4.1. Типы событий

| Event Type | Kind | Описание |
|------------|------|----------|
| `context_event.evidence.chunk_captured` | `evidence.chunk_captured` | Chunk захвачен и сохранён |
| `context_event.evidence.chunk_processed` | `evidence.chunk_processed` | Chunk обработан (дистилляция завершена) |
| `context_event.evidence.artifact_purged` | `evidence.artifact_purged` | Артефакт удалён по команде purge (tombstone) |

### 4.2. Event: chunk_captured

Генерируется при успешном захвате и сохранении chunk:

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
    "frames_count": 15,
    "sensitivity": "high"
  },
  "provenance": {
    "source_id": "timeskein.collector.screen-evidence",
    "source_version": "1.0.0",
    "device_id": "device-uuid",
    "collected_at": "2025-01-28T10:00:00Z"
  }
}
```

### 4.3. Event: chunk_processed

Генерируется после завершения дистилляции chunk:

```json
{
  "event_id": "uuid",
  "idempotency_key": "timeskein.collector.screen-evidence:processed:456",
  "ts": "2025-01-28T10:15:00Z",
  "event_type": "context_event.evidence.chunk_processed",
  "payload": {
    "chunk_id": "chunk-uuid",
    "provider_id": "local-llm",
    "processing_duration_ms": 2500,
    "extracted_refs_count": 3,
    "episode_id": "episode-uuid"
  },
  "provenance": {
    "source_id": "timeskein.collector.screen-evidence",
    "source_version": "1.0.0",
    "device_id": "device-uuid",
    "collected_at": "2025-01-28T10:15:00Z"
  }
}
```

### 4.4. Event: artifact_purged

Генерируется при удалении артефакта по команде purge (tombstone для аудита):

```json
{
  "event_id": "uuid",
  "idempotency_key": "timeskein.collector.screen-evidence:purged:456",
  "ts": "2025-01-28T12:00:00Z",
  "event_type": "context_event.evidence.artifact_purged",
  "payload": {
    "chunk_id": "chunk-uuid",
    "purge_reason": "user_requested",
    "bytes_freed": 524288,
    "distilled_snapshot_created": true
  },
  "provenance": {
    "source_id": "timeskein.collector.screen-evidence",
    "source_version": "1.0.0",
    "device_id": "device-uuid",
    "collected_at": "2025-01-28T12:00:00Z"
  }
}
```

---

## 5. Retention семантика

Политики retention для Evidence Artifacts определены в [RFC-0006](0006-retention-ttl-distillation.md).

### 5.1. TTL политики

| Параметр | Значение | Обоснование |
|----------|----------|-------------|
| TTL по умолчанию | 72 часа | Privacy-first baseline |
| Минимальный TTL | 1 час | Достаточно для дистилляции |
| Максимальный TTL | 7 дней | Ограничение для приватности |

### 5.2. Storage Budget

Отдельный бюджет хранения для Evidence Artifacts:

| Параметр | Значение по умолчанию |
|----------|----------------------|
| Лимит | 5 GB |
| Порог предупреждения | 80% |
| Критический порог | 95% |

Подробности — см. [RFC-0006, раздел 7.3](0006-retention-ttl-distillation.md#73-storage-budget-для-evidence-mode-level-3).

### 5.3. Purge vs Revocation

| Аспект | Purge | Revocation |
|--------|-------|------------|
| Цель | Освободить место / приватность | Отозвать доверие к источнику |
| Scope | Evidence artifacts только | Canonical + Ephemeral по source_id |
| Derived | Сохраняются как Distilled Snapshots | Пересчитываются без источника |

Подробности — см. [RFC-0006, разделы 11-13](0006-retention-ttl-distillation.md#11-purge-семантика-level-3).

---

## 6. Evidence Artifact Structure

Evidence Artifact — это чувствительный артефакт с TTL, представляющий захваченный screen evidence.

### 6.1. Канонический тип

**Канонический тип артефакта — `chunk`** (серия кадров за период времени).

| Тип | Статус | Описание |
|-----|--------|----------|
| `chunk` | **Canonical** | Серия кадров за период времени, хранится в blob-store |
| `frame` | Derived/Temporary | Отдельный кадр, используется только для дистилляции, не хранится как артефакт |

**Примечание:** Frames — это derived/temporary данные, которые существуют только в процессе дистилляции. После извлечения ценности (текст, refs, keywords) frames удаляются. Только chunks сохраняются как Evidence Artifacts.

### 6.2. Структура EvidenceArtifact

```typescript
interface EvidenceArtifact {
  // Идентификаторы
  id: string;                    // Уникальный ID артефакта
  chunk_id: string;              // ID chunk (может совпадать с id)
  type: "chunk";                 // Канонический тип — всегда "chunk"
  
  // Временные границы
  ts_start: string;              // ISO 8601 — начало периода захвата
  ts_end: string;                // ISO 8601 — конец периода захвата
  
  // Хранение
  storage: {
    path: string;                // Путь в blob-store
    size_bytes: number;          // Размер в байтах
    format: "webp" | "mp4";      // Формат хранения
  };
  
  // Метаданные захвата (только capture-time, без extracted data)
  capture_metadata: {
    app_id?: string;             // ID приложения (если разрешено)
    window_title?: string;       // Заголовок окна (если разрешено)
    frames_count: number;        // Количество кадров в chunk
    display_id?: string;         // ID монитора (для multi-monitor)
  };
  
  // Происхождение
  provenance: {
    source_id: string;           // "timeskein.collector.screen-evidence"
    source_version: string;      // Версия collector
    device_id: string;           // ID устройства
    captured_at: string;         // ISO 8601 — время захвата
    capture_profile_id?: string; // ID профиля захвата (Level 3)
  };
  
  // TTL и Sensitivity
  ttl: {
    expires_at: string;          // ISO 8601 — время истечения
    sensitivity: "normal" | "private" | "high";  // Sensitivity Level
    // Рекомендуемый TTL: 72h для privacy-first baseline
  };
  
  // Tombstone (устанавливается после purge)
  purged_at?: string;            // ISO 8601 — время удаления
  purge_reason?: "user_requested" | "ttl_expired" | "storage_budget" | "revocation";
}
```

### 6.3. Примечания к структуре

1. **Extracted data не хранится в артефакте:** Извлечённые данные (текст, refs, keywords) хранятся в Derived store как DerivedAnnotations (см. раздел 8.2).

2. **Sensitivity Level:** Атрибут данных для применения политик retention/redaction. Уровни:
   - `normal`: обычные данные, TTL 90d
   - `private`: приватные данные, TTL 7d
   - `high`: высокочувствительные, TTL 24h (рекомендуется для Evidence)

3. **Tombstone:** После purge артефакт помечается `purged_at`, но запись сохраняется для аудита. Физические данные (blob) удаляются.

---

## 7. Provider Abstraction

Provider — это абстракция AI-провайдера для обработки Evidence Artifacts на этапе Distill.

### 7.1. Типы провайдеров

| Тип | Описание | Privacy |
|-----|----------|---------|
| `local` | Обработка на устройстве (on-device LLM, OCR) | Данные не покидают устройство |
| `remote` | Облачный AI-сервис (OpenAI, Anthropic, etc.) | Требует явного согласия пользователя |

### 7.2. Структура Provider

```typescript
interface Provider {
  // Идентификация
  id: string;                    // Уникальный ID провайдера
  name: string;                  // Отображаемое имя
  type: "local" | "remote";      // Тип провайдера
  
  // Возможности
  capabilities: ProviderCapability[];
  
  // Атрибуты приватности
  privacy: {
    data_leaves_device: boolean; // true для remote, false для local
    encryption: boolean;         // Шифрование при передаче
    retention_policy?: string;   // Политика хранения у провайдера
    consent_required: boolean;   // Требуется ли явное согласие
  };
  
  // Статус
  status: "active" | "inactive" | "error";
  
  // Конфигурация (опционально)
  config?: {
    endpoint?: string;           // URL для remote провайдеров
    model?: string;              // Модель (для LLM провайдеров)
    timeout_ms?: number;         // Таймаут запроса
  };
}

type ProviderCapability = 
  | "ocr"                        // Извлечение текста из изображений
  | "text_extraction"            // Извлечение структурированного текста
  | "ref_extraction"             // Извлечение ссылок (URL, file paths)
  | "keyword_extraction"         // Извлечение ключевых слов
  | "summarization"              // Генерация summary
  | "classification";            // Классификация (distraction mark)
```

### 7.3. Примеры провайдеров

#### Local Provider (privacy-first)

```json
{
  "id": "local-llm",
  "name": "Local LLM (Ollama)",
  "type": "local",
  "capabilities": ["ocr", "text_extraction", "summarization"],
  "privacy": {
    "data_leaves_device": false,
    "encryption": false,
    "consent_required": false
  },
  "status": "active",
  "config": {
    "model": "llava:7b",
    "timeout_ms": 30000
  }
}
```

#### Remote Provider (requires consent)

```json
{
  "id": "openai-gpt4v",
  "name": "OpenAI GPT-4 Vision",
  "type": "remote",
  "capabilities": ["ocr", "text_extraction", "ref_extraction", "summarization", "classification"],
  "privacy": {
    "data_leaves_device": true,
    "encryption": true,
    "retention_policy": "30 days",
    "consent_required": true
  },
  "status": "active",
  "config": {
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4-vision-preview",
    "timeout_ms": 60000
  }
}
```

### 7.4. Выбор провайдера

1. **По умолчанию:** Используется local provider (если доступен)
2. **Remote provider:** Требует явного согласия пользователя при первом использовании
3. **UI индикация:** Интерфейс должен чётко показывать тип активного провайдера и его privacy-атрибуты

---

## 8. Pipeline Stages

Pipeline — это цепочка обработки данных Evidence-Mode: **Capture → Distill → Present → Cleanup**.

### 8.1. Обзор Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Evidence-Mode Pipeline                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ CAPTURE  │───▶│ DISTILL  │───▶│ PRESENT  │    │ CLEANUP  │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│       │               │               │               │                     │
│       ▼               ▼               ▼               ▼                     │
│  Screen →        Chunk →         Extracted →     TTL expiry →              │
│  Chunk           Provider        Timeline        Distill check →           │
│  creation        Extracted       Cards/          Deletion                  │
│  Storage         data            Episodes                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2. Stage 1: Capture

**Цель:** Захват screen evidence и создание chunks.

**Входные данные:**
- Screen content (пиксели)
- Window info (заголовок, app_id)

**Процесс:**
1. Захват кадров с заданным fps (default: 1 fps)
2. Группировка кадров в chunk (default: 15 секунд)
3. Применение redaction rules (если настроены на этапе захвата)
4. Сохранение chunk в blob-store
5. Создание EvidenceArtifact записи
6. Генерация события `chunk_captured`

**Выходные данные:**
- EvidenceArtifact (chunk в blob-store)
- ContextEvent `evidence.chunk_captured`

**Конфигурация:**

| Параметр | Default | Описание |
|----------|---------|----------|
| `fps` | 1 | Кадров в секунду |
| `chunk_duration_sec` | 15 | Длительность chunk |
| `format` | webp | Формат хранения |

### 8.3. Stage 2: Distill

**Цель:** Извлечение ценности из chunks с помощью Provider.

**Входные данные:**
- EvidenceArtifact (chunk)
- Active Provider

**Процесс:**
1. Загрузка chunk из blob-store
2. Отправка на обработку Provider
3. Извлечение данных:
   - `extracted_text`: OCR текст с экрана
   - `extracted_refs`: URL, file paths, mentions
   - `keywords`: ключевые слова/темы
   - `classification`: distraction mark (опционально)
4. Сохранение DerivedAnnotations
5. Связывание с Episode (создание или обновление)
6. Генерация события `chunk_processed`

**Выходные данные:**
- DerivedAnnotations (в Derived store)
- Обновлённый Episode
- ContextEvent `evidence.chunk_processed`

**Структура DerivedAnnotations:**

```typescript
interface DerivedAnnotations {
  artifact_id: string;           // ID исходного артефакта
  processed_at: string;          // ISO 8601
  provider_id: string;           // ID использованного провайдера
  
  // Извлечённые данные
  extracted_text?: string;       // OCR текст
  extracted_refs: RefView[];     // Ссылки (URL, files, mentions)
  keywords?: string[];           // Ключевые слова
  
  // Классификация (опционально)
  classification?: {
    distraction_mark: boolean;   // Off-task activity
    confidence: number;          // 0.0 - 1.0
    categories?: string[];       // Категории активности
  };
}
```

**Конфигурация:**

| Параметр | Default | Описание |
|----------|---------|----------|
| `distill_interval_sec` | 900 | Интервал дистилляции (15 min) |
| `batch_size` | 10 | Chunks за один batch |

### 8.4. Stage 3: Present

**Цель:** Представление извлечённых данных в UI как Timeline Cards/Episodes.

**Входные данные:**
- DerivedAnnotations
- Episodes

**Процесс:**
1. Агрегация DerivedAnnotations по Episode
2. Формирование TimelineCard (view model)
3. Добавление evidence_pointers (ссылки на артефакты)
4. Кэширование в episode_card_cache

**Выходные данные:**
- TimelineCard (UI view model)

**Структура TimelineCard:**

```typescript
interface TimelineCard {
  episode_id: string;            // Primary key — ссылка на Episode
  
  // Временной диапазон
  time_range: {
    start: string;               // ISO 8601
    end: string;                 // ISO 8601
  };
  
  // Контент
  summary: string;               // Сгенерированное summary
  refs: RefView[];               // Извлечённые ссылки
  marks: Mark[];                 // Метки (включая distraction mark)
  
  // Ссылки на evidence (опционально)
  evidence_pointers?: {
    artifact_ids: string[];      // ID связанных артефактов
    preview_url?: string;        // URL превью (если доступно)
    thumbnail_url?: string;      // URL миниатюры
    evidence_purged?: boolean;   // true если артефакты удалены
    purged_at?: string;          // Время удаления
  };
  
  // Классификация
  classification?: {
    distraction_mark: boolean;   // Off-task activity
    confidence: number;          // 0.0 - 1.0
  };
}
```

**Примечание:** TimelineCard — это **view model**, не новая доменная сущность. Cards = UI представление, Episodes = доменная модель.

### 8.5. Stage 4: Cleanup

**Цель:** Удаление устаревших артефактов с сохранением извлечённой ценности.

**Входные данные:**
- EvidenceArtifact с истёкшим TTL
- Storage budget status

**Процесс:**
1. Проверка TTL (`expires_at < now`)
2. Проверка статуса дистилляции:
   - Если chunk **не дистиллирован** → принудительная дистилляция перед удалением
   - Если chunk **дистиллирован** → переход к удалению
3. Создание Distilled Snapshot (если есть derived данные)
4. Удаление blob из storage
5. Установка tombstone (`purged_at`, `purge_reason`)
6. Генерация события `artifact_purged`
7. Обновление evidence_pointers в TimelineCard (`evidence_purged: true`)

**Выходные данные:**
- Tombstone запись (для аудита)
- Distilled Snapshot (derived данные сохранены)
- ContextEvent `evidence.artifact_purged`

**Триггеры Cleanup:**

| Триггер | Описание |
|---------|----------|
| TTL expiry | Автоматически по расписанию (GC) |
| Storage budget | При превышении порога (95%) |
| User purge | По команде пользователя |
| Revocation | При отзыве источника |

**Принцип "Distill before forget":**
Перед удалением chunk система **обязана** убедиться, что дистилляция выполнена. Если chunk не был обработан, запускается принудительная дистилляция. Это гарантирует, что ценность (текст, refs, keywords) извлечена до удаления сырых данных.

### 8.6. Диаграмма жизненного цикла артефакта

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Evidence Artifact Lifecycle                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Screen]                                                                   │
│      │                                                                      │
│      ▼ Capture                                                              │
│  ┌──────────────┐                                                           │
│  │   CAPTURED   │ ─── chunk in blob-store                                   │
│  │              │     EvidenceArtifact created                              │
│  └──────┬───────┘                                                           │
│         │                                                                   │
│         ▼ Distill                                                           │
│  ┌──────────────┐                                                           │
│  │  PROCESSED   │ ─── DerivedAnnotations created                            │
│  │              │     Episode updated                                       │
│  └──────┬───────┘                                                           │
│         │                                                                   │
│         ├─────────────────────────────────────────┐                         │
│         │                                         │                         │
│         ▼ TTL expiry / Storage budget             ▼ User purge / Revocation │
│  ┌──────────────┐                          ┌──────────────┐                 │
│  │   EXPIRED    │                          │   PURGED     │                 │
│  │              │                          │              │                 │
│  └──────┬───────┘                          └──────┬───────┘                 │
│         │                                         │                         │
│         └─────────────────┬───────────────────────┘                         │
│                           │                                                 │
│                           ▼ Cleanup                                         │
│                    ┌──────────────┐                                         │
│                    │  TOMBSTONE   │ ─── blob deleted                        │
│                    │              │     Distilled Snapshot preserved        │
│                    │              │     audit trail maintained              │
│                    └──────────────┘                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Privacy Controls (Контроль приватности)

Evidence-Mode предоставляет комплексные механизмы контроля приватности, обеспечивающие пользователю полный контроль над захватом и хранением screen evidence.

### 9.1. Pause/Resume (Приостановка/Возобновление)

Механизм временной приостановки захвата без полного отключения Evidence-Mode.

| Аспект | Описание |
|--------|----------|
| **Цель** | Временно остановить захват без потери настроек |
| **Состояние** | `paused: true/false` в EvidenceStatus |
| **Триггеры** | Ручной (UI), автоматический (privacy app detected), API |
| **Поведение** | Capture stage останавливается, остальные stages продолжают работу |

**Сценарии использования:**
- Пользователь открывает приватное приложение (банкинг, медицина)
- Конфиденциальный звонок или встреча
- Временная работа с чувствительными данными

**API:**
```typescript
// Приостановка захвата
"evidence.pause": () => void;

// Возобновление захвата
"evidence.resume": () => void;

// Проверка статуса
"evidence.status": () => EvidenceStatus;  // includes paused: boolean
```

**UI индикация:**
- Чёткий визуальный индикатор состояния pause (например, иконка паузы в системном трее)
- Уведомление при автоматической приостановке
- Напоминание о возобновлении (опционально)

### 9.2. Purge (Очистка)

Удаление evidence artifacts по команде пользователя с сохранением извлечённой ценности.

| Аспект | Описание |
|--------|----------|
| **Цель** | Удалить сырые evidence данные по запросу пользователя |
| **Scope** | Evidence artifacts (chunks) + evidence pointers |
| **НЕ удаляется** | Derived Timeline Cards/Episodes (сохраняются как Distilled Snapshots) |
| **Аудит** | Создаётся tombstone event `evidence.artifact_purged` |

**Семантика Purge:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Purge Operation                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BEFORE PURGE:                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │ Evidence     │────▶│ Derived      │────▶│ Timeline     │                │
│  │ Artifact     │     │ Annotations  │     │ Card         │                │
│  │ (chunk blob) │     │ (text, refs) │     │ (UI view)    │                │
│  └──────────────┘     └──────────────┘     └──────────────┘                │
│                                                                             │
│  AFTER PURGE:                                                               │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │ Tombstone    │     │ Derived      │────▶│ Timeline     │                │
│  │ (metadata    │     │ Annotations  │     │ Card         │                │
│  │  only)       │     │ (preserved)  │     │ (evidence_   │                │
│  └──────────────┘     └──────────────┘     │  purged:true)│                │
│                                            └──────────────┘                │
│                                                                             │
│  ✓ Blob удалён                                                              │
│  ✓ Derived данные сохранены (Distilled Snapshot)                           │
│  ✓ Timeline Card помечен "evidence purged"                                 │
│  ✓ Tombstone создан для аудита                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**API:**
```typescript
// Purge с подтверждением
"evidence.purge": (confirm: "CONFIRM_PURGE") => PurgeResult;

interface PurgeResult {
  success: boolean;
  artifacts_purged: number;
  bytes_freed: number;
  distilled_snapshots_created: number;
  tombstones_created: number;
}
```

**Варианты Purge:**

| Вариант | Описание |
|---------|----------|
| Purge all | Удалить все evidence artifacts |
| Purge by time range | Удалить artifacts за указанный период |
| Purge by app | Удалить artifacts связанные с приложением |

**Важно:** Purge ≠ Revocation. Purge удаляет только ephemeral evidence данные, сохраняя derived ценность. Revocation — это отзыв доверия к источнику (см. раздел 11).

### 9.3. Redaction Rules (Правила редакции)

Механизм исключения/редакции данных на входе PolicyGate. Redaction Rules применяются **до** сохранения данных.

#### 9.3.1. Типы Redaction Rules

| Тип | Описание | Уровень |
|-----|----------|---------|
| **App Denylist** | Исключение приложений по app_id | Level 3 |
| **Domain Denylist** | Исключение доменов (URL) | Level 0+ |
| **Pattern-based** | Исключение по regex-паттернам | Level 3 |
| **Window Title** | Исключение по заголовку окна | Level 3 |

#### 9.3.2. Структура Redaction Rule

```typescript
interface RedactionRule {
  id: string;                    // Уникальный ID правила
  name: string;                  // Отображаемое имя
  type: RedactionRuleType;       // Тип правила
  enabled: boolean;              // Активно ли правило
  
  // Критерии (зависят от типа)
  criteria: {
    // App Denylist
    app_ids?: string[];          // Список app_id для исключения
    
    // Domain Denylist
    domains?: string[];          // Список доменов для исключения
    
    // Pattern-based
    patterns?: {
      field: "window_title" | "url" | "extracted_text";
      regex: string;             // Regex паттерн
    }[];
    
    // Window Title
    title_patterns?: string[];   // Паттерны заголовков окон
  };
  
  // Действие
  action: "exclude" | "redact";  // Исключить полностью или редактировать
  
  // Метаданные
  created_at: string;
  updated_at: string;
  source: "system" | "user";     // Системное или пользовательское правило
}

type RedactionRuleType = 
  | "app_denylist"
  | "domain_denylist"
  | "pattern_based"
  | "window_title";
```

#### 9.3.3. Предустановленные правила (System Rules)

| Правило | Тип | Критерий | Действие |
|---------|-----|----------|----------|
| Banking Apps | app_denylist | Банковские приложения | exclude |
| Password Managers | app_denylist | 1Password, Bitwarden, etc. | exclude |
| Private Browsing | domain_denylist | Incognito/Private mode | exclude |
| Medical Sites | domain_denylist | Медицинские порталы | exclude |
| Credit Card Pattern | pattern_based | `\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}` | redact |
| SSN Pattern | pattern_based | `\d{3}-\d{2}-\d{4}` | redact |

#### 9.3.4. Применение Redaction Rules

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Redaction Rules Application                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Screen Capture]                                                           │
│        │                                                                    │
│        ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │ PolicyGate   │◀─── Redaction Rules                                       │
│  │              │                                                           │
│  │ 1. Check app_id against App Denylist                                     │
│  │ 2. Check URL against Domain Denylist                                     │
│  │ 3. Check window_title against patterns                                   │
│  │ 4. Apply pattern-based redaction                                         │
│  └──────┬───────┘                                                           │
│         │                                                                   │
│         ├─── EXCLUDE ──▶ [Capture skipped, no artifact created]             │
│         │                                                                   │
│         ├─── REDACT ───▶ [Capture with redacted content]                    │
│         │                                                                   │
│         └─── PASS ────▶ [Normal capture]                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.4. Provider Privacy Indicators

UI должен чётко отображать privacy-атрибуты активного Provider.

| Индикатор | Описание | Визуализация |
|-----------|----------|--------------|
| **Local** | Данные не покидают устройство | 🔒 Зелёный индикатор |
| **Remote** | Данные отправляются в облако | ☁️ Жёлтый индикатор |
| **Encryption** | Шифрование при передаче | 🔐 Иконка замка |
| **Consent Required** | Требуется согласие | ⚠️ Предупреждение |

**Требования к UI:**
1. Индикатор типа провайдера всегда виден в Evidence-Mode UI
2. При переключении на remote provider — явное подтверждение
3. Tooltip с деталями privacy policy провайдера
4. История использования провайдеров (для аудита)

---

## 10. Configuration (Конфигурация)

Рекомендуемые (non-normative) значения по умолчанию для Screen Evidence SourceNode. Фактические значения могут варьироваться в зависимости от устройства и предпочтений пользователя.

### 10.1. Capture Configuration

| Параметр | Default | Min | Max | Описание |
|----------|---------|-----|-----|----------|
| `fps` | 1 | 0.1 | 5 | Кадров в секунду (рекомендуемое начальное значение) |
| `chunk_duration_sec` | 15 | 10 | 300 | Длительность chunk в секундах (Dayflow-class: 15s) |
| `format` | webp | - | - | Формат хранения (webp для изображений, mp4 для видео) |
| `quality` | 80 | 50 | 100 | Качество сжатия (%) |
| `max_resolution` | 1920x1080 | - | - | Максимальное разрешение (downscale если больше) |

**Примечание:** Эти значения — рекомендации для Dayflow-class сценария. Пользователь может настроить их в зависимости от:
- Производительности устройства
- Доступного места на диске
- Требуемой детализации

### 10.2. Distill Configuration

| Параметр | Default | Min | Max | Описание |
|----------|---------|-----|-----|----------|
| `distill_interval_sec` | 900 | 60 | 3600 | Интервал дистилляции (Dayflow-class: 15 min) |
| `batch_size` | 10 | 1 | 50 | Количество chunks за один batch |
| `max_concurrent_distill` | 2 | 1 | 4 | Параллельные процессы дистилляции |
| `distill_timeout_sec` | 60 | 10 | 300 | Таймаут на обработку одного chunk |

### 10.3. Retention Configuration

| Параметр | Default | Min | Max | Описание |
|----------|---------|-----|-----|----------|
| `ttl_hours` | 72 | 1 | 168 | TTL для Evidence Artifacts (privacy-first baseline) |
| `storage_budget_mb` | 5120 | 512 | 51200 | Бюджет хранения (~5GB default) |
| `gc_interval_min` | 60 | 15 | 1440 | Интервал запуска GC |
| `warning_threshold_pct` | 80 | 50 | 95 | Порог предупреждения (% от бюджета) |
| `critical_threshold_pct` | 95 | 80 | 99 | Критический порог (% от бюджета) |

### 10.4. Privacy Configuration

| Параметр | Default | Описание |
|----------|---------|----------|
| `auto_pause_apps` | [] | Список app_id для автоматической паузы |
| `redaction_rules_enabled` | true | Включены ли Redaction Rules |
| `system_rules_enabled` | true | Включены ли системные правила |
| `require_consent_for_remote` | true | Требовать согласие для remote providers |

### 10.5. Пример полной конфигурации

```json
{
  "evidence_mode": {
    "enabled": false,
    "capture": {
      "fps": 1,
      "chunk_duration_sec": 15,
      "format": "webp",
      "quality": 80,
      "max_resolution": "1920x1080"
    },
    "distill": {
      "interval_sec": 900,
      "batch_size": 10,
      "max_concurrent": 2,
      "timeout_sec": 60
    },
    "retention": {
      "ttl_hours": 72,
      "storage_budget_mb": 5120,
      "gc_interval_min": 60,
      "warning_threshold_pct": 80,
      "critical_threshold_pct": 95
    },
    "privacy": {
      "auto_pause_apps": ["com.bank.app", "com.1password"],
      "redaction_rules_enabled": true,
      "system_rules_enabled": true,
      "require_consent_for_remote": true
    },
    "provider": {
      "active_id": "local-llm",
      "fallback_id": null
    }
  }
}
```

---

## 11. Storage Budget Integration

Интеграция с системой Storage Budget для управления дисковым пространством Evidence Artifacts.

### 11.1. Storage Budget Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Storage Budget System                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │   Capture    │────▶│   Storage    │────▶│     GC       │                │
│  │   Stage      │     │   Monitor    │     │   Process    │                │
│  └──────────────┘     └──────────────┘     └──────────────┘                │
│         │                    │                    │                         │
│         │                    ▼                    │                         │
│         │            ┌──────────────┐             │                         │
│         │            │   Budget     │             │                         │
│         │            │   Status     │             │                         │
│         │            └──────────────┘             │                         │
│         │                    │                    │                         │
│         │         ┌──────────┼──────────┐        │                         │
│         │         ▼          ▼          ▼        │                         │
│         │    [< 80%]    [80-95%]    [> 95%]      │                         │
│         │    Normal     Warning    Critical      │                         │
│         │         │          │          │        │                         │
│         ▼         ▼          ▼          ▼        ▼                         │
│    [Continue]  [Continue] [Accelerate] [Pause + GC]                        │
│                + Notify      GC                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2. Budget Status Levels

| Уровень | Порог | Действия |
|---------|-------|----------|
| **Normal** | < 80% | Нормальная работа |
| **Warning** | 80-95% | Уведомление пользователя, ускоренный GC |
| **Critical** | > 95% | Приостановка захвата, принудительный GC |

### 11.3. GC Hooks

Garbage Collection hooks для интеграции с Evidence-Mode Pipeline.

#### 11.3.1. GC Triggers

| Триггер | Описание | Приоритет |
|---------|----------|-----------|
| `scheduled` | По расписанию (gc_interval_min) | Low |
| `budget_warning` | При достижении warning threshold | Medium |
| `budget_critical` | При достижении critical threshold | High |
| `manual` | По команде пользователя | Immediate |

#### 11.3.2. GC Process

```typescript
interface GCProcess {
  // Запуск GC
  trigger: GCTrigger;
  started_at: string;
  
  // Параметры
  params: {
    target_free_mb: number;      // Целевой объём освобождения
    max_artifacts: number;       // Максимум артефактов для удаления за раз
    respect_ttl: boolean;        // Удалять только expired (true для scheduled)
    force_distill: boolean;      // Принудительная дистилляция перед удалением
  };
  
  // Результат
  result?: {
    artifacts_processed: number;
    artifacts_deleted: number;
    bytes_freed: number;
    distilled_before_delete: number;
    errors: GCError[];
  };
}

type GCTrigger = "scheduled" | "budget_warning" | "budget_critical" | "manual";
```

#### 11.3.3. GC Algorithm

1. **Выбор кандидатов:**
   - Сначала: artifacts с истёкшим TTL
   - Затем: самые старые artifacts (FIFO)
   - Исключение: artifacts в процессе дистилляции

2. **Проверка дистилляции:**
   - Если artifact не дистиллирован → принудительная дистилляция
   - Принцип "Distill before forget"

3. **Удаление:**
   - Удаление blob из storage
   - Создание tombstone записи
   - Обновление evidence_pointers в TimelineCards
   - Генерация события `artifact_purged`

4. **Проверка бюджета:**
   - Если бюджет всё ещё превышен → продолжить GC
   - Если достигнут target_free_mb → остановить

### 11.4. Storage Monitoring API

```typescript
// Storage monitoring endpoints
interface StorageMonitoringAPI {
  // Получить текущий статус
  "storage.status": () => StorageStatus;
  
  // Получить прогноз заполнения
  "storage.forecast": () => StorageForecast;
  
  // Запустить GC вручную
  "storage.gc": (params?: GCParams) => GCResult;
  
  // Настроить бюджет
  "storage.set_budget": (budget_mb: number) => void;
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

interface StorageForecast {
  days_until_full: number;
  avg_daily_growth_mb: number;
  recommended_action?: "none" | "increase_budget" | "reduce_ttl" | "reduce_fps";
}
```

---

## 12. Revocation Flow

Revocation — это отзыв доверия к источнику данных. В отличие от Purge, Revocation удаляет canonical events и пересчитывает derived представления.

### 12.1. Revocation vs Purge

| Аспект | Purge | Revocation |
|--------|-------|------------|
| **Цель** | Освободить место / приватность | Отозвать доверие к источнику |
| **Scope** | Evidence artifacts (ephemeral) | Canonical events + Ephemeral по source_id |
| **Derived** | Сохраняются как Distilled Snapshots | Пересчитываются без источника |
| **Триггер** | Пользователь / TTL / Budget | Пользователь / Системное решение |
| **Аудит** | Tombstone event | Revocation log entry |

### 12.2. Revocation Scope

При revocation источника `timeskein.collector.screen-evidence`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Revocation Scope                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  УДАЛЯЕТСЯ:                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Canonical Events                                                      │  │
│  │ - context_event.evidence.chunk_captured                               │  │
│  │ - context_event.evidence.chunk_processed                              │  │
│  │ - context_event.evidence.artifact_purged                              │  │
│  │ WHERE provenance.source_id = "timeskein.collector.screen-evidence"    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Ephemeral Artifacts                                                   │  │
│  │ - Evidence Artifacts (chunks)                                         │  │
│  │ - Evidence blobs in storage                                           │  │
│  │ WHERE provenance.source_id = "timeskein.collector.screen-evidence"    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ПЕРЕСЧИТЫВАЕТСЯ:                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Derived Representations                                               │  │
│  │ - DerivedAnnotations → удаляются                                      │  │
│  │ - Timeline Cards → пересчитываются без evidence                       │  │
│  │ - Episodes → пересчитываются без evidence-based refs                  │  │
│  │                                                                        │  │
│  │ Если пересчёт невозможен (Episode полностью основан на evidence):     │  │
│  │ → Episode удаляется                                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.3. Revocation Process

```typescript
interface RevocationProcess {
  // Инициация
  source_id: string;             // ID отзываемого источника
  initiated_by: "user" | "system";
  initiated_at: string;
  reason: string;
  
  // Этапы
  stages: {
    // 1. Идентификация данных
    identify: {
      canonical_events_count: number;
      ephemeral_artifacts_count: number;
      derived_count: number;
    };
    
    // 2. Удаление canonical
    delete_canonical: {
      events_deleted: number;
      completed_at?: string;
    };
    
    // 3. Удаление ephemeral
    delete_ephemeral: {
      artifacts_deleted: number;
      bytes_freed: number;
      completed_at?: string;
    };
    
    // 4. Пересчёт derived
    recompute_derived: {
      recomputed: number;
      deleted: number;  // Если пересчёт невозможен
      completed_at?: string;
    };
  };
  
  // Результат
  status: "pending" | "in_progress" | "completed" | "failed";
  completed_at?: string;
  error?: string;
}
```

### 12.4. Revocation API

Revocation выполняется через API источников, определённый в [RFC-0005](0005-event-ingest-source-nodes.md):

```typescript
// Revocation через sources API (RFC-0005)
interface SourcesAPI {
  // Отзыв источника
  "sources.revoke": (params: RevocationParams) => RevocationResult;
  
  // Статус revocation
  "sources.revocation_status": (revocation_id: string) => RevocationProcess;
  
  // История revocations
  "sources.revocation_history": () => RevocationProcess[];
}

interface RevocationParams {
  source_id: string;
  reason: string;
  confirm: "CONFIRM_REVOKE";     // Требуется явное подтверждение
}

interface RevocationResult {
  revocation_id: string;
  status: "initiated" | "failed";
  error?: string;
}
```

### 12.5. Revocation Confirmation

Revocation — необратимая операция. Требуется явное подтверждение:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Revocation Confirmation Dialog                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ⚠️  ВНИМАНИЕ: Отзыв источника                                              │
│                                                                             │
│  Вы собираетесь отозвать источник:                                          │
│  "Screen Evidence Collector" (timeskein.collector.screen-evidence)          │
│                                                                             │
│  Это действие:                                                              │
│  • Удалит все события от этого источника                                    │
│  • Удалит все evidence artifacts                                            │
│  • Пересчитает или удалит связанные Timeline Cards                          │
│                                                                             │
│  Это действие НЕОБРАТИМО.                                                   │
│                                                                             │
│  Для подтверждения введите: CONFIRM_REVOKE                                  │
│                                                                             │
│  [________________]                                                         │
│                                                                             │
│  [Отмена]                                    [Отозвать источник]            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Open Questions

Вопросы, требующие дальнейшего обсуждения и уточнения:

### 13.1. Capture

1. **Multi-monitor support:** Как обрабатывать несколько мониторов? Захватывать все или только активный?
2. **Virtual desktops:** Как обрабатывать виртуальные рабочие столы (macOS Spaces, Windows Virtual Desktops)?
3. **HDR content:** Нужна ли поддержка HDR контента или достаточно SDR?

### 13.2. Distill

1. **Offline distillation:** Как обрабатывать chunks, если Provider недоступен? Очередь или пропуск?
2. **Provider fallback:** Автоматический fallback на local provider при недоступности remote?
3. **Partial distillation:** Что делать, если дистилляция частично успешна (OCR работает, summarization нет)?

### 13.3. Privacy

1. **Automatic pause triggers:** Какие приложения/сайты должны автоматически триггерить паузу?
2. **Redaction granularity:** Редактировать весь chunk или только отдельные кадры?
3. **Audit log retention:** Как долго хранить audit log (tombstones)?

### 13.4. Storage

1. **Compression strategies:** Какие стратегии сжатия использовать для разных типов контента?
2. **Deduplication:** Нужна ли дедупликация похожих кадров?
3. **Cloud backup:** Поддержка резервного копирования в облако (с шифрованием)?

---

## 14. References

- [RFC-0005: Event Ingest + SourceNode](0005-event-ingest-source-nodes.md)
- [RFC-0006: Retention, TTL и Distillation](0006-retention-ttl-distillation.md)
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md)
- [Глоссарий](../glossary.md)

---

## Changelog

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2025-01 | Initial draft: SourceNode manifest, permissions, event types |
| 0.2.0 | 2025-01 | Added Evidence Artifact structure, Provider abstraction, Pipeline stages |
| 0.3.0 | 2025-01 | Added Privacy Controls, Configuration, Storage Budget, Revocation Flow |
