# Current Implementation

## Status

Last updated: 2026-07-08.

This document describes what the repository actually runs today. Target architecture and future plans remain in RFCs and roadmap documents.

## Runtime Baseline

- Node.js 24+
- pnpm 11+
- Rust latest stable
- macOS is the only native desktop target currently verified

The root package declares `packageManager: pnpm@11.7.0` and requires Node 24 / pnpm 11.

## Working Modes

### Browser Development Mode

Browser mode is for UI development. It uses the mock server and does not persist data to SQLite.

```bash
CI=true pnpm install
pnpm --filter @timeskein/contracts build
pnpm mock-server
pnpm --filter @timeskein/desktop dev:frontend
```

- UI: `http://localhost:5173`
- Mock API: `http://127.0.0.1:3456/api`

### macOS Desktop App

The macOS Tauri app embeds the Rust agent in the same process.

```bash
pnpm --filter @timeskein/desktop dev
```

For release-style local build:

```bash
pnpm --filter @timeskein/desktop build
```

Build output:

```text
target/release/bundle/macos/Timeskein.app
```

## Agent Integration

The Rust agent is still a separate crate (`apps/agent`), but the macOS desktop shell starts it as an embedded runtime.

Startup flow:

1. Tauri setup starts the embedded agent.
2. The agent opens SQLite in the user data directory.
3. The agent binds `127.0.0.1:0`, so the OS chooses a free local port.
4. The agent writes the selected port to `agent.port`.
5. The frontend calls the Tauri command `get_api_url`.
6. The frontend sends Local API RPC requests to the returned URL.

If startup sees an existing `agent.lock` / `agent.port`, the desktop shell probes the recorded port with `agent.status` before reusing it. If the port is stale, the shell removes the runtime files and starts a fresh embedded agent.

Data path on macOS:

```text
~/Library/Application Support/Timeskein/
```

Important files:

```text
timeskein.db
agent.port
agent.lock
```

Browser mode does not use this embedded agent. It keeps using the mock server at `127.0.0.1:3456`.

## Verified Checks

The current local baseline has been verified with:

```bash
CI=true pnpm install --frozen-lockfile
pnpm --filter @timeskein/contracts build
pnpm --filter @timeskein/desktop build:frontend
pnpm typecheck
cargo test -p timeskein-agent
cargo check -p timeskein-agent
cargo check -p timeskein-desktop
pnpm --filter @timeskein/mock-server test
pnpm test
pnpm smoke:focus-api
pnpm smoke:corrections-api
pnpm smoke:capture-api
pnpm smoke:day-events-api
pnpm smoke:mock-api
pnpm --filter @timeskein/desktop build
pnpm smoke:macos-app
pnpm smoke:export-focus-day
pnpm smoke:app-events
pnpm smoke:dogfood-report
pnpm smoke:dogfood-finish
pnpm smoke:dogfood-status
pnpm smoke:dogfood-ready
pnpm smoke:dogfood-goal-check
pnpm smoke:dogfood-rc-check
pnpm smoke:dogfood-reset-db
pnpm smoke:dogfood-start
pnpm smoke:dogfood-stop-active
pnpm smoke:open-macos-app
pnpm roadmap:validate
pnpm dogfood:preflight
```

Runtime smoke on macOS:

- `Timeskein.app` starts
- embedded agent creates `agent.port`
- `agent.status` returns `db_ok: true`
- `inventory.list` returns an empty list against the real SQLite-backed agent
- `focus.start`, `focus.stop`, `focus.list`, and Work Item focus switching work against the real SQLite-backed agent
- `pnpm smoke:macos-app` launches the packaged `.app` binary with a temporary home directory and verifies embedded-agent `agent.status`, `inventory.list`, focus start/stop/list, title reuse, focus switching, active Work Item deletion, and active focus restoration after app restart
- `pnpm smoke:macos-app` also verifies post-factum focus correction: missed stopped block creation, stopped block update, split, Work Item reassignment, Work Item edit, and day-list reflection
- `pnpm smoke:macos-app` also verifies Capture Inbox create/update/delete/resolve/convert/append-event while ensuring capture actions do not interrupt the active focus session
- `pnpm smoke:macos-app` also verifies Work Item Event add/update/delete/list against the packaged SQLite-backed app
- `pnpm smoke:macos-app` also verifies Day Event add/update/delete/list against the packaged SQLite-backed app while ensuring day notes do not interrupt the active focus session
- `pnpm smoke:macos-app` also verifies startup normalization of legacy active Work Items, orphan active focus sessions, stale `agent.lock` / `agent.port` recovery, and migration of older `app_events` kind constraints
- `pnpm smoke:export-focus-day` verifies the Russian fallback Markdown export, the raw `--internal` format used by scripts, Day Events, Work Item notes, timestamped Work Item Events for touched items, and legacy focus-session schemas without Activity Zone columns, against temporary SQLite databases
- `pnpm smoke:app-events` verifies the local app-event migration, metrics summary, and Markdown export against a temporary SQLite database
- `pnpm smoke:dogfood-report` verifies the evening dogfood report wrapper, Russian focus-data labels, Russian review checklist, Russian daily-closure check, Activity Zone evidence warnings, entry-path evidence prompts, Work Item time review prompts, correction evidence prompts, accepted correction review, accepted open-capture review, Day Events, Work Item notes, Work Item Events, interruption history, open captures, analysis prompts, and human-readable app telemetry section, including typed/selected entry and both window show and hide request evidence
- `pnpm smoke:dogfood-finish` verifies the end-of-day gate: no active focus session, no active Work Item, at least one focus block, and `--save` writing both the day report and closure check
- `pnpm smoke:dogfood-status` verifies the embedded-agent status checker against healthy and unhealthy temporary HTTP agents
- `pnpm smoke:dogfood-ready` verifies the real-database readiness checker against clean and contaminated temporary SQLite databases, including running-process visibility and the actionable next commands
- `pnpm smoke:dogfood-rc-check` verifies the closure-check evidence script against good, legacy-schema, open-capture, no-active-focus-capture, empty-day, duplicate-title, and active-session temporary databases, including Day Event evidence, strict review-item failure, and the Russian `Проверка закрытия дня`
- `pnpm smoke:timestamped-event-entry` verifies that timestamped Work Item event entry clears text only after successful append, keeps typed text after API failure, does not submit blank or pending drafts, and stores drafts separately by local day and Work Item
- `pnpm smoke:dogfood-reset-db` verifies dry-run, backup-reset behavior, and running-process refusal on temporary database files
- `pnpm smoke:dogfood-start` verifies the start gate against clean and contaminated temporary SQLite databases, including clean-start reset, without opening the app
- `pnpm smoke:dogfood-stop-active` verifies dry-run, direct SQLite fallback, running-process refusal, and running-agent API behavior for closing a stuck active focus block
- `pnpm smoke:open-macos-app` verifies that the macOS opener, `--check-only`, and `--check-running-only` refuse to reuse an already running `timeskein-desktop` process

Dogfood launch helper:

- `pnpm dogfood:start` checks the real local database and running-process guard first, then runs preflight, opens the macOS app when all checks pass, and waits for the embedded agent to respond
- `pnpm dogfood:continue` runs the same guarded app-opening path with readiness continue mode, so an already started Timeskein day can be reopened without resetting the database or bypassing duplicate-title and active-state checks
- `pnpm dogfood:start:clean` moves the current local SQLite files aside through the same guarded reset path, then runs the normal start check; `pnpm dogfood:start:clean:preview` prints the reset plan and checks non-mutating guards
- `pnpm dogfood:status` waits for the local embedded-agent port file and verifies `agent.status`
- `pnpm dogfood:finish` checks that the day can be closed with no active focus session or active Work Item, then prints the Markdown day-closure report; when closing is blocked, its Markdown diagnostic uses Russian headings, red-item explanations, 24-hour time, and a single `Ближайшее действие` before the fallback next-step list
- `pnpm dogfood:finish:save` runs the same end-of-day gate in the manual evening route and saves both `timeskein-dogfood-report-YYYY-MM-DD.md` and `timeskein-dogfood-rc-check-YYYY-MM-DD.md`; expected red states are soft-fail for this package script, so the user sees the blocked report and `Ближайшее действие` without pnpm `[ELIFECYCLE]` noise. Direct `node scripts/dogfood-finish.mjs --save` and `pnpm dogfood:finish:save:strict` remain strict for automation. If the saved report still lacks passing measured-closure evidence, it prints `До финального отчёта` with the current `Статус закрытия`, the next measured-closure step, the saved draft status when the report is not final, plus `Ближайшее действие`, `Сводка проверки`, and the one-click `Всё проверено` hint when remaining safe review checks can be accepted together; if closure was already started but not completed, it tells the user to continue `Проверка перед отчётом` instead of starting the ritual again, and explains that an over-10-minute closure should be closed calmly but proven on the next dogfood day. If measured closure passed but `Проверка закрытия дня` still has pending rows, the terminal stays compact: it repeats `Статус закрытия`, draft status, `Ближайшее действие`, `Сводка проверки`, and the bulk-accept hint instead of dumping the technical audit rows; detailed rows remain in the saved report and strict checks. Only when measured closure and the check are clean does it print `Статус закрытия`, the short closure verdict, the no-Codex reminder, and the exact `pnpm dogfood:goal-check -- --date YYYY-MM-DD --no-codex-guidance` command
- `pnpm dogfood:preflight` runs the local checks needed before trusting a real Timeskein day, including opskarta roadmap validation, Work Item list mode tests, isolated mock API, export, and report smoke checks
- `pnpm dogfood:ready` inspects the real local SQLite database for active sessions, active Work Items, duplicate titles, existing focus blocks for today, agent responsiveness, and running app processes; when the day is not ready it prints exact stop/reset commands and, if the day already has focus blocks, points to `pnpm dogfood:ready -- --mode continue` for an already started real Timeskein day; when the day is ready it prints the next start command plus `Памятка закрытия дня`; the checklist tells the user to follow the UI `Ближайшее действие` until final `Копировать отчёт`, use the selected-Markdown `Command+C` fallback if clipboard copy is refused, avoid asking Codex to interpret the closure panel, treat short closure notes as optional, use `dogfood:goal-check:status` for calm readiness inspection, and treat the terminal `Статус закрытия: завершено`, `Короткое закрытие ... да (...)` verdict plus the exact strict `dogfood:goal-check -- --date YYYY-MM-DD --no-codex-guidance` command as the proof path instead of remembering when to return to review or run the final check. User-facing readiness text says `День Timeskein уже идёт` and uses 24-hour time instead of AM/PM.
- `pnpm dogfood:rc-check` prints the closure-check `Сводка доказательств`, `Проверка закрытия дня`, red items, review items, and a short `Итог проверки` for the saved Timeskein day; the package command soft-fails on expected not-ready states, so manual inspection through pnpm does not add `[ELIFECYCLE]` noise. It no longer asks the user to fill a yes/no verdict questionnaire during closure. The summary includes total tracked time, working occupancy (`Work + Coordination`), executive work (`Work`), non-work tracked time, Activity Zone coverage, Work Item notes/events, Work Item time review acceptance, Capture Inbox coverage, typed entry and selected/list continuation evidence, correction telemetry, window telemetry with both show and hide request counts, and product-friction counters
- `pnpm dogfood:rc-check:save` saves the same closure-check evidence again when it needs to be inspected without regenerating the day report; like `dogfood:rc-check`, the package command soft-fails for manual inspection
- `pnpm dogfood:rc-check:strict` uses the same evidence but exits with code 1 when any review item remains, for the final daily-control goal closure check
- `pnpm dogfood:goal-check` runs the final closure check for the active daily-control goal: for the real local database it requires saved day report and closure-check files for the selected date, verifies that the saved report status is final, that the report contains `Короткое закрытие` with `Статус закрытия`, `Данным можно доверять: да`, and `Закрытие уложилось в 10 минут: да`, that it contains the grouped `Проверка перед отчётом` checklist with `Ближайшее действие` and `Сводка`, and that the command was run with `--no-codex-guidance`; then it runs `pnpm test`, `pnpm dogfood:preflight`, and strict closure evidence for the selected Timeskein day; if saved evidence is missing, stale, still draft, or lacks the no-Codex confirmation, the saved-evidence step prints `Финальная проверка пока не готова`, repeats the saved report next action and summary when available, shows `До финальной проверки`, and exits without a JavaScript stack trace. The nested saved-evidence check is invoked through an absolute script path, so running the parent command from another directory does not leak a Node module-resolution stack trace.
- `pnpm dogfood:goal-check:status` is the soft read-only companion for manual use: it checks only saved evidence readiness, prints either `Финальная проверка пока не готова` with the next strict command or a ready message with `pnpm dogfood:goal-check -- --date YYYY-MM-DD --no-codex-guidance`, exits 0 for expected not-ready states, and never runs `pnpm test`, `dogfood:preflight`, or strict closure checks. For incomplete evidence, status keeps the manual route compact: it repeats the report next action, summary, `Всё проверено` hint when safe review checks can be accepted together, live-report/save/continue hints when useful, and hides the detailed audit-row list behind a short `Подробности` note. The detailed duplicated-row diagnostics remain in strict saved-evidence checks for automation and debugging. If saved telemetry shows an open day-closure attempt, status says to continue the existing closure rather than pressing `Начать закрытие дня` again. `dogfood:rc-check` uses the same distinction in its own review item: no closure start means “start closure”, while an open start means “continue review and copy the final report”.
- `pnpm dogfood:reset-db` moves the real local SQLite database and sidecar files aside only when `--apply` is passed; it refuses while the agent or app process appears alive unless `--force` is passed
- `pnpm dogfood:stop-active` stops active focus sessions, writes a stop note, and clears active Work Items only when `--apply` is passed; it uses the running agent API when available and direct SQLite only when neither agent nor app process is alive, unless `--force` is passed
- `pnpm dogfood:macos` rebuilds and opens the packaged app as a low-level development/manual-debugging helper; normal dogfood days should use `dogfood:start` or `dogfood:continue` because those commands inspect the real day state before opening the app
- `pnpm open:macos-app` refuses by default when `timeskein-desktop` is already running, so a dogfood start does not silently activate an old process; `--check-only` validates bundle plus guard without opening the app, and `--check-running-only` runs only the process guard before preflight has built the app
- `pnpm export:focus-day` prints a Russian Markdown day report from the local SQLite database as a fallback to UI copy; `--internal` keeps the raw labels for scripts such as `dogfood:report`
- `pnpm dogfood:metrics` prints Russian dogfood telemetry aggregates from the local SQLite app-event journal, including start/stop failure counts and accepted open-capture reviews; `--raw` keeps the older technical labels for scripts that parse the output
- `pnpm export:app-events` prints a Russian Markdown table of local technical app events for inspecting product friction after a dogfood day
- `pnpm export:app-events` prints a Markdown event table for deeper inspection of show/hide/start/switch/stop/copy/API behavior
- `pnpm dogfood:report` prints a Markdown day-closure report titled `Отчёт закрытия дня Timeskein`, with Russian focus data, a Russian review checklist, a Russian daily-closure check, Day Events, interruption history, open captures, human-readable app telemetry, and evening review prompts, marked as a draft if a focus block, Work Item, or review check still needs attention

Runtime smoke in browser/mock mode:

- mock server starts on localhost
- `pnpm test` runs the fast local suite: contracts build, TypeScript typecheck, Rust agent tests, mock-store tests, Work Item list mode tests, timestamped-event entry tests, mock API smoke, and key SQLite/report smoke checks
- `cargo test -p timeskein-agent` includes handler-level integration tests against a temporary SQLite database for focus start/switch coherence and post-factum correction, including adding a missed stopped block
- `pnpm --filter @timeskein/mock-server test` covers mock-store invariants for one-active focus, Capture Inbox non-interruption and cleanup, and correction add/update/split/edit reflection
- `focus.start`, `focus.stop`, `focus.list`, and Work Item focus switching work against the mock API
- `pnpm smoke:focus-api` verifies the same flow and refuses to run over an existing active focus session
- `pnpm smoke:corrections-api` verifies focus.create_stopped, focus.update, focus.split, Work Item edit, duplicate-title rejection, and corrected day-list data
- `pnpm smoke:capture-api` verifies Capture Inbox create/list/update/delete/resolve/convert/append-event without interrupting focus
- `pnpm smoke:day-events-api` verifies Day Event create/list/update/delete without interrupting focus
- `pnpm smoke:mock-api` starts an isolated mock server, runs `smoke:focus-api`, `smoke:corrections-api`, `smoke:capture-api`, and `smoke:day-events-api`, and stops it
- mock API also exposes `app_event.log`, `app_event.list`, and `app_event.summary`, including correction and correction-review telemetry counters
- manual browser UI smoke was checked on 2026-06-30: start by typed title, switch by typed title, stop with note, Today list, totals, and dogfood report Markdown with both Work Items

First real dogfood day:

- 2026-07-01 was tracked through Timeskein as the Session replacement
- Result: 6:11:08 active focus, 20 entrances, seven Work Items, four significant gaps
- The exported dogfood report was useful for discussing focus allocation, gaps, entry cost, and product friction
- App telemetry exposed two API errors from creating a Work Item directly in `Active`; this path is now covered by smoke tests and fixed in the agent
- The follow-up baseline adds Capture Inbox, so incoming events can be recorded during a focus block without turning them into timed work immediately

Second real dogfood day:

- 2026-07-02 was tracked through Timeskein without using Session in parallel
- Result: 6:31:31 active focus, 19 entrances, 12 Work Items, two significant gaps, one open gap
- The saved report had no API errors, copy failures, duplicate-title groups, or active-state split brain
- The report now includes Work Item notes for touched items, because those notes became important review context during the second day
- Capture Inbox was visible but not used; daily-use evidence therefore remains open until incoming-event capture is tested in real work

Third real dogfood day and release baseline:

- 2026-07-03 was tracked through Timeskein without Session in parallel
- Result: 5:47:04 active focus, 11 entrances, eight Work Items, two significant gaps
- Capture Inbox was used in real active-focus situations: four captures were created during active focus, two were resolved, one was converted to a Work Item, and one remained open as visible tail
- The saved report had no API errors, copy failures, focus start/stop failures, Capture Inbox failures, duplicate-title groups, or active-state split brain
- This day accepted the macOS dogfood release baseline: Timeskein is good enough to replace Session for daily personal use, with known limitations documented in `dogfood-release-baseline.md`
- The first post-baseline slice added correction of stopped focus blocks and Work Item title/basic-field editing, so wrong Work Item assignments can be fixed before copying the final report.

## Implemented Features

- Focus Session panel
- Start focus from text by finding or creating a Work Item with that title
- Create Work Item also reuses an existing normalized title instead of creating a duplicate
- Create dialog defaults new Work Items to `unknown`; choosing `active` is an explicit focus-start action
- Start focus session from the selected Work Item
- Press `Space` with an empty focus input to start or switch to the selected Work Item
- Double-click a Work Item to start or switch focus to it
- Stop the active focus block by pressing `Enter` in the stop-note field or by clicking `Stop`
- Add a missed stopped focus block from Today before copying the final report
- Correct a stopped focus block from the Today list: edit start/end/note/Work Item or split it into two blocks
- Switch directly to another focus title from the active focus panel
- Set a Work Item to `active` to switch focus to it
- Move the active Work Item to another state to stop the linked focus block
- Delete the active Work Item to stop the linked focus block before the item is removed
- Reuse an existing Work Item when the typed title matches an existing title
- At most one active Work Item is kept in sync with the active focus session
- 25-minute target with elapsed contact time and overflow display
- Manual stop with optional note
- Active focus session restored from SQLite after frontend/app restart
- Today's focus blocks with total tracked time, working occupancy, executive work, non-work tracked time, entrance count, Activity Zone, stop notes, and significant gap ranges of 20+ minutes
- Day views include focus blocks that overlap the selected local day; duration totals are clipped to the selected day window
- Today and Markdown export show an `Открытый разрыв` when no focus block is running and the interval after the last stopped block is at least 20 minutes
- Markdown reports use the corrected focus-session rows, so post-factum edits are reflected in copied day data
- UI and CLI day reports use Russian-facing dates, 24-hour clock time, and `сейчас` for an active block instead of `AM`/`PM` or `now`
- Today shows a Russian `Проверка перед отчётом` checklist for active-state red items, open captures, significant gaps, open gaps, Activity Zone coverage, non-work tracking, item day/total time visibility, capture coverage, item context coverage, entry paths, window entrypoints, and focus-correction evidence. Before `Начать закрытие дня`, the UI keeps this panel compact: it shows the closure prompt and one next action, but hides the full evening queue so the review does not become daytime background pressure. The Today report button starts as `Начать закрытие`; after closure starts it says `Закрыть проверки` and stays disabled until the report is final and review-clean, then becomes `Копировать отчёт`. In the ready state the prompt also names `pnpm dogfood:finish:save` as the command that saves evidence after the copied report. While closure is running, the prompt keeps the measured goal visible with `Закрытие идёт 7:00, цель — до 10:00`; if it already took longer than 10 minutes, it says that this day no longer proves the goal while still nudging the user to close the data calmly. After closure starts, the panel and copied/CLI Markdown checklist separate review items into `Сначала закрыть`, `Дописать или исправить`, `Осознанно проверить`, and `Готово`, so fix-up work stays visually distinct from optional accept-as-is checks. The panel, copied Markdown, and CLI report also show `Ближайшее действие` and `Сводка`: the first line names one next step, and the second line separates red items, fix-ups, and accept-as-is checks so a draft report does not force the user to parse the whole checklist. For current red items the user-facing line says `закрыть красный пункт`, and for review items or the final copy step it names the exact button or gesture, such as `Стоп`, `Объяснить`, `Управляемость`, `Время верно`, `Добавить блок`, or `Копировать отчёт`; the UI row plus copied and CLI Markdown repeat the matching action hint in every unresolved checklist row. An active focus block is the only red item while it is running: the linked active Work Item does not appear as a second red item until the focus is stopped, and a genuinely stuck active item gets the direct `Снять активность` action. Gap items can stage a Day Event through `Объяснить` or quick templates `Управляемость` and `Восстановление`, open-capture review points back to the Inbox before offering `Оставить как хвост` as a conscious decision to keep the entry visible, missing day/item context can either stage a short context note through `Добавить контекст` or record `Контекст не нужен` when the report is already understandable, and tracking review can open `Добавить пропущенный блок` through `Добавить блок` when the timeline is wrong. Evening correction dialogs, item dialogs, runtime errors, red review items, daily check, and goal-check evidence use user-facing labels and evidence phrases like `Дело`, `Создать дело`, `Описание дела`, `Удалить дело`, `Агент недоступен`, `Перезапусти Timeskein или проверь локальный агент`, `Граница разделения`, `Дело после разделения`, `1 запрос на показ`, `4 входа`, `2 красных пункта`, `проверка зон не отмечена`, `пути входа покрыты телеметрией`, and `закрытие дня ещё не измерялось`, so post-factum fixes, missing confirmations, and failures stay readable during closure. Optional checks use specific acceptance labels: `Время верно`, `Трекинг верен`, `Контекст не нужен`, `Оставить как хвост`, `Зоны верны`, `Инбокс проверен`, `Пути проверены`, and `Окно проверено`; each writes its own review telemetry. When all remaining yellow checks are safe accept-as-is items, the UI collapses them into one compact `Осознанно проверить` row and `Всё проверено` records the unique review telemetry actions in one pass; the shortcut is not shown for open captures, gap items, or checks without an explicit accept action. While unresolved red items or checks remain, already-clean items are collapsed into a short summary so the panel stays focused on the next decision. Copied UI dogfood reports include the same Russian daily-closure check as the CLI report.
- Significant-gap review items include the next concrete gap interval in the checklist and `Ближайшее действие`, for example `Объяснить большие разрывы — 12:10-13:28 (1:18:38)`, so the user does not need to search the detailed timeline before choosing `Объяснить`, `Управляемость`, or `Восстановление`.
- Today's focus picture can be copied as Markdown from the focus panel, including per-Work-Item totals, Activity Zone totals, and significant gaps
- Today's focus picture can also be exported from SQLite with `pnpm export:focus-day`; the user-facing export is Russian, while internal scripts can request raw labels with `--internal`
- Evening dogfood report can be copied from the focus panel, shown as selected Markdown if clipboard access fails, or generated with `pnpm dogfood:report`; the manual-copy fallback says that the field is already selected and names `Command+C` as the next action. UI and CLI reports include the same Russian review checklist, daily-closure check, short closure section with the measured 10-minute verdict, and deeper review prompts
- The UI does not copy draft dogfood reports from the Today report button; CLI draft exports remain diagnostic evidence, but they do not write `day_closure_completed`. The measured closure completes only when the report is final and review-clean, so an early draft cannot hide the real evening closure duration
- Dogfood reports include a `Заметки дел` section for touched Work Items that have non-empty notes
- Dogfood reports include a `События дня` section for timestamped notes that belong to the day rather than one Work Item
- Dogfood reports include a `События дел` section for timestamped Work Item observations created during the selected day
- When no focus block is active, the focus panel shows a compact `Диспетчеризация` ritual. It records the current active set, one good-enough next focus, parked work, and the reason this focus is important enough now. `Сохранить выбор` stores this as a Day Event in the `Координация` zone; `Начать выбранное` stores the same coordination event and starts the chosen focus title. The draft is stored per local day in `localStorage` and is cleared after a successful start. This is the first UI slice for `Вход в день` and `Возврат после перерыва`.
- The UI and CLI label the report as a draft while a focus block or Work Item is still active, or while review checks remain open. Active-state red items still add an explicit warning section to the Markdown
- Capture Inbox for incoming events that should not interrupt the current focus block
- Captures link to the active focus session when one exists
- Open captures are visible in the focus panel
- Open captures can be edited, deleted, resolved as done, or converted into Work Items
- Captures can be appended as timestamped Work Item Events, using the linked focus session's Work Item or the currently selected Work Item as the target
- The dogfood report shows a Russian interruption-history table for captures created during the day, including captures that were already resolved or converted
- Open captures appear separately in the UI and CLI dogfood report for evening review
- Manual Work Item inventory UI
- Search
- `Недавние`, `Сегодня`, `Закреплённые`, and `Все` Work Item list modes for a multi-day inventory, with `Alt+1..4` shortcuts
- Resizable divider between the Today list and Work Item inventory search/list area
- Create Work Item
- Edit Work Item title, type, Activity Zone, and note
- Add timestamped Work Item Events from the note editor
- Add timestamped Day Events from the focus panel for buffers, recovery notes, tracking corrections, and other review context
- Work Item cards show last touched time plus day/total tracked time when available
- Create Work Item directly in `active` starts or switches the focus timer instead of leaving split active state
- Touch
- State changes
- Notes
- Pin/unpin
- Refs UI and Local API methods
- Delete with confirmation
- Global shortcut registration with fallback candidates
- Tray/menu bar entry point on macOS with Show/Hide and Quit actions
- Tray/menu bar title shows a short Russian active focus counter such as `12 мин в фокусе`, and today's total when no block is active
- The native shell refreshes the tray/menu bar title through the local API even when the webview window is hidden
- Borderless window can be moved by dragging the header
- The macOS window is not configured as always-on-top and is not skipped from normal app switching
- macOS `Reopen` is handled so a hidden window can be restored through the normal app return path
- `Esc` hides the macOS window when no dialog is open
- Palette shortcuts are ignored while typing in inputs, textareas, selects, or editable elements
- Destructive confirmation dialogs focus `Cancel` by default and do not confirm on `Enter`
- Focus input is refocused when the window becomes visible and no block is active
- SQLite storage through the embedded Rust agent
- Local app-event telemetry for dogfood analysis: app start, agent start/reuse/recovery, window show/hide/drag, window show/hide requests, focus start/switch/stop, Capture Inbox create/update/delete/resolve/convert, accepted review decisions, report copy, manual copy fallback, and API errors
- Mock server for browser development

## Focus Session Data

The first Focus Session baseline is intentionally small. It stores manual contact-time blocks:

- title copied from the linked Work Item
- Work Item link
- state: `active` or `stopped`
- target seconds, currently 25 minutes by default in the UI
- start time, stop time, updated time
- optional stop note

The Rust agent stores focus sessions in SQLite. Partial unique indexes enforce at most one active focus session and at most one active Work Item. Work Item `active` is treated as the UI marker for the currently timed item: switching it stops the old focus block and starts a new linked block, while stopping a linked focus block clears `active` from Work Items. On startup, the agent normalizes old active Work Item rows and stops an active focus session if its linked Work Item is missing or deleted. Starting focus from typed text first searches for an existing Work Item with the same normalized title; if none exists, it creates one.

Post-factum correction is implemented for stopped focus sessions. `focus.create_stopped` adds a missed stopped block without starting an active timer. `focus.update` edits the block title/Work Item, start, stop, target, and note. `focus.split` cuts one stopped block into left/right blocks at a timestamp; the right side can be assigned to another Work Item by title. This covers common tracking mistakes by adding a missed interval, splitting around the wrong interval, and updating the resulting block. The mock server exposes the same focus correction methods for browser development.

## Dogfood Findings

The 2026-07-01, 2026-07-02, and 2026-07-03 dogfood days showed that the core timer loop works, and that Capture Inbox can preserve incoming events without switching away from the current focus. The first post-baseline slice added post-factum correction, entry/window fixes, Day Events, Work Item Events, Activity Zones, explicit Work Item time review evidence, and strict report evidence. The 2026-07-06 dogfood day produced a strong daily-control trace in real use: 7:30:36 tracked, 19 entrances, Activity Zones, Day Events, Work Item Events, Capture Inbox conversion, Work Item day/total time evidence, and zero API/copy/start-stop failures. The 2026-07-07 dogfood day produced useful in-day structure evidence: zones, day events, Work Item events, and a clear long post-break loss of manageability. The 2026-07-08 dogfood day closed the daily-control goal: final saved evidence was clean, measured evening closure took 2:32, and strict `pnpm dogfood:goal-check -- --date 2026-07-08 --no-codex-guidance` passed after `pnpm test`, `pnpm dogfood:preflight`, and strict RC evidence.

High-signal findings:

- Quick text entry must stay safe: `C`/`С` opening Create while typing was real daily friction and is fixed.
- Creating a new Work Item directly as `Active` must work; the first dogfood day hit this twice and the path is now fixed.
- `last_seen_at` labels looked like spent duration; the UI now says `ago`.
- The report and Today panel now have explicit zone totals, so `break`, `recovery`, or `idle` blocks can be tracked without polluting executive-work review.
- Work Item notes are still mutable descriptions; timestamped observations now live in separate Work Item Events.
- Capture Inbox worked in real use on 2026-07-03: incoming events were captured during active focus, then resolved or converted later.
- Work Item notes matter for review and appear in day reports for touched items; timestamped Work Item Events now cover day-specific observations.
- Some observations belong to the whole day rather than one Work Item. Day Events now cover buffers before heavy meetings, recovery notes, tracking corrections, and similar review context.
- Wrong Work Item assignment happened during dogfood; stopped blocks can now be corrected and split after the fact.
- Activity Zones are now available on Work Items and copied into each focus block as a snapshot. Stopped blocks can be corrected independently, so changing a Work Item later does not rewrite past day reports. The UI and Markdown separate total tracked time, working occupancy (`work + coordination`), executive work (`work`), non-work tracked time, and per-zone totals for work, coordination, recovery, idle, and personal. The Today panel also shows live zone totals during the day, so coordination no longer disappears into a misleadingly low work number.
- macOS window restore and the menu bar counter were verified in the 2026-07-06 daily-control dogfood day with non-zero show/hide request telemetry.

## Capture Inbox Data

Capture Inbox stores quick incoming-event notes in SQLite table `captures`.

The current baseline stores:

- free-form text entered by the user;
- state: `open`, `resolved`, or `converted`;
- optional link to the active focus session at capture time;
- optional link to a Work Item after conversion;
- created, updated, resolved, and converted timestamps.

Capture is intentionally separate from focus sessions. Creating, editing, deleting, resolving, or converting a capture must not stop or switch the active timer. Open captures can be edited or deleted during review; processed captures stay as day history. Converting a capture creates or reuses a Work Item by normalized title, but does not start focus on that Work Item. The dogfood report includes a Russian interruption-history table for all captures created during the selected day, with state, focus context, and outcome. The closure checker also counts how many captures were linked to an active focus session, because that is the real evidence for interruption handling during focus.

## Work Item Events

Work Item Events store timestamped observations in SQLite table `work_item_events`.
They are separate from the mutable Work Item `note` field:

- `note` is the current description/context of the Work Item;
- `note_added` events are dated observations for the day journal.

The current API surface is:

- `work_item.add_event` to append an event to a Work Item, optionally linked to the active focus session;
- `work_item.update_event` to edit user-authored `note_added` event text;
- `work_item.delete_event` to delete user-authored `note_added` events;
- `work_item.events` to list events by Work Item and/or time window.

The active focus panel has a cheap journal row for thoughts, decisions, questions, next steps, milestones, and interruption notes. By default it appends the note to the current Work Item and links it to the active focus session; the user can switch the target to day-level context without stopping or switching the timer. The saved event text keeps the selected kind as a Russian prefix, for example `Решение: ...`, so the existing report can show meaning before a deeper typed-event schema exists.

The note editor can append a timestamped event without replacing the Work Item description. Its entry rule is intentionally conservative: typed event text is cleared only after a successful append, and it stays in the field after an API failure. The draft is stored locally per day and Work Item, while active-focus journal drafts are stored locally per day and active Work Item/focus anchor. Closing, reloading, or losing an API request must not silently drop a note intended for review, and yesterday's draft does not appear as today's context. Capture Inbox can also append a capture as a Work Item Event, preserving the capture text and focus-session link. The focus panel shows item events for the day and lets user-authored note events be edited or deleted before the final report. UI/CLI dogfood reports include a `События дел` section.

## Day Events

Day Events store timestamped day-level observations in SQLite table `day_events`.
They are for review context that is not naturally owned by one Work Item:

- buffer or mobilization before a heavy meeting;
- recovery notes after a demanding block;
- tracking corrections noticed during the day;
- context that explains a gap without turning it into timed work.

The current API surface is:

- `day_event.add` to append a day-level note, optionally linked to the active focus session and Activity Zone;
- `day_event.update` to edit the text or Activity Zone;
- `day_event.delete` to remove a user-authored day note;
- `day_event.list` to list day notes by time window.

The focus panel has a compact `Добавить событие дня...` input with an optional Activity Zone selector. Its typed draft is stored locally per day and is cleared only after a successful add, so a reload or failed API call does not silently drop review context. Adding, editing, re-zoning, or deleting a Day Event must not stop or switch the active timer. Significant gaps and the current open gap have `Объяснить`, `Управляемость`, and `Восстановление` shortcuts that prepare a Day Event with the gap range, duration, and an optional explanation template. For closed gaps, review now matches the Day Event to the exact displayed interval instead of merely counting any gap-like note. The Today list and Markdown exports show a classification label next to explained gaps: `восстановление`, `потеря управляемости`, `простой`, or `объяснён`. UI/CLI dogfood reports include a `События дня` section, and the closure checker includes Day Events in its evidence model.

## App Event Telemetry

The dogfood baseline stores a local append-only event journal in SQLite table `app_events`.
It is for evaluating Timeskein itself after a real workday, not for external analytics.

Tracked event groups:

- app and embedded-agent startup, reuse, and stale runtime recovery;
- window show, hide, and drag start;
- focus start, switch, stop requests and outcomes, including whether start came from typed text or selected/list continuation;
- Capture Inbox create, update, delete, resolve, convert requests and outcomes;
- report copy attempts, clipboard failures, and manual copy fallback;
- day-closure start/completion and the measured duration from review start to final report copy;
- accepted review decisions for Activity Zones, Capture usage, entry paths, window entrypoints, Work Item time checks, capture follow-up, and focus-correction review;
- Local API errors.

Telemetry payloads are sanitized before storage. They can contain safe technical metadata such as control name, action id, duration, counters, and boolean flags. They must not contain raw Work Item titles, notes, URLs, search text, or other free-form user text. Analysis links events through `work_item_id` and `focus_session_id`, using the existing tables when names are needed.

Useful commands:

```bash
pnpm dogfood:metrics
pnpm export:app-events
pnpm dogfood:report
pnpm dogfood:finish:save
pnpm dogfood:goal-check -- --no-codex-guidance
```

The report telemetry section includes action counts, typed entry and selected/list continuation evidence, start/switch/stop failures, Capture Inbox action counts and failures, accepted review decisions, day-closure start/completion counts, last measured day-closure duration, API errors, window show/hide counts, both show and hide request counts, copy fallback counts, average start latency, likely show-to-start friction gaps, attempts to start the already active Work Item, and stale runtime recovery events. `app_event.summary` also exposes the latest open day-closure action when `day_closure_started` exists without a matching `day_closure_completed`, so the focus panel can restore the evening-closure timer after a frontend or app restart instead of starting a second measurement. The user-facing Markdown localizes unavailable values and event kind rows as `нет данных`, `фокус начат`, `окно показано`, and `запрошен старт фокуса`; raw English labels remain available only through `pnpm dogfood:metrics -- --raw` for scripts.

## Global Shortcut and Tray

The desktop app tries these global shortcut candidates:

1. `Ctrl+Shift+Space`
2. `Ctrl+Option+Space`
3. `Cmd+Option+Space`

If macOS rejects all candidates, the app still starts and remains available through the menu bar/tray item.

On multi-monitor macOS setups, the tray/status item is controlled by the system menu bar behavior. Timeskein creates one status item; macOS decides on which menu bar it appears.

## Known Limitations

- Windows packaging is deferred.
- Android is not implemented.
- macOS build currently produces `.app` only; DMG packaging is deferred.
- Browser mode uses mock data only.
- Focus Session does not implement pause, resume, or cancel yet.
- Focus Session has a compact day list and Markdown copy, but not a full reporting/JSON/CSV export view yet.
- App-event telemetry has CLI/report output, but no in-app inspection screen yet.
- Post-factum correction is intentionally basic: stopped blocks can be added, edited, reassigned, re-zoned, and split, but there is no drag timeline, bulk edit, or dedicated correction wizard yet.
- Capture Inbox is still compact: open captures can be edited or deleted, but there is no separate capture history screen beyond the open list and dogfood report.
- Work Item Events are report-visible. User-authored `note_added` events can be edited or deleted; generated system events remain internal history.
- Work Item notes are included in day reports for touched items, but they remain mutable descriptions rather than dated observations.
- macOS window restore and menu bar status refresh have one real dogfood pass with show/hide request telemetry. Further polish is still possible, but the daily-control gate no longer treats this as unproven.
- Activity Zones have per-focus-block snapshots and overrides; there is no bulk zone correction UI yet.
- Automated e2e tests are not implemented yet.
- Cross-platform CI is not implemented yet.
- Settings UI is not implemented yet.
- Agent lifecycle is minimal: embedded startup works, but production-grade diagnostics/restart handling are not done.
- Sync, SourceNodes, Context Capture, and Evidence-Mode are future levels, not current functionality.

## Next Engineering Steps

1. Continue the in-day structure gate. The first slices are done: live Activity Zone totals now separate working occupancy, executive work, and non-work tracked time; the active focus panel can capture thoughts, decisions, questions, next steps, milestones, and interruption notes into Work Item or Day Events without stopping the timer; explained gaps show a typed label in Today and Markdown. Next slices should make day-entry/post-break dispatch decisions and Work Item stages first-class enough for a dogfood day without a parallel external note.
2. Strengthen gap explanations beyond the first classification slice. Closed gaps now match exact intervals and show typed labels, but future work can promote them from Day Event conventions into a dedicated gap model if period reports need richer filtering.
3. Strengthen the day-observation flow: the new active-focus journal is the first slice, but the product still needs a proved day without a parallel "Timeskein, day N" note and probably a calmer way to review many observations.
4. Keep arbitrary-period reports as the next meaning layer after in-day structure. The first period-report slice should use existing manual data to choose the next protected focus points before adding passive evidence collection.
