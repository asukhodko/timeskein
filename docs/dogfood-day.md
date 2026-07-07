# Dogfood Day Protocol

Use this protocol when Timeskein replaces Session for one real workday.

## Quick Runbook

Before starting work:

```bash
pnpm dogfood:start
```

If the previous test database should be moved aside first:

```bash
pnpm dogfood:start:clean:preview
pnpm dogfood:start:clean
```

В течение дня:

- начни блок: введи название дела и нажми `Enter`;
- переключись: введи следующее дело в `Переключиться на...` и нажми `Enter`;
- фиксируй входящие отвлечения в `Зафиксировать отвлечение...`, не останавливая текущий блок;
- добавляй заметки уровня дня в `Добавить событие дня...`, если наблюдение относится ко дню, разрыву, буферу или восстановлению, а не к одному конкретному делу;
- останавливай блок с короткой заметкой через `Enter` в поле stop-note;
- смотри короткий счётчик `12m Focus` в строке меню macOS, пока блок идёт;
- скрывай и показывай приложение через значок в строке меню, global shortcut
  (`Ctrl+Shift+Space`, запасной `Ctrl+Option+Space` или `Cmd+Option+Space`)
  или `Esc`, если не открыт диалог.

В конце дня:

- начни вечернее закрытие из `Проверка перед отчётом`, нажав `Начать закрытие дня`;
- считай подсказку панели источником правды для следующего шага: сначала красные блокеры, затем жёлтые проверки, затем финальный отчёт;
- сначала закрой жёсткие блокеры: останови активный фокус, сними зависший активный статус с дела и выполни обязательные review-действия;
- используй `Объяснить` на пунктах про разрывы, если нужно добавить объясняющее событие дня;
- осознанно принимай optional-проверки, которые намеренно остаются как есть: `Зоны верны`, `Инбокс проверен`, `Пути проверены`, `Окно проверено`, `Бейджи верны`, `Трекинг верен` или `Оставить открытыми`;
- используй `Всё проверено` только когда все оставшиеся жёлтые пункты действительно можно принять как есть; Timeskein показывает этот shortcut только для безопасных optional-проверок;
- нажми `Копировать отчёт` в Today и вставь dogfood-отчёт в дневную заметку;
- если кнопка говорит `Копировать черновик`, сначала останови активный фокус-блок или сними активный статус с дела; черновик может начать замер закрытия, но завершает его только финальный отчёт;
- если кнопка говорит `Копировать с проверками`, обработай или осознанно прими оставшиеся review-пункты;
- используй `Копировать день`, когда нужна только сырая картина дня;
- если clipboard недоступен, скопируй выделенный Markdown из резервного поля;
- если нужен сохранённый Markdown-след, выполни `pnpm dogfood:finish:save`; команда сохранит дневной отчёт и RC-check;
- если UI copy не сработал, выполни `pnpm dogfood:finish > timeskein-dogfood-report.md`;
- если нужна только сырая картина дня, выполни `pnpm export:focus-day > timeskein-day.md`;
- если Timeskein сам создавал трение, выполни `pnpm dogfood:metrics` и `pnpm export:app-events`, чтобы посмотреть локальную техническую телеметрию.

The active daily-control goal requires the measured closure duration to be at most
10 minutes. `Копировать отчёт`, `pnpm dogfood:finish:save`, `pnpm dogfood:rc-check`,
and `pnpm dogfood:goal-check` include a `Day closure duration measured` row.

Saved dogfood reports and RC checks can contain personal or internal work context. They are local evidence files and are ignored by git.

## Goal

Timeskein is ready for regular use when it can capture a workday without side tracking:

- какие фокус-блоки были в течение дня;
- к каким делам они относились;
- какие описания дел были важны для дневного контекста;
- какие timestamped-события дня были записаны;
- какие timestamped-события дел были записаны;
- сколько длился каждый блок;
- где были значимые разрывы;
- сколько активного фокус-времени было в дне.

## Before the Day

Run the start gate:

```bash
pnpm dogfood:start
```

It checks the real local database first, then checks that no old `timeskein-desktop` process is running. After that it runs preflight, opens the macOS app if all gates pass, and waits for the embedded agent to respond.
If Timeskein is already running, the start gate refuses to continue. Quit the existing app first so the dogfood day uses the freshly built app.
If old `agent.lock` / `agent.port` files are left behind, the app probes the recorded port and starts a fresh embedded agent when the old one is not responsive.
If you intentionally want a clean trial database, run `pnpm dogfood:start:clean`. It moves the current SQLite files to timestamped backup names, then runs the same start gate.
To preview that clean start without moving files, opening the app, or running preflight:

```bash
pnpm dogfood:start:clean:preview
```

Expanded form:

```bash
pnpm dogfood:ready
pnpm open:macos-app -- --check-running-only
pnpm dogfood:preflight
pnpm open:macos-app
pnpm dogfood:status
```

If readiness reports active focus, active Work Items, duplicate titles, or existing blocks for today, fix that before treating Timeskein as the source of truth for the day. The readiness report includes exact next commands and shows whether the embedded agent or app process is already alive.
When readiness is clean, the same report prints the next start command and the `Памятка закрытия дня` checklist for the next dogfood day. Use it as the morning reminder for the paths that must be intentionally exercised before the evening `finish:save` step tells you whether to return to review or run the final `goal-check`. If `goal-check` is launched too early, it repeats the saved report next action instead of leaving you to reopen the Markdown.

The default readiness mode is a clean start gate. After the day already has real focus blocks, use continue mode for a health check:

```bash
pnpm dogfood:ready -- --mode continue
```

Continue mode allows existing focus blocks and one coherent active focus block linked to exactly one active Work Item. It still rejects duplicate titles and active-state split brain.

If Timeskein was quit during an already started dogfood day, reopen it through the continue gate:

```bash
pnpm dogfood:continue
```

This runs readiness in continue mode, checks for an already running app process, runs preflight, opens the packaged app, and waits for the embedded agent to respond.

If the readiness report shows existing blocks for today and you want a clean trial, prefer resetting the trial database. If it shows only an old active focus block and no existing day blocks, close only that active block:

```bash
pnpm dogfood:stop-active
pnpm dogfood:stop-active -- --apply
pnpm dogfood:ready
```

The first command is a dry run. It does not remove today's existing blocks; it only plans to stop active focus sessions and clear active Work Items. For a clean one-day trial, reset the database instead.
When Timeskein is running and the agent responds, the applied stop uses the local agent API. When the agent is not responsive and no app process is running, it falls back to direct SQLite update. If the app process is still alive but the agent is not responsive, the script refuses without `--force`. Applied stops add a note to the stopped block: `closed by dogfood:stop-active` by default, or a custom value passed with `--note`.

For a clean trial database, quit Timeskein and move the current SQLite files aside:

```bash
pnpm dogfood:reset-db
pnpm dogfood:reset-db -- --apply
pnpm dogfood:ready
```

The first command is a dry run. The second command moves `timeskein.db` and its SQLite sidecar files to timestamped backup names; it refuses to run while the embedded agent or app process appears to be alive unless `--force` is passed.
The one-command equivalent for the real dogfood start is:

```bash
pnpm dogfood:start:clean
```

Preview it first with:

```bash
pnpm dogfood:start:clean:preview
```

Build or reuse the current macOS app:

```bash
pnpm dogfood:macos
```

This is a low-level rebuild-and-open helper for development/manual debugging.
Do not use it as the normal dogfood day entry point: it does not inspect the
real day state before opening the app. Use `pnpm dogfood:start` for a clean
day start and `pnpm dogfood:continue` to reopen an already started day.

If the shell says `permission denied` for `Timeskein.app`, the app bundle was executed as a file. Use `open .../Timeskein.app` or run the binary directly:

```bash
target/release/bundle/macos/Timeskein.app/Contents/MacOS/timeskein-desktop
```

Check the basics before starting work:

- Timeskein opens from the menu bar item.
- The menu bar item shows the active focus duration while a block is running.
- `pnpm dogfood:status` reports `Status: READY`.
- The window can be moved by dragging the header.
- The window can be hidden with `Esc` when no dialog is open and shown again.
- Today is visible.
- The divider above Work Item search can resize the Today list; double-click resets it.
- There is no unexpected active focus block from a previous experiment.

## Next Dogfood Focus

The next dogfood day must verify the post-baseline daily-control loop, not only
that the timer still works. During the day, deliberately exercise these paths
when the real situation appears:

- open, hide, and restore Timeskein through the menu bar, the registered global
  shortcut (`Ctrl+Shift+Space`, запасной `Ctrl+Option+Space` или
  `Cmd+Option+Space`), `Esc`, Command+Tab, and the normal app entrypoint; the
  final telemetry should include non-zero show and hide requests from window
  entrypoints;
- start one new Work Item by typed title and continue one existing Work Item
  from the list;
- after a touched Work Item has focus time, check that its card shows today's
  tracked time and total tracked time in the Work Item list, then accept that
  review item before the final report;
- use at least two Activity Zones, with one non-work zone such as `recovery`,
  `idle`, `coordination`, or `personal`;
- add one Day Event with an explicit zone;
- use `Записать` on a significant gap or open gap, then edit the prepared Day
  Event text or zone before the final report;
- add or promote one timestamped Work Item Event if a detail matters for
  evening analysis;
- create at least one capture during an active focus block and resolve,
  convert, or explicitly accept it as follow-up in the review checklist;
- intentionally correct one safe tracking detail before final copy, such as a
  stopped block note, Work Item assignment, split point, or Activity Zone.
- at evening review, click `Начать закрытие дня`, then reach final `Копировать отчёт`
  in 10 minutes or less without needing Codex to explain the next action.

At evening review, the goal is not a perfect day. The goal is a report that lets
the day be discussed without reconstructing the timeline from memory. `Copy
Report`, `pnpm dogfood:report`, and `pnpm dogfood:finish:save` include an
`Аудит закрытия дня` section before the raw focus data, so weak evidence is
visible during the normal report flow, not only in the separate RC check.
With `--save`, the separate RC check is saved automatically next to the day report.

## Readiness Audit

Current status: the macOS dogfood release baseline was accepted on 2026-07-03. Timeskein is usable as the primary daily personal focus tracker, with known limitations documented in [Dogfood Release Baseline](dogfood-release-baseline.md).

| Requirement | Evidence before dogfood | Dogfood check |
| --- | --- | --- |
| Fast automated regression suite | `pnpm test` runs contracts build, TypeScript typecheck, Rust agent tests, mock-store tests, mock API smoke, and key SQLite/report smoke checks; `pnpm dogfood:preflight` also validates opskarta roadmap state | The local baseline and roadmap are green before the day starts |
| Fast start by title | `pnpm smoke:focus-api` and `pnpm smoke:macos-app` verify `focus.start` creates or reuses a Work Item | Starting a block feels cheap enough during real work |
| No duplicate Work Items by title | Smoke checks `focus.start` and `work_item.create` title reuse | No duplicate Work Items appear from normal typing |
| One active timer and one active Work Item | Smoke checks switching by title, by Work Item state, deleting the active Work Item, SQLite single-active guards, and startup normalization | No visible split brain while switching tasks |
| Stop and later continue same Work Item | Smoke checks repeat `focus.start` with the same title | Continuing yesterday/today items is discoverable |
| Show, hide, move window | Implemented in macOS shell and header drag; show and hide request telemetry is recorded for window entrypoints | Window behavior does not irritate during the day and telemetry proves those entrypoints were exercised |
| Today block list and totals | `focus.list` and UI show block duration, time range, stop note, work focus, total tracked time, zones, and entrances | The list matches remembered work blocks |
| Post-factum correction | `cargo test -p timeskein-agent`, `pnpm smoke:corrections-api`, and `pnpm smoke:macos-app` verify missed-block creation, update, split, reassignment, Work Item edit, and corrected day-list data | Wrong or missing Work Item intervals can be fixed before copying the final report |
| Significant gaps | UI and Markdown show gap ranges of 20+ minutes | Long breaks and lost intervals are visible enough |
| Capture Inbox | `pnpm smoke:capture-api`, `pnpm smoke:mock-api`, and `pnpm smoke:macos-app` verify capture create/list/update/delete/resolve/convert/append-event without interrupting focus | Incoming events can be remembered and cleaned up without switching away from the current block |
| Markdown export | `Копировать отчёт` exports timeline, `По делам`, zone totals, `События дня`, `События дел`, gaps, interruption history, open captures, review checklist, app telemetry, and review prompts; `Копировать день` exports the raw day picture; failed clipboard writes show selected Markdown; `pnpm smoke:export-focus-day` and `pnpm smoke:dogfood-report` verify SQLite fallbacks | Copied note is enough for evening analysis |
| App friction telemetry | `app_events` stores local technical events, `pnpm smoke:app-events` verifies metrics/export, and `pnpm dogfood:report` includes `Телеметрия приложения` with both window show and hide request counts | Start/switch/stop/copy/API/window friction is visible without relying only on memory |
| Evening closure duration | `day_closure_started` and `day_closure_completed` telemetry is included in UI/CLI reports, RC check, and final goal check | Closing the day takes at most 10 minutes and does not require Codex to interpret the review panel |
| macOS app with embedded agent and SQLite | `pnpm smoke:macos-app` verifies app launch, SQLite health, focus flow, stale lock/port recovery, and active focus restore after app restart | The real app survives normal workday use |

The dogfood goal is complete only after a real day produces a copied Markdown day note that is useful for analysis.

The first real dogfood day met this gate:

- 6:11:08 active focus
- 20 entrances
- seven Work Items
- four significant gaps
- usable Work Item totals and `Телеметрия приложения`

Product friction found during the day is tracked in the roadmap. The most important next dogfood check is whether Capture Inbox makes incoming events cheap to remember without interrupting the current focus block.

The second real dogfood day on 2026-07-02 showed that the core timer loop was enough to stop using Session in parallel:

- 6:31:31 active focus
- 19 entrances
- 12 Work Items in the day report
- two significant gaps and one open gap
- no API errors, copy failures, duplicate-title groups, or active-state split brain in the saved report

The third real dogfood day on 2026-07-03 closed the Capture Inbox release-candidate gap:

- 5:47:04 active focus
- 11 entrances
- eight Work Items in the day report
- two significant gaps
- four captures created during active focus
- two captures resolved, one converted to a Work Item, one left open as visible follow-up
- no API errors, copy failures, capture failures, duplicate-title groups, or active-state split brain

Remaining friction is tracked as post-baseline work. Post-factum focus correction, Work Item title/basic-field editing, today/total time columns, macOS window restore, native menu bar status refresh, and window show/hide request telemetry are implemented. The next dogfood day should verify the macOS entry fixes in real use through both show and hide request events.

The 2026-07-06 post-baseline daily-control day produced strong evidence for the
daily trace, but it did not pass the current strict goal gate because closure
duration was not measured. The next dogfood closure must specifically verify the
evening ritual: start closure from the review panel, handle blockers and accepted
review items, copy the final report, then pass `pnpm dogfood:goal-check` with
`Day closure duration measured` at 10:00 or less.

For the stricter daily-use gate, use [Dogfood Release Candidate](dogfood-release-candidate.md). The day protocol explains how to run the test; the release-candidate gate decides whether the current baseline is good enough to replace Session.

## During the Day

Start a focus block from the input:

1. Open Timeskein.
2. Type the name of the thing you are starting.
3. Press `Enter` or click `Start`.

Expected behavior:

- If a Work Item with the same title already exists, Timeskein reuses it.
- If no Work Item exists, Timeskein creates one.
- Starting a new focus block stops the previous active block.
- There is only one active Work Item and one active timer.
- Today and the Markdown export include blocks that overlap the selected local day, even when a block started before the day boundary. These show up as `Day-Boundary Blocks`; the duration is counted as that day's clipped contribution.

Switch directly to another item:

1. Type the next thing into `Переключиться на...`.
2. Press `Enter` or click `Переключить`.

This stops the current block without a note and starts a new linked block. Use `Stop` first if the previous block needs a note.

Continue an existing item:

1. Use `Недавние`, `Сегодня`, `Закреплённые`, or `Все` to narrow the Work Item list if needed.
2. Select the Work Item.
3. Leave the focus input empty and press `Space`, or click `Начать` / `Переключиться`.

Faster path: double-click a Work Item to start or switch focus to it.
Use `Alt+1`, `Alt+2`, `Alt+3`, and `Alt+4` to switch `Недавние`, `Сегодня`, `Закреплённые`, and `Все` without leaving the keyboard.
Typed search can still find old Work Items when the current mode is too narrow.

Changing a Work Item state to `Active` is another way to start or switch focus:

- pressing `1` on a selected Work Item starts or switches to that Work Item;
- choosing `Active` in the state menu does the same;
- moving the currently active Work Item to any other state stops the current focus block.

Deleting the currently active Work Item also stops its current focus block first.

Capture an incoming event without switching focus:

1. Type the reminder into `Зафиксировать отвлечение...`.
2. Press `Enter` or click `Записать`.
3. Continue the current focus block.

Expected behavior:

- the active focus timer keeps running;
- the capture appears in `Инбокс`;
- `Готово` resolves it when no further action is needed;
- `Править` cleans up the text while it is still open;
- `Удалить` removes an open capture that is just noise;
- `В дело` converts it into a Work Item for later handling;
- `В событие` сохраняет его как timestamped-событие дела, если это контекст текущего или выбранного дела.

Stop a focus block when the contact with the work stops:

1. Add a short stop note if it will help evening review.
2. Press `Enter` in the stop-note field or click `Stop`.

Use stop notes for facts, not narration:

- `blocked by access`;
- `waiting for answer`;
- `lost context after meeting`;
- `done enough for today`.

Не используй статус дела как отдельный таймер. В текущей модели `active` означает: "по этому делу прямо сейчас идёт таймер".
Создание дела через диалог `+` не запускает таймер, если явно не выбран `Active`.

## Evening Review

At the end of the day:

1. Open Timeskein.
2. Check Today work focus, total tracked time, zones, and entrance count.
3. Clear or consciously accept every `Проверка перед отчётом` item.
4. Click `Копировать отчёт`.
5. Paste the Markdown dogfood report into the day note or analysis thread.

Use `Копировать день` only when the raw day picture is enough.
If Today or the report shows `Открытый разрыв`, there was a significant interval after the last stopped block with no active focus block. Treat it as either a real break or a lost-tracking interval during review.
If the report shows `Открытые отвлечения`, edit, delete, resolve, convert, or explicitly leave them open before considering the day fully reviewed.
If Today shows `Проверка перед отчётом` during the day, it stays compact until `Начать закрытие дня`: this is a reminder that the evening ritual exists, not a running list of accusations.
If Today or the report shows the full `Проверка перед отчётом`, use it as the minimal evening queue: active-state blockers under `Сначала закрыть` must be cleared, `Дописать или исправить` items should produce a small artifact, and `Осознанно проверить` items can be accepted when the data is already honest enough.
Use `Ближайшее действие` as the current step. It appears in the panel, copied Markdown, and CLI dogfood report, so a draft report can still guide the next action without reconstructing the whole checklist from memory.
Проверка также подсвечивает слабые доказательства дня: все блоки попали в одну Activity Zone, нет non-work времени, нет заметок/событий дел для контекста или нет следа проверки коррекций. Если таймлайн уже точный, используй `Трекинг верен`, чтобы в отчёте осталось доказательство осознанной проверки. Если дню не хватает контекста, используй `Добавить контекст`, чтобы подготовить короткое событие дня вместо поздней реконструкции по памяти.
Когда все оставшиеся жёлтые пункты — optional accept-as-is проверки, Timeskein показывает `Всё проверено`. Используй это только после короткой осознанной проверки; shortcut не появляется для разрывов, где нужно `Объяснить`, контекстных пунктов, где нужно `Добавить контекст`, или проверок без безопасного автоматического действия.
Если фокус-блок ещё идёт, у дела всё ещё стоит `active`, или review-проверки не закрыты, UI покажет `Копировать черновик` или `Копировать с проверками`, а Markdown-статус будет `черновик`. Останови активный блок, сними активный статус с дела или обработай/прими оставшиеся проверки перед тем, как считать отчёт финальным артефактом дня.
If clipboard access is denied, Timeskein shows a selected text box with the Markdown. Copy it manually from there.

If the UI copy path is unavailable, export the same raw day picture from SQLite:

```bash
pnpm export:focus-day > timeskein-day.md
```

For the preferred evening review artifact, generate the dogfood report:

```bash
pnpm dogfood:finish:save
```

This writes `timeskein-dogfood-report-YYYY-MM-DD.md` in the current directory. To print the report to stdout instead:
It also writes `timeskein-dogfood-rc-check-YYYY-MM-DD.md`, so the evening evidence package has both the readable report and the stricter RC audit.

```bash
pnpm dogfood:finish > timeskein-dogfood-report.md
```

`dogfood:finish` refuses to produce a final report while a focus block or Work Item is still active, or when there are no focus blocks for the selected date.
Дневной отчёт включает раздел `Заметки дел` для затронутых дел с непустой заметкой. Это текущий контекст дела. Для наблюдений, привязанных к конкретному моменту дня, используй timestamped-события дел; они попадают в отдельный раздел `События дел`. Если событие записано с ошибкой или не в той форме, исправь или удали его в панели `События дел` перед копированием финального отчёта.
Используй `Добавить событие дня...` для наблюдений, которые объясняют день, но не принадлежат одному делу: буфер перед тяжёлой встречей, recovery debt, напоминание о коррекции трекинга или причина разрыва. Выбирай зону явно, если наблюдение относится к `coordination`, `recovery`, `idle` или `personal`; иначе Timeskein использует контекст текущего фокуса или выбранного дела. У значимых разрывов и текущего открытого разрыва есть shortcut `Записать`, который готовит событие дня с интервалом, длительностью и `Восстановление` как начальной зоной. Эти заметки попадают в `События дня`, их можно редактировать, менять им зону или удалять перед копированием финального отчёта.
The dogfood report also includes `История отвлечений` for every capture created during the selected day, including captures that were already resolved or converted. `Открытые отвлечения` remains a separate action list for unresolved inbox entries.
For the release-candidate verdict, inspect whether `История отвлечений` rows were created during a real focus block. A capture made after stopping all work proves the inbox can store text, but it does not prove interruption handling during focus.

The dogfood report includes a `Телеметрия приложения` section. Use it to check whether Timeskein caused tracking friction:

- start, switch, and stop request counts;
- start/stop/copy/API errors;
- window show/hide, show/hide request, and drag counts;
- average delay from start request to started focus;
- likely show-to-start friction gaps;
- repeated attempts to start the already active Work Item;
- stale embedded-agent runtime recovery events.

For deeper inspection:

```bash
pnpm dogfood:metrics
pnpm export:app-events
```

Telemetry stays local in SQLite. Event payloads are technical only; raw Work Item titles, notes, URLs, and typed text should not appear there.

For a Dogfood Release Candidate day, rerun the RC evidence check when you want to inspect it without re-saving the day report:

```bash
pnpm dogfood:rc-check:save
```

The command prints hard blockers and review items for the Session replacement gate. Its Russian `Сводка доказательств` includes total tracked time, work focus, non-work tracked time, Activity Zone coverage, Work Item notes/events, Work Item today/total badge review acceptance, Capture Inbox coverage, typed entry and selected/list continuation evidence, correction telemetry, window telemetry with both show and hide request counts, and product-friction counters. The same `Аудит закрытия дня` framing maps the day to the active daily-control goal: focus blocks, Work Item totals plus UI badge review, Activity Zones, notes/events, gaps/captures, entry-path evidence, window friction evidence, tracking correction evidence, and hard blockers. The readable daily report keeps this audit focused on evening closure; manual local gates are checked by RC/goal-check scripts instead. The Work Item totals audit row moves to `проверить` when touched Work Item time badges were not explicitly accepted from the review checklist. The gaps/captures audit row moves to `проверить` when significant gaps are unexplained, captures remain open without explicit acceptance, no captures were created, or captures were not linked to active focus.
Before marking the daily-control goal complete, run the final gate after `pnpm dogfood:finish:save`. For the real local database it first checks that both saved evidence files exist, that the saved report status is final, and that the saved report carries the current review checklist format, then runs `pnpm test`, `pnpm dogfood:preflight`, and the strict RC check on the same code. If the saved evidence is missing, stale, or still draft, the command stops early with `Финальная проверка пока не готова`, repeats the saved report next action when available, and prints a short `Что ещё осталось` list:

```bash
pnpm dogfood:goal-check
```

The final goal gate also checks that the saved report contains the grouped `Проверка перед отчётом` section and the `Ближайшее действие` line. If the saved file still has an old flat checklist or lacks the next-action line, regenerate the evidence with `pnpm dogfood:finish:save -- --date YYYY-MM-DD`.
When measured closure evidence is present and every `Аудит закрытия дня` row is already `ок`, `pnpm dogfood:finish:save` prints the exact dated `pnpm dogfood:goal-check -- --date YYYY-MM-DD` command for the final gate. If the saved report is still a draft, the command prints its saved status explicitly and repeats `Ближайшее действие` from the report under `Что ещё осталось`, so the next action stays visible even from the terminal. If measured closure exists but audit rows are still pending, it prints those pending rows and points back to `Проверка перед отчётом`.

The RC-check scripts read old SQLite databases defensively. If a previous dogfood day was captured before Activity Zone columns existed, reports fall back to `Work` rather than crashing. A fresh dogfood day should still be started through the app so real migrations run before new data is captured.

For a previous date:

```bash
pnpm export:focus-day --date 2026-06-30 > timeskein-day.md
pnpm dogfood:finish -- --date 2026-06-30 > timeskein-dogfood-report.md
pnpm dogfood:rc-check -- --date 2026-06-30 --save
pnpm dogfood:goal-check -- --date 2026-06-30
```

The dogfood report includes the focus-day export and prompts for:

- Is every real focus block represented?
- Does `По делам` match where the day actually went?
- Are the Work Item titles understandable the next day?
- Are there duplicate Work Items that should have been reused?
- Are long gaps visible and plausible?
- Did stopping and continuing the same Work Item feel cheap enough?
- Did the app itself create friction that pushed tracking away?
- Where did entry cost appear before starting the next block?
- Does `Телеметрия приложения` confirm the remembered friction, or show hidden friction such as repeated show-without-start attempts?
- Did Capture Inbox prevent interruption, or did captures become another unresolved pile?

## Success Criteria

The dogfood day succeeds if the copied Markdown is enough to discuss:

- where active work time went;
- which Work Items moved;
- which day-level events explain buffers, recovery, gaps, or tracking corrections;
- when the day fragmented;
- where entry cost or switching cost appeared;
- where Timeskein itself created start, switch, stop, copy, or window-management friction;
- whether incoming events were captured and reviewed without derailing current work;
- what must be improved before using Timeskein daily.

The dogfood day fails if any of these happens often enough to break trust:

- focus blocks are missing;
- duplicate Work Items appear from normal use;
- more than one active timer or active Work Item appears;
- continuing an earlier item is hard to discover;
- Today cannot explain the day without memory reconstruction;
- the app window is annoying to show, hide, or move.

## Known Limits for This Trial

- There is no pause/resume/cancel model yet. Stop and start again instead.
- Stopped focus blocks can be edited, re-zoned, reassigned, or split from the Today list. The correction workflow is basic: there is no drag timeline or bulk edit yet.
- Capture Inbox is compact. It can create, edit/delete open captures, resolve, convert captures, and append them as Work Item Events, but it has no separate capture history screen yet.
- Activity Zones are copied from the Work Item into each focus block. A Work Item named `Break` should default to `recovery` or `idle`; an individual stopped block can still be corrected later. Non-work zones contribute to `Всего учтено`, but not to `Рабочий фокус`.
- Work Item notes are a single mutable field; timestamped observations are separate Work Item Events. Day-level observations are separate Day Events. User-authored Day Events and Work Item Events can be edited or deleted, while generated system history is not exposed as an editable log.
- There is no automatic active-window detection.
- There is no synchronization between devices.
- Browser development mode uses mock data; the real dogfood trial should use the macOS app.
- The export is Markdown copy only, not a full reporting screen.
- App telemetry has CLI/report output only; there is no in-app diagnostics screen yet.
