# opskarta v3, компактный контекст для LLM

Назначение: этот файл — компактный пересказ всей спецификации opskarta v3. Его можно целиком помещать в prompt/context LLM-модели, когда модели нужны правила формата без чтения полного `SPEC.md`.

## 0. Основная идея

opskarta — YAML/JSON-формат plan-as-code для операционных карт. v3 сохраняет основу v2:

- `nodes` = структура работ и зависимости;
- `schedule` = опциональный календарный слой;
- `execution` = опциональный слой фактического прогресса;
- `views` = настройки рендеринга, не влияющие на расписание;
- `x.exec` = встроенный operational/executive profile для синков, руководительских срезов и статусных документов.

Используйте v3, когда план становится рабочим центром для синков, executive-карт, отчётов и сфокусированных Gantt-окон. Для простого tree/list/Gantt v2 остаётся более лёгкой стартовой точкой.

## 1. Верхнеуровневые блоки

Разрешённые блоки верхнего уровня:

- `version: 3`
- `meta`
- `statuses`
- `nodes`
- `schedule`
- `execution`
- `views`
- `profiles`
- `x`

Неизвестные блоки верхнего уровня невалидны.

## 2. Plan Set и слияние

План можно разбить на несколько `*.plan.yaml` фрагментов. Loader детерминированно сливает их в один Merged Plan.

Правила слияния:

- `version` должен совпадать во всех фрагментах.
- Поля `meta` объединяются; конфликтующие значения — ошибка.
- `statuses`, `nodes`, `views`, `schedule.calendars`, `schedule.nodes` и `x` объединяются по ключам; дубликаты ключей — ошибка.
- `schedule.default_calendar` может быть задан только в одном фрагменте.
- Информация о файле-источнике сохраняется для диагностики.

## 3. Nodes

`nodes` — словарь `node_id -> node`.

Обязательное поле node:

- `title` string.

Частые опциональные поля:

- `kind` string;
- `status` string, ключ в `statuses`;
- `parent` string, существующий `node_id`;
- `deps` список строк-зависимостей или объектов-зависимостей;
- `milestone` boolean;
- `effort` number >= 0;
- `issue` string;
- `notes` string;
- `x` object.

Запрещено в `nodes`: `start`, `finish`, `duration`, `excludes`. Даты и календари живут в `schedule`.

Поля объекта зависимости:

- `id` обязательный target `node_id`;
- `type`: `fs` или `ss`, по умолчанию `fs`;
- `lag`: неотрицательная длительность `0d`, `2d`, `1w`, по умолчанию `0d`;
- `hard` boolean, по умолчанию `true`;
- `note` string.

Циклы parent и циклы deps невалидны. Запрещены циклы и в hard, и в soft dependencies.

Effort-метрики:

- `effort_rollup` = сумма effective effort прямых детей;
- `effort_effective` = явный `effort`, если задан, иначе `effort_rollup`;
- `effort_gap` = `max(0, effort - effort_rollup)`.

## 4. Statuses

`statuses` опционален, если nodes не используют `status`.

Поля status:

- `label` string, обязательно;
- `color` опциональный `#RRGGBB`.

`nodes.*.status` должен ссылаться на существующий status key.

## 5. Schedule

`schedule` опционален. План без `schedule` валиден.

Структура schedule:

- `schedule.calendars`
- `schedule.default_calendar`
- `schedule.nodes`

Calendar:

- `excludes`: список `"weekends"` и/или дат `YYYY-MM-DD`.

Поля schedule node:

- `start` валидная дата `YYYY-MM-DD`;
- `finish` валидная дата `YYYY-MM-DD`;
- `duration` положительная длительность `^[1-9][0-9]*[dw]$`;
- `calendar` существующий calendar id.

Запрещено в `schedule.nodes`: `deps`. Зависимости живут только в `nodes`.

Семантика расписания:

- только nodes, перечисленные в `schedule.nodes`, участвуют в календарном планировании;
- unscheduled nodes всё равно показываются в tree/list/deps;
- приоритет start: явный `start`, затем обратный расчёт из `finish + duration`, затем hard scheduled deps;
- `fs` использует finish зависимости; `ss` использует start зависимости;
- hard deps влияют на schedule, soft deps информационные;
- обычная задача после `fs`-зависимости стартует на следующий рабочий день; milestone может стоять в дату зависимости;
- `duration` включает день start;
- `1w` означает 5 рабочих дней;
- non-milestone start на исключённом дне нормализуется к следующему рабочему дню с warning.

## 6. Execution

`execution` опционален и может жить в отдельном фрагменте.

Поля `execution.nodes.<node_id>`:

- `progress` number 0..1;
- `actual_start` валидная дата `YYYY-MM-DD`;
- `actual_finish` валидная дата `YYYY-MM-DD`;
- `updated_at` ISO-like timestamp string;
- `confidence` number 0..1;
- `note` string.

`node_id` должен существовать в `nodes`.

Progress rollup:

- leaf node использует прямой `execution.nodes.<id>.progress`;
- parent progress считается effort-weighted по детям с progress data;
- `progress_coverage` показывает долю effort, по которой есть progress data.

Strict mode может предупреждать о несогласованных фактах execution: например, `actual_finish` без `actual_start` или `progress=1.0` без `actual_finish`.

## 7. Views

`views` задают выборку и оформление рендера. Views не влияют на расчёт schedule.

Поля view:

- `title` string;
- `where` object;
- `order_by` string;
- `group_by` string;
- `lanes` object;
- `date_format` string;
- `axis_format` string;
- `tick_interval` string;
- `window_start` валидная дата `YYYY-MM-DD`;
- `window_finish` валидная дата `YYYY-MM-DD`.

Запрещено в views: `excludes`.

Разрешённые фильтры `where`:

- `kind`: list[string];
- `status`: list[string];
- `has_schedule`: boolean;
- `parent`: существующий node id, выбирает потомков;
- `x_ops_attention_class`: list[string], сравнивается с `nodes.*.x.ops.attention_class`.

Поля lane:

- `title` string;
- `nodes` list[node_id], обязательно;
- `expand_descendants: leaves`, чтобы вывести scheduled leaf-потомков указанных lane nodes.

Gantt windows:

- `window_start` и `window_finish` обрезают только вывод;
- исходные даты в `schedule.nodes` не меняются;
- `window_start` должен быть <= `window_finish`.

Правила рендереров:

- Gantt требует `--view`.
- Tree/list/deps могут рендериться без view.
- `where`, сортировка, lanes и windows работают только на этапе рендера.

## 8. Executive overlay: `x.exec`

`x.exec` — встроенный профиль расширения для operational/executive views. Он не заменяет `nodes`, `schedule` или `execution`, а строит короткую управленческую карту поверх них.

Структура:

- `program`
- `defaults`
- `blocks`
- `edges`
- `views`

Частые поля `program`:

- `committed_date` валидная дата `YYYY-MM-DD`;
- `nearest_goal` string;
- `success_by_next_sync` string.

Каждый executive block задаёт ровно одно из:

- `scope_nodes`: список обычных node ids;
- `source_blocks`: список executive block ids.

Поля block:

- `title` string;
- `target_gate` node id;
- `kind`, например `main` или `risk_sidecar`;
- `progress_override` number 0..1;
- `mgmt.health`: `green`, `yellow`, `red` или `neutral`;
- `mgmt.sync_note`;
- `mgmt.next_sync_goal`;
- `mgmt.owner`;
- `mgmt.health_note`;
- `mgmt.blocker_note`.

Executive edges:

- `from` block id;
- `to` block id;
- `type`: `required`, `risk_reduction` или `context`;
- `label` optional string.

Executive views:

- `blocks` list visible block ids;
- `direction` Mermaid direction, например `LR` или `TB`;
- `color_mode`;
- `highlight_current`;
- `show_progress`;
- `show_gate_date`;
- `wrap_title_lines`;
- `caption`;
- опциональный view-local `edges` override.

Рендереры:

- `render executive` выводит Mermaid flowchart.
- `render executive-report` выводит Markdown-секции: `status`, `tracks`, `signals`.
- `executive-report status` по умолчанию использует `exec-top`.
- `tracks` и `signals` по умолчанию используют `exec-active-tracks`.
- `--view` переопределяет report view.
- `--lang ru|en` выбирает встроенные подписи и формат дат.

## 9. Profiles и расширения

`profiles` объявляет namespaces расширений, используемые под `x`.

Поля profile:

- `id` string;
- `version` integer;
- `namespace` по regex `^[a-zA-Z_][a-zA-Z0-9_]*$`.

Дублирующиеся profile namespaces невалидны.

`x` может хранить произвольные extension data на верхнем уровне и внутри nodes. Расширения не должны менять core-семантику, если профиль явно не определяет такое поведение.

## 10. Валидация

Severity levels:

- `error`: невалидно;
- `warning`: валидно, но подозрительно;
- `info`: информационный результат.

Примеры invalid:

- отсутствуют обязательные поля;
- неизвестные top-level blocks;
- неподдерживаемые view или `where` keys;
- дубликаты ключей между фрагментами;
- несуществующие ссылки;
- parent/dependency cycles;
- невалидные date/duration/lag formats;
- запрещённые поля в неправильных блоках;
- несогласованные даты schedule;
- невалидные execution progress/confidence;
- невалидные ссылки `x.exec`.

Warnings включают unscheduled или unschedulable nodes, нормализацию start и некоторые consistency issues в execution.

## 11. Markdown refresh

`update-markdown` обновляет сгенерированные Mermaid или Markdown-блоки по embedded commands.

Формат command comment:

```markdown
<!--
Перегенерить:
python -m specs.v3.tools.cli validate plan.yaml exec.yaml
python -m specs.v3.tools.cli render executive plan.yaml exec.yaml --view exec-top
-->
```

Заменяется только Mermaid-блок или `<!-- GENERATED:START -->` / `<!-- GENERATED:END -->` блок, который идёт сразу после комментария.

## 12. CLI

```bash
python -m specs.v3.tools.cli validate plan.yaml
python -m specs.v3.tools.cli render tree plan.yaml --view backlog
python -m specs.v3.tools.cli render list plan.yaml --view tasks
python -m specs.v3.tools.cli render deps plan.yaml
python -m specs.v3.tools.cli render gantt plan.yaml --view release-window --style status
python -m specs.v3.tools.cli render executive plan.yaml exec.yaml --view exec-top
python -m specs.v3.tools.cli render executive-report plan.yaml exec.yaml --section status --lang ru
python -m specs.v3.tools.cli update-markdown plan.md exec.md
```

## 13. Минимальная миграция v2 -> v3

Для валидного v2-плана:

1. Замените `version: 2` на `version: 3`.
2. Запустите v3 validation.
3. Оставьте v2-style views, если они валидны.
4. Добавляйте `x.exec`, Gantt windows, attention filters и Markdown refresh только когда они полезны.
