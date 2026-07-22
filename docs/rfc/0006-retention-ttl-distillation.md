<!-- File: docs/rfc/0006-retention-ttl-distillation.md -->

# RFC-0006: Retention, TTL и Distillation Pipeline

## Статус

**Draft**.

Стратегическое уточнение 2026-07-10: minimum policy gate, raw TTL, pause и
purge нужны уже для bounded Context Probe из [Roadmap 0005](../roadmap/0005-causal-work-memory-roadmap.md).
Полная storage-budget и distillation инфраструктура остаётся после доказанной
пользы автоматического контекста.

## Уровень зрелости

**Level 2+** (не входит в MVP)

## Связанные документы

- [RFC-0002: Топология системы](0002-system-topology-and-component-map.md)
- [RFC-0005: Event Ingest + SourceNode](0005-event-ingest-source-nodes.md)
- [RFC-0007: Screen Evidence Source Node](0007-evidence-mode-screen-evidence-source-node.md) (Level 3)
- [ADR-0003: Evidence-Mode Opt-in](../adr/0003-evidence-mode-opt-in.md) (Level 3)
- [RFC-0009: Causal Work Memory and Operational Reality](0009-causal-work-memory-and-operational-reality.md)
- [ADR-0005: Недоверенный контекст и независимая память](../adr/0005-untrusted-context-and-consumer-neutral-memory.md)
- [RFC-0010: Артефакты, наблюдения и Context Pack](0010-artifacts-observations-and-context-packs.md)
- [Глоссарий](../glossary.md)

---

## 1. Цель

Определить, как Timeskein управляет жизненным циклом данных:
- Какие данные хранятся и как долго
- Как данные "дистиллируются" в производные представления
- Как данные удаляются безопасно

**Ключевой принцип:** жизненный цикл определяется намерением пользователя и
политикой данных. Автоматическое истечение TTL может сохранить разрешённую
дистиллированную ценность. Полное забывание удаляет сырьё и его производные и
никогда не создаёт новую копию перед удалением.

---

## 2. Слои данных

### 2.1. Canonical (каноническое)

**Описание:** Первичные факты, append-only журналы.

| Тип | Описание | TTL |
|-----|----------|-----|
| WorkItemEvent | Изменения Work Items | Бессрочно |
| ContextEvent | События контекста | Настраиваемый |

**Свойства:**
- Append-only (только добавление)
- Объяснимые (известен провенанс)
- Источник истины для пересчёта

**Примечание:** "Append-only" означает, что записи не изменяются после создания
и новые факты добавляются новыми записями. Удаление по retention-политике
является отдельной операцией жизненного цикла. Оно не разрешает скрытую
перезапись истории и должно оставлять безопасный аудит без удалённого
содержимого.

### 2.2. Derived (производное)

**Описание:** Вычисленные представления из canonical данных.

| Тип | Описание | Пересчитываемое |
|-----|----------|-----------------|
| Episode | Интервал с единым контекстом | Да |
| Thread | Сквозная тема | Да |
| DailySummary | Итог дня | Да |
| SearchIndex | Индекс для поиска | Да |

**Свойства:**
- Пересчитываемые из canonical
- Могут обновляться при появлении новых данных
- Удаление canonical требует обновления derived

### 2.3. Ephemeral (эфемерное)

**Описание:** Тяжёлые артефакты с ограниченным временем жизни.

| Тип | Описание | TTL по умолчанию |
|-----|----------|------------------|
| Screenshot | Скриншот | 7 дней |
| Transcript | Транскрипт | 30 дней |
| FullContent | Полный текст страницы | 7 дней |
| **Evidence Chunk** | Screen evidence chunk (Level 3) | **72 часа** |

**Свойства:**
- Занимают много места
- Имеют явный TTL
- Политика явно определяет, сохраняется ли производная информация после
  удаления

### 2.4. Evidence Artifacts (Level 3, opt-in)

**Описание:** Артефакты Evidence-Mode — чувствительные данные с коротким TTL.

| Тип | Описание | TTL по умолчанию | Sensitivity Level |
|-----|----------|------------------|-------------------|
| Evidence Chunk | Chunk screen evidence (канонический тип) | 72 часа | `high` |

**Свойства:**
- Строго opt-in (только Level 3)
- Канонический тип = `chunk` (frames — derived/temporary для дистилляции)
- Короткий TTL по умолчанию (72h) для privacy-first baseline
- Подлежат Purge по команде пользователя
- При обычном TTL могут дистиллироваться в Timeline Cards/Episodes; при полном
  забывании дистилляция запрещена

**Примечание:** Evidence Artifacts отличаются от обычных Ephemeral артефактов:
- Более короткий TTL по умолчанию (72h vs 7d)
- Отдельный Storage Budget
- Явные режимы `purge-raw`, `forget-completely` и `revoke-source`
- Поддержка Revocation по source_id

---

## 3. TTL политики

### 3.1. Уровни чувствительности

| Уровень | Описание | TTL по умолчанию |
|---------|----------|------------------|
| `normal` | Обычные данные | 90 дней |
| `sensitive` | Чувствительные данные | 30 дней |
| `private` | Приватные данные | 7 дней |
| `high` | Высокочувствительные данные (Evidence-Mode) | 24 часа |

**Примечание:** Уровень `high` используется для Evidence Artifacts. Рекомендуемый TTL для Evidence Chunks — 72 часа (privacy-first baseline), но может быть настроен пользователем.

### 3.2. Настройка TTL

```json
{
  "ttl_policies": {
    "context_events": {
      "normal": "90d",
      "sensitive": "30d",
      "private": "7d",
      "high": "24h"
    },
    "artifacts": {
      "screenshot": "7d",
      "transcript": "30d",
      "full_content": "7d"
    },
    "evidence_artifacts": {
      "chunk": "72h",
      "sensitivity": "high"
    }
  }
}
```

### 3.3. Evidence Artifact TTL (Level 3)

**Рекомендуемые значения:**

| Параметр | Значение | Обоснование |
|----------|----------|-------------|
| TTL по умолчанию | 72 часа | Privacy-first baseline |
| Минимальный TTL | 1 час | Достаточно для дистилляции |
| Максимальный TTL | 7 дней | Ограничение для приватности |

**Принципы:**
- Короткий TTL по умолчанию минимизирует риски приватности
- Пользователь может увеличить TTL до 7 дней
- Пользователь может уменьшить TTL до 1 часа
- TTL применяется к chunks (канонический тип), frames удаляются сразу после дистилляции

### 3.4. Переопределение пользователем

- Пользователь может увеличить/уменьшить TTL
- Пользователь может пометить данные как "keep forever"
- Пользователь может принудительно удалить данные
- Для Evidence Artifacts: TTL ограничен диапазоном 1h–7d (privacy constraint)

### 3.5. Намерения удаления

Одна команда `delete` недостаточна: она скрывает, должен ли сохраниться
семантический экстракт.

| Режим | Сырьё | Производные данные | Новая дистилляция |
|-------|-------|--------------------|-------------------|
| `expire-and-preserve` | удаляется по TTL | разрешённый snapshot сохраняется | допустима политикой |
| `purge-raw` | удаляется сейчас | уже разрешённое может сохраниться | только по отдельному согласию |
| `forget-completely` | удаляется | удаляется или инвалидируется каскадно | **запрещена** |
| `revoke-source` | данные источника удаляются | пересчитываются без источника | из отозванного сырья не создаётся |

UI обязан назвать результат операции до подтверждения. `Purge` без указания
режима не является достаточным API-контрактом.

---

## 4. Distillation Pipeline

### 4.1. Дистилляция перед policy cleanup

Дистилляция перед удалением выполняется только для режима
`expire-and-preserve` или при отдельном согласии `purge-raw + preserve
summary`:

1. проверить разрешение на долговременную производную запись;
2. проверить, есть ли уже актуальная дистилляция;
3. при необходимости создать производную запись и её provenance;
4. удалить сырьё;
5. записать безопасный аудит операции.

Для `forget-completely` и `revoke-source` новые Derivations не создаются.

### 4.2. Процессы дистилляции

#### Episode Builder

Превращает ContextEvents в Episodes:

```
ContextEvents (за период) → Episode
  - start_time, end_time
  - dominant_context (app, domain)
  - refs (извлечённые)
  - summary (генерируемый)
```

#### Thread Updater

Обновляет Threads при появлении новых Episodes:

```
Episode → связь с Thread
  - по refs (общие ключи тикетов, URL)
  - по контексту (похожие приложения/домены)
```

#### Daily Summary

Генерирует итог дня:

```
Episodes (за день) → DailySummary
  - top_contexts
  - work_items_touched
  - time_distribution
  - highlights
```

### 4.3. Расписание дистилляции

| Задача | Периодичность | Триггер |
|--------|---------------|---------|
| Episode Builder | По событиям | Накопление событий / таймаут |
| Thread Updater | При новом Episode | После Episode Builder |
| Daily Summary | Раз в день | Полночь локального времени |
| TTL GC | Раз в час | Таймер |
| Artifact Cleanup | Раз в день | После Daily Summary |

---

## 5. Garbage Collection (GC)

### 5.1. TTL GC процесс

```
1. Найти данные с истёкшим TTL
2. Для каждой записи:
   a. Определить retention-режим и разрешение на сохранение производной памяти
   b. Если разрешён `expire-and-preserve`: проверить или запустить дистилляцию
   c. Записать provenance удаления
   d. Удалить запись
   e. Удалить или инвалидировать запрещённые производные записи
3. Обновить статистику
```

### 5.2. Provenance удаления

```json
{
  "deletion_id": "uuid",
  "deleted_at": "2025-01-28T00:00:00Z",
  "reason": "ttl_expired",
  "data_type": "context_event",
  "count": 100,
  "time_range": {
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-01-07T23:59:59Z"
  },
  "distillation_status": "completed",
  "episodes_created": 5
}
```

### 5.3. Аудит удалений

- Все удаления логируются
- Пользователь может видеть историю удалений
- Можно экспортировать лог удалений

---

## 6. Artifact Pipeline

### 6.1. Жизненный цикл артефакта

```
1. Создание (от Collector/Connector)
2. Индексирование (извлечение метаданных)
3. Хранение (с TTL)
4. Опциональная дистилляция по retention-политике
5. Удаление (по TTL)
```

### 6.2. Индексирование артефактов

При создании артефакта извлекаются:
- Текст (OCR для скриншотов)
- Ключевые слова
- Refs (URL, issue keys)
- Метаданные (размер, формат)

### 6.3. Дистилляция артефактов

Перед `expire-and-preserve`:
- проверить, что сохранение производного текста и refs разрешено;
- извлечь только минимально достаточную информацию;
- обновить связанные Episodes и provenance.

Перед `forget-completely` извлечение не выполняется, а связанные производные
данные удаляются или инвалидируются.

---

## 7. Хранение

### 7.1. Структура хранения

```
~/.timeskein/
├── data/
│   ├── timeskein.db          # SQLite (canonical + derived)
│   └── artifacts/            # Ephemeral артефакты
│       ├── screenshots/
│       └── transcripts/
├── config/
└── logs/
```

### 7.2. Лимиты хранения

| Тип | Лимит по умолчанию |
|-----|-------------------|
| База данных | 1 GB |
| Артефакты | 5 GB |
| Скриншоты | 500 MB |
| **Evidence Artifacts (Level 3)** | **5 GB** |

### 7.3. Storage Budget для Evidence-Mode (Level 3)

**Описание:** Отдельный бюджет хранения для Evidence Artifacts.

| Параметр | Значение по умолчанию |
|----------|----------------------|
| Лимит | 5 GB |
| Порог предупреждения | 80% (4 GB) |
| Критический порог | 95% (4.75 GB) |

**Действия при достижении порогов:**

| Порог | Действие |
|-------|----------|
| 80% (warning) | Уведомление пользователя, рекомендация purge |
| 90% (accelerated GC) | Ускоренный GC — удаление старейших chunks |
| 95% (critical) | Остановка захвата до освобождения места |

**Конфигурация:**

```json
{
  "evidence_storage_budget": {
    "limit_mb": 5120,
    "warning_threshold": 0.8,
    "accelerated_gc_threshold": 0.9,
    "critical_threshold": 0.95,
    "gc_strategy": "oldest_first"
  }
}
```

**GC стратегии:**
- `oldest_first` — удаление старейших chunks (по умолчанию)
- `largest_first` — удаление самых больших chunks
- `low_value_first` — удаление chunks с низкой информационной ценностью (требует анализа)

### 7.4. Действия при достижении лимита

1. Предупреждение пользователя
2. Ускоренный GC (удаление старого)
3. При критическом — остановка сбора

---

## 8. API

### 8.1. Status

```
GET /retention/status
```

```json
{
  "storage": {
    "database_size_mb": 150,
    "database_limit_mb": 1024,
    "artifacts_size_mb": 800,
    "artifacts_limit_mb": 5120
  },
  "ttl_stats": {
    "events_expiring_24h": 100,
    "artifacts_expiring_24h": 50
  },
  "distillation": {
    "last_run": "2025-01-28T00:00:00Z",
    "pending_episodes": 10
  }
}
```

### 8.2. Принудительный GC

```
POST /retention/gc
{
  "target": "artifacts",
  "older_than": "7d"
}
```

### 8.3. Настройки TTL

```
GET /retention/policies
PUT /retention/policies
```

---

## 9. Пользовательский контроль

### 9.1. "Keep forever"

Пользователь может пометить данные как неудаляемые:
- Конкретный Episode
- Все данные за период
- Данные по конкретному Work Item

### 9.2. Принудительное удаление

Пользователь может удалить данные немедленно:
- По временному диапазону
- По источнику
- По типу данных

Пользователь выбирает, нужно ли удалить только сырьё или забыть данные
полностью. Режим полного забывания не предлагает и не создаёт экспорт,
дистилляцию или новый summary после подтверждения.

### 9.3. Экспорт перед удалением

При ручном удалении предлагается экспорт:
- JSON дамп
- Markdown отчёт
- Archive (с артефактами)

---

## 10. Безопасность

### 10.1. Безвозвратное удаление

Best-effort удаление на уровне приложения:

- Данные перезаписываются, не просто помечаются
- Для SQLite: VACUUM после удаления (освобождает место, но не гарантирует криптографическое уничтожение на уровне носителя)
- Для файлов: secure delete (если поддерживается ОС/носителем)

**Ограничения:**
- Физические гарантии удаления зависят от ОС, файловой системы и типа носителя
- SSD с wear leveling делают гарантированное безвозвратное удаление технически невозможным
- **Рекомендация:** для чувствительных данных использовать шифрование at-rest

### 10.2. Аудит

- Все операции GC логируются
- Можно доказать, что данные были удалены на уровне приложения
- Восстановление удалённых данных средствами приложения невозможно (восстановление на уровне носителя выходит за рамки системы)

### 10.3. Приватность по умолчанию

- Короткие TTL для чувствительных данных
- Минимальное хранение артефактов
- Пользователь явно расширяет TTL при необходимости

---

## 11. Purge семантика (Level 3)

**Purge** означает ручную очистку и всегда требует выбранного режима. Он
отличается от автоматического TTL GC и от Revocation.

### 11.1. Что удаляется при Purge

| Тип данных | Действие |
|------------|----------|
| Evidence Chunks (ephemeral) | **Удаляются** |
| Evidence pointers/индексы | **Удаляются** |
| Derived Timeline Cards/Episodes | Сохраняются только для `purge-raw`; удаляются или инвалидируются для `forget-completely` |
| Canonical ContextEvents | Сохраняются для `purge-raw`; удаляются в выбранном scope для `forget-completely` |

### 11.2. Процесс Purge

```
1. Пользователь выбирает `purge-raw` или `forget-completely` и scope.
2. UI показывает, какие данные и производные записи останутся.
3. Для `purge-raw` система сохраняет уже разрешённые производные записи; новая
   дистилляция требует отдельного согласия.
4. Для `forget-completely` система запрещает новую дистилляцию и находит
   зависимые Derivations.
5. Удаляет evidence artifacts и pointers.
6. Сохраняет, инвалидирует или удаляет производные записи согласно режиму.
7. Создаёт tombstone без удалённого содержимого.
8. Обновляет статистику хранения.
```

### 11.3. Tombstone Events (Audit Trail)

При Purge создаётся tombstone event для аудита:

```json
{
  "event_type": "evidence.artifact_purged",
  "event_id": "uuid",
  "timestamp": "2025-01-28T12:00:00Z",
  "user_initiated": true,
  "scope": {
    "time_range": {
      "from": "2025-01-27T00:00:00Z",
      "to": "2025-01-28T00:00:00Z"
    },
    "source_ids": ["timeskein.collector.screen-evidence"]
  },
  "stats": {
    "chunks_deleted": 150,
    "bytes_freed": 524288000,
    "episodes_affected": 12,
    "distilled_snapshots_created": 0,
    "derived_records_deleted": 12
  },
  "mode": "forget-completely",
  "distillation_status": "forbidden"
}
```

### 11.4. Purge vs TTL GC

| Аспект | Purge | TTL GC |
|--------|-------|--------|
| Инициатор | Пользователь | Система (автоматически) |
| Триггер | Команда | Истечение TTL |
| Scope | По выбору пользователя | По TTL политике |
| Audit | Tombstone event | Deletion log |
| Derived | По выбранному режиму | Обновление/пересчёт |

---

## 12. Distilled Snapshot

**Distilled Snapshot** — derived представление, сохраняемое после удаления upstream-сырья (evidence artifacts).

### 12.1. Концепция

Когда evidence artifacts удаляются по `expire-and-preserve` или
`purge-raw + preserve summary`, derived Timeline Cards/Episodes могут
сохраняться как Distilled Snapshots:

- Содержат извлечённую ценность (summary, refs, marks)
- Не содержат ссылок на удалённые artifacts
- Помечены как "evidence purged"
- **Не пересчитываемые** — upstream данные удалены

`forget-completely` не создаёт Distilled Snapshot и удаляет или инвалидирует
уже существующие снимки в выбранном scope.

### 12.2. Структура Distilled Snapshot

```json
{
  "episode_id": "uuid",
  "snapshot_type": "distilled",
  "created_at": "2025-01-28T12:00:00Z",
  "evidence_purged": true,
  "purged_at": "2025-01-28T12:00:00Z",
  
  "preserved_data": {
    "time_range": {
      "start": "2025-01-27T10:00:00Z",
      "end": "2025-01-27T11:30:00Z"
    },
    "summary": "Работа над RFC-0006...",
    "refs": [
      {"type": "file", "path": "docs/rfc/0006.md"},
      {"type": "url", "value": "https://github.com/..."}
    ],
    "marks": ["focused", "documentation"],
    "distraction_mark": false
  },
  
  "evidence_metadata": {
    "original_chunks_count": 6,
    "original_duration_sec": 5400,
    "provider_id": "local-llm"
  },
  
  "recomputable": false,
  "reason": "upstream_purged"
}
```

### 12.3. Свойства Distilled Snapshot

| Свойство | Значение |
|----------|----------|
| Пересчитываемый | **Нет** (upstream удалён) |
| Содержит artifacts | **Нет** (только метаданные) |
| Содержит summary | **Да** |
| Содержит refs | **Да** |
| Содержит marks | **Да** |
| Удаляемый | **Да** (по запросу пользователя) |

### 12.4. UI индикация

Timeline Cards, созданные из Distilled Snapshots, отображаются с индикатором:
- Иконка "evidence purged"
- Tooltip: "Evidence artifacts удалены, показан сохранённый snapshot"
- Preview недоступен

---

## 13. Revocation семантика (Level 2+)

**Revocation** — отзыв источника: удаление canonical events + ephemeral artifacts по provenance, затем пересчёт derived представлений.

### 13.1. Revocation vs Purge

| Аспект | Purge | Revocation |
|--------|-------|------------|
| Цель | Освободить место / приватность | Отозвать доверие к источнику |
| Scope | Evidence artifacts только | Canonical + Ephemeral по source_id |
| Derived | Сохраняются как Distilled Snapshots | **Пересчитываются** без источника |
| Canonical events | Сохраняются | **Удаляются** по source_id |
| Use case | "Удали мои скриншоты" | "Удали всё от этого источника" |

### 13.2. Процесс Revocation

```
1. Пользователь запрашивает Revocation для source_id
2. Система находит все данные с provenance.source_id
3. Удаляет canonical events от этого источника
4. Удаляет ephemeral artifacts от этого источника
5. Пересчитывает derived представления:
   a. Если возможен пересчёт без источника — пересчитать
   b. Если пересчёт невозможен — удалить derived
6. Логирует операцию revocation
7. Обновляет статистику
```

### 13.3. Пересчёт Derived при Revocation

При Revocation derived представления обрабатываются по-разному:

| Тип Derived | Действие |
|-------------|----------|
| Episode (только от revoked source) | Удаляется |
| Episode (смешанные источники) | Пересчитывается без revoked source |
| Thread | Пересчитывается |
| DailySummary | Пересчитывается |
| SearchIndex | Обновляется |

### 13.4. Revocation Event

```json
{
  "event_type": "source.revoked",
  "event_id": "uuid",
  "timestamp": "2025-01-28T12:00:00Z",
  "source_id": "timeskein.collector.screen-evidence",
  "reason": "user_requested",
  
  "stats": {
    "canonical_events_deleted": 500,
    "artifacts_deleted": 150,
    "episodes_deleted": 5,
    "episodes_recomputed": 20,
    "bytes_freed": 1073741824
  },
  
  "recomputation_status": "completed"
}
```

### 13.5. API для Revocation

```
POST /sources/{source_id}/revoke
{
  "confirm": "REVOKE",
  "reason": "user_requested"
}
```

Ответ:
```json
{
  "status": "completed",
  "revocation_id": "uuid",
  "stats": { ... }
}
```

---

## 14. Evidence-Mode GC интеграция

### 14.1. GC Hooks для Evidence-Mode

Evidence-Mode интегрируется с общим GC через hooks:

| Hook | Описание |
|------|----------|
| `before_gc` | Проверка Storage Budget |
| `should_gc_artifact` | Решение об удалении конкретного artifact |
| `after_gc` | Обновление статистики Evidence-Mode |

### 14.2. Приоритеты GC

При нехватке места GC удаляет данные в порядке приоритета:

1. Evidence Chunks с истёкшим TTL
2. Evidence Chunks старше 72h (если Storage Budget > 90%)
3. Обычные Ephemeral artifacts с истёкшим TTL
4. Evidence Chunks по стратегии (oldest_first / largest_first)

### 14.3. Защита от потери данных

Перед удалением Evidence Chunks GC обязан:
1. определить режим удаления и разрешение на сохранение производных данных;
2. для `expire-and-preserve` проверить или выполнить разрешённую дистилляцию;
3. для `forget-completely` запретить дистилляцию и удалить зависимые данные;
4. удалить chunk и записать безопасный аудит.
