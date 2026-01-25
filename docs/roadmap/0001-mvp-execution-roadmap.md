<!-- File: docs/roadmap/0001-mvp-execution-roadmap.md -->

# Roadmap 0001: MVP Execution Plan (Manual-first Inventory)

Цель: довести до MVP реализацию `user-story-02 (Manual-first Work Inventory)` на Windows, macOS и Android, в архитектуре “web surfaces + device agent”, без фонового онлайн-наблюдения ОС.

Примечание: multi-device sync (Hub+Sync) — отдельный контур. Включаем в MVP только если это явно требуется; иначе выносим в следующий майлстоун.

---

## 0. Документация и фиксация контуров (завершено)

* user-story-02
* UX документ для user-story-02
* RFC-0002 (топология и карта компонентов)
* RFC-0003 (архитектура набора клиентских приложений)

---

## 1. Монорепа: каркасы всех компонент

* Инициализация структуры каталогов и пакетов под core-first / hexagonal (ports & adapters).
* TS-SCHEMA: общий контракт DTO/версий/сериализации.
* TS-AGENT: локальный бэкенд (ядро домена + use-cases + порты).
* TS-DESKTOP: web surface host (Hello World UI).
* TS-ANDROID: web surface host (Hello World UI).
* TS-HUB: серверный каркас (пустой или минимальный).

Гейт:

* всё собирается,
* тесты запускаются,
* версии схемы видны всем компонентам.

---

## 2. Нулевой вертикальный срез end-to-end (без “смысла”, но со всеми стыками)

* Desktop:

  * хоткей → открывается палитра/overlay,
  * UI вызывает bridge,
  * bridge вызывает local API агента,
  * агент отвечает (`ping()` или `inventory.list() -> []`).
* Android:

  * быстрый entrypoint (кнопка/shortcut в приложении),
  * открывается тот же UI,
  * UI вызывает bridge,
  * embedded agent отвечает (`ping()` или `inventory.list() -> []`).

Гейт:

* один и тот же web UI реально живёт на Win, macOS, Android,
* он ходит в агента через единый контракт.

---

## 3. Реализация TS-AGENT “изнутри-наружу” без UI (user-story-02 как функциональный бэкенд)

* Domain:

  * WorkItem / Ref / State, инварианты, валидации.
* Use-cases:

  * create / list / touch
  * set state / set note / pin-unpin
  * add ref / remove ref
  * open ref / open last ref
* Refs engine:

  * нормализация,
  * дедупликация,
  * конфликт (ref уже привязан к другому item),
  * denylist (block/redact).
* Storage:

  * SQLite + миграции,
  * индексы,
  * транзакции.
* Event log (append-only) — желательно сразу, хотя бы минимально.
* Тесты:

  * unit (домен/refs),
  * integration (SQLite/migrations),
  * contract tests (DTO / Local API).

Гейт:

* все сценарии user-story-02 прогоняются через CLI/скрипты без UI,
* поведение стабильно, тесты зелёные.

---

## 4. Подключение Desktop Surfaces к готовому агенту

* Палитра:

  * inventory list + поиск,
  * шорткаты (Enter/T/N/S/R/P),
  * диалоги: state chooser, note editor, refs manager, conflict resolution.
* Tray/Menubar:

  * open inventory,
  * quick add,
  * settings.
* Desktop adapters:

  * global hotkey,
  * opener (url/file),
  * clipboard (только по явной команде),
  * file picker (если нужен).

Гейт:

* полный цикл user-story-02 работает на Windows,
* затем доводится до идентичной работоспособности на macOS.

---

## 5. Подключение Android Surface к готовому agent (embedded)

* Тот же web UI.
* Android entrypoints (не “глобальный хоткей”):

  * launcher shortcut / кнопка “Inventory”,
  * share sheet “Send to Timeskein” (как главный быстрый путь),
  * опционально позже: tile/notification entrypoint.
* Android adapters:

  * opener через intents,
  * file picker,
  * clipboard (по явному действию).

Гейт:

* user-story-02 функционально эквивалентна на Android,
* активация — через Android-нативные entrypoints.

---

## 6. Итеративная реализация сценариев user-story-02 (основное “мясо”)

Принцип:

* сначала реализуем сценарий в shared core/agent (с тестами),
* затем проверяем в общем web UI,
* затем доводим платформенные glue/adapters (Win → macOS → Android).

Гейт:

* каждый сценарий закрыт и подтверждён на всех трёх платформах.

---

## 7. Закрытие остаточных требований user-story-02

* Полировка сортировки/фильтрации, edge cases.
* UX-мелочи (сообщения, ошибки открытия ref, отмены, no-op).
* Поведение конфликтов refs и denylist — без сюрпризов.

Гейт:

* чек‑лист user-story-02 закрыт полностью.

---

## 8. (Опционально) Hub + Sync как отдельный вертикальный слой

Включать только если multi-device входит в MVP.

* TS-HUB:

  * docker-compose окружение,
  * минимальная регистрация device/user,
  * endpoints для sync.
* TS-SYNC (внутри TS-AGENT):

  * outbox/inbox,
  * идемпотентность,
  * минимальная стратегия конфликтов.
* Тестирование:

  * изменения на Win появляются на Android и macOS.

Гейт:

* единый inventory синхронизируется Win ↔ macOS ↔ Android.

Если multi-device не входит в MVP:

* этот этап переносится в следующий майлстоун без блокировки релиза manual-first.

---

## 9. Нефункциональные требования уровня MVP (надёжно, но без фанатизма)

* Производительность:

  * быстрый старт агента,
  * быстрая палитра,
  * быстрый list/search.
* Надёжность:

  * миграции,
  * восстановление после крэша,
  * отсутствие порчи БД.
* Безопасность:

  * local API не торчит наружу,
  * минимальные разрешения,
  * denylist реально работает.
* Диагностика:

  * логи,
  * debug режим,
  * экспорт/backup (хотя бы ручной).
* Доставка:

  * инсталляторы/подписи/пакеты,
  * автозапуск агента (если требуется UX),
  * базовая стратегия обновлений (можно минимально).

Гейт:

* MVP устойчив к реальному использованию и не разваливается при первой попытке “жить”.
