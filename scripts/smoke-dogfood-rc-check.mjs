#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-rc-check-smoke-"));

try {
  const { stdout: helpStdout } = await execFileAsync("node", [join(repoRoot, "scripts/dogfood-rc-check.mjs"), "--help"], {
    cwd: repoRoot,
  });
  assert(helpStdout.includes("Использование: pnpm dogfood:rc-check"), "RC check help title is not localized");
  assert(helpStdout.includes("Проверяет, достаточно ли данных Timeskein"), "RC check help body is not localized");
  assert(!helpStdout.includes("Usage:"), "RC check help leaked old English usage");

  const goodDb = join(tempDir, "good.db");
  await migrate(goodDb);
  await runSql(goodDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Deep Work', 'task', 'unknown', 0, '2026-06-30T06:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z'),
      ('w2', 'Review', 'task', 'unknown', 0, '2026-06-30T08:30:00Z', '2026-06-30T10:00:00Z', '2026-06-30T10:00:00Z');
    UPDATE work_items
    SET activity_zone = 'coordination',
        note = 'Review context for the evening report'
    WHERE id = 'w2';

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Deep Work', 'w1', 'stopped', 1500, NULL, '2026-06-30T06:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z'),
      ('s2', 'Review', 'w2', 'stopped', 1500, NULL, '2026-06-30T08:30:00Z', '2026-06-30T10:00:00Z', '2026-06-30T10:00:00Z');
    UPDATE focus_sessions SET activity_zone = 'coordination' WHERE id = 's2';

    INSERT INTO captures (id, text, state, focus_session_id, created_at, updated_at, resolved_at)
    VALUES ('c1', 'Check incoming request later', 'resolved', 's1', '2026-06-30T07:00:00Z', '2026-06-30T10:10:00Z', '2026-06-30T10:10:00Z');

    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES ('we1', '2026-06-30T07:30:00Z', 'w1', 'note_added', '{"text":"Found the next concrete step","focus_session_id":"s1"}');

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES ('de1', '2026-06-30T07:45:00Z', 'note_added', 'Gap explained: meeting buffer was costly', 's1', 'work', '2026-06-30T07:45:00Z');

    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES
      ('e1', '2026-06-30T06:00:00Z', 'ui', 'app_started', NULL),
      ('e2', '2026-06-30T06:00:01Z', 'ui', 'focus_start_requested', '{"action_id":"a1","control":"typed"}'),
      ('e3', '2026-06-30T06:00:01Z', 'ui', 'focus_started', '{"action_id":"a1","control":"typed"}'),
      ('e4', '2026-06-30T09:00:00Z', 'ui', 'window_shown', '{"control":"shortcut"}'),
      ('e5', '2026-06-30T09:05:00Z', 'ui', 'window_hidden', '{"control":"esc"}'),
      ('e6', '2026-06-30T09:00:00Z', 'ui', 'window_show_requested', '{"control":"tray_click"}'),
      ('e7', '2026-06-30T09:05:00Z', 'ui', 'window_hide_requested', '{"control":"global_shortcut"}'),
      ('e8', '2026-06-30T10:00:00Z', 'ui', 'report_copied', '{"report_kind":"dogfood"}'),
      ('e9', '2026-06-30T10:05:00Z', 'ui', 'focus_correction_requested', '{"action_id":"k1","control":"edit_block"}'),
      ('e10', '2026-06-30T10:05:01Z', 'ui', 'focus_corrected', '{"action_id":"k1","control":"edit_block"}'),
      ('e13', '2026-06-30T08:30:00Z', 'ui', 'focus_start_requested', '{"action_id":"a2","control":"selected_item"}'),
      ('e14', '2026-06-30T08:30:01Z', 'ui', 'focus_started', '{"action_id":"a2","control":"selected_item"}'),
      ('e15', '2026-06-30T10:00:00Z', 'ui', 'focus_stop_requested', '{"action_id":"a3","control":"stop_button_or_enter"}'),
      ('e20', '2026-06-30T10:06:00Z', 'ui', 'work_item_time_badges_reviewed', '{"action_id":"b1","control":"review_checklist","touched_work_item_count":2}'),
      ('e21', '2026-06-30T10:07:00Z', 'ui', 'day_closure_started', '{"action_id":"d1","control":"review_panel"}'),
      ('e22', '2026-06-30T10:14:00Z', 'ui', 'day_closure_completed', '{"action_id":"d1","control":"copy_report"}');
  `);

  const good = await runRcCheck(goodDb);
  assert(good.code === 0, "good day should not be blocked");
  assert(good.stdout.includes("Вердикт: готово к ручному RC-вердикту"), "good day verdict is missing");
  assert(good.stdout.includes("Строгий режим: нет"), "good day strict-mode marker is missing");
  assert(good.stdout.includes("Всего учтено: 3:30:00"), "good day total tracked is missing");
  assert(good.stdout.includes("Рабочий фокус: 2:00:00"), "good day work focus is missing");
  assert(good.stdout.includes("Нерабочее учтено: 1:30:00"), "good day non-work tracked is missing");
  assert(good.stdout.includes("Проверок бейджей времени дел: 1"), "good day item badge review count is missing");
  assert(good.stdout.includes("Зон активности в отчёте: 2"), "good day zone count is missing");
  assert(good.stdout.includes("Больших разрывов: 1"), "good day significant gap count is missing");
  assert(good.stdout.includes("Больших разрывов объяснено: 1/1"), "good day explained gap count is missing");
  assert(good.stdout.includes("Событий дня: 1"), "good day Day Events count is missing");
  assert(good.stdout.includes("Событий дня с зоной активности: 1"), "good day zoned Day Events count is missing");
  assert(good.stdout.includes("Событий дня во время активного фокуса: 1"), "good day active-focus Day Events count is missing");
  assert(good.stdout.includes("Событий дел: 1"), "good day item events count is missing");
  assert(good.stdout.includes("Запросов старт/переключение/остановка: 2/0/1"), "good day entry request count is missing");
  assert(good.stdout.includes("Входов typed/selected: 1/1"), "good day entry control count is missing");
  assert(good.stdout.includes("Коррекций запрошено/применено/проверено/ошибок: 1/1/0/0"), "good day correction telemetry is missing");
  assert(good.stdout.includes("Закрытий дня начато/завершено: 1/1"), "good day closure telemetry is missing");
  assert(good.stdout.includes("Последняя длительность закрытия дня: 7:00"), "good day closure duration is missing");
  assert(good.stdout.includes("Окно показано/скрыто: 1/1"), "good day window telemetry is missing");
  assert(good.stdout.includes("Запросы показать/скрыть окно: 1/1"), "good day window request telemetry is missing");
  assert(good.stdout.includes("## Аудит закрытия дня"), "good day goal audit section is missing");
  assert(good.stdout.includes("| Фокус-блоки видны | ок |"), "good day focus-block audit row is missing");
  assert(good.stdout.includes("| Итоги по делам есть | ок |"), "good day item totals audit row is missing");
  assert(good.stdout.includes("| Зоны активности разделены | ок |"), "good day activity-zone audit row is missing");
  assert(good.stdout.includes("| Разрывы и отвлечения видны | ок |"), "good day gap/capture audit row is missing");
  assert(good.stdout.includes("| Старт и продолжение проверены | ок |"), "good day entry-path audit row is missing");
  assert(good.stdout.includes("| Коррекция трекинга проверена | ок |"), "good day correction audit row is missing");
  assert(good.stdout.includes("| Длительность закрытия измерена | ок |"), "good day closure-duration audit row is missing");
  assert(good.stdout.includes("| Локальные проверки | вручную |"), "good day local-gates audit row is missing");
  assert(good.stdout.includes("pnpm dogfood:goal-check"), "good day local-gates audit did not mention goal-check");
  assert(good.stdout.includes("## По зонам активности"), "good day zone section is missing");
  assert(good.stdout.includes("## События дня"), "good day Day Events section is missing");
  assert(good.stdout.includes("Gap explained: meeting buffer was costly"), "good day Day Event text is missing");
  assert(good.stdout.includes("## События дел"), "good day item events section is missing");
  assert(good.stdout.includes("Отвлечений создано сегодня: 1"), "good day capture count is missing");
  assert(good.stdout.includes("Отвлечений во время активного фокуса: 1"), "good day active-focus capture count is missing");
  assert(good.stdout.includes("## История отвлечений"), "good day capture activity section is missing");
  assert(good.stdout.includes("| закрыто | Check incoming request later |"), "good day capture activity row is missing");

  const goodStrict = await runRcCheck(goodDb, ["--strict"]);
  assert(goodStrict.code === 0, "good day should pass strict RC check");
  assert(goodStrict.stdout.includes("Строгий режим: да"), "strict RC check marker is missing");

  const singleZoneDb = join(tempDir, "single-zone.db");
  await copyDb(goodDb, singleZoneDb);
  await runSql(singleZoneDb, `
    UPDATE work_items SET activity_zone = 'work';
    UPDATE focus_sessions SET activity_zone = 'work';
  `);
  const singleZoneStrict = await runRcCheck(singleZoneDb, ["--strict"]);
  assert(singleZoneStrict.code !== 0, "strict RC check should fail when Activity Zone coverage is unreviewed");
  assert(
    singleZoneStrict.stdout.includes("видна только одна зона активности"),
    "strict RC check should explain single-zone evidence"
  );

  const acceptedSingleZoneDb = join(tempDir, "accepted-single-zone.db");
  await copyDb(singleZoneDb, acceptedSingleZoneDb);
  await runSql(acceptedSingleZoneDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e23', '2026-06-30T10:20:00Z', 'ui', 'activity_zone_reviewed', '{"action_id":"z1","control":"review_checklist","zone_count":1}');
  `);
  const acceptedSingleZoneStrict = await runRcCheck(acceptedSingleZoneDb, ["--strict"]);
  assert(acceptedSingleZoneStrict.code === 0, "accepted Activity Zone review should pass strict RC check");
  assert(
    acceptedSingleZoneStrict.stdout.includes("Проверок зон активности: 1"),
    "accepted Activity Zone review evidence is missing"
  );
  assert(
    acceptedSingleZoneStrict.stdout.includes("| Зоны активности разделены | ок |"),
    "accepted Activity Zone review should pass Activity Zone audit row"
  );

  const unexplainedGapDb = join(tempDir, "unexplained-gap.db");
  await copyDb(goodDb, unexplainedGapDb);
  await runSql(unexplainedGapDb, "UPDATE day_events SET text = 'Meeting buffer was costly' WHERE id = 'de1';");
  const unexplainedGapStrict = await runRcCheck(unexplainedGapDb, ["--strict"]);
  assert(unexplainedGapStrict.code !== 0, "strict RC check should fail when significant gaps are not explained");
  assert(
    unexplainedGapStrict.stdout.includes("| Разрывы и отвлечения видны | проверить |"),
    "unexplained gaps should mark gap/capture audit for review"
  );
  assert(
    unexplainedGapStrict.stdout.includes("больших разрывов без объяснения Day Event"),
    "strict RC check should explain missing gap explanation"
  );

  const noSelectedEntryDb = join(tempDir, "no-selected-entry.db");
  await copyDb(goodDb, noSelectedEntryDb);
  await runSql(noSelectedEntryDb, "DELETE FROM app_events WHERE id IN ('e13', 'e14');");
  const noSelectedEntryStrict = await runRcCheck(noSelectedEntryDb, ["--strict"]);
  assert(noSelectedEntryStrict.code !== 0, "strict RC check should fail without selected/list entry evidence");
  assert(
    noSelectedEntryStrict.stdout.includes("Нет входа через выбранное дело из списка"),
    "strict RC check should explain missing selected/list entry evidence"
  );
  const acceptedNoSelectedEntryDb = join(tempDir, "accepted-no-selected-entry.db");
  await copyDb(noSelectedEntryDb, acceptedNoSelectedEntryDb);
  await runSql(acceptedNoSelectedEntryDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e23', '2026-06-30T10:20:00Z', 'ui', 'entry_paths_reviewed', '{"action_id":"p1","control":"review_checklist"}');
  `);
  const acceptedNoSelectedEntryStrict = await runRcCheck(acceptedNoSelectedEntryDb, ["--strict"]);
  assert(acceptedNoSelectedEntryStrict.code === 0, "accepted entry path review should pass strict RC check");
  assert(
    acceptedNoSelectedEntryStrict.stdout.includes("Проверок путей входа: 1"),
    "accepted entry path review evidence is missing"
  );
  assert(
    acceptedNoSelectedEntryStrict.stdout.includes("| Старт и продолжение проверены | ок |"),
    "accepted entry path review should pass entry audit row"
  );

  const noWindowRequestDb = join(tempDir, "no-window-request.db");
  await copyDb(goodDb, noWindowRequestDb);
  await runSql(noWindowRequestDb, "DELETE FROM app_events WHERE kind IN ('window_show_requested', 'window_hide_requested');");
  const noWindowRequestStrict = await runRcCheck(noWindowRequestDb, ["--strict"]);
  assert(noWindowRequestStrict.code !== 0, "strict RC check should fail without window request evidence");
  assert(
    noWindowRequestStrict.stdout.includes("Нет telemetry-запроса показать окно"),
    "strict RC check should explain missing window show request evidence"
  );
  assert(
    noWindowRequestStrict.stdout.includes("Нет telemetry-запроса скрыть окно"),
    "strict RC check should explain missing window hide request evidence"
  );
  const acceptedNoWindowRequestDb = join(tempDir, "accepted-no-window-request.db");
  await copyDb(noWindowRequestDb, acceptedNoWindowRequestDb);
  await runSql(acceptedNoWindowRequestDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e23', '2026-06-30T10:20:00Z', 'ui', 'window_entrypoints_reviewed', '{"action_id":"w1","control":"review_checklist"}');
  `);
  const acceptedNoWindowRequestStrict = await runRcCheck(acceptedNoWindowRequestDb, ["--strict"]);
  assert(acceptedNoWindowRequestStrict.code === 0, "accepted window entrypoint review should pass strict RC check");
  assert(
    acceptedNoWindowRequestStrict.stdout.includes("Проверок входа через окно: 1"),
    "accepted window entrypoint review evidence is missing"
  );
  assert(
    acceptedNoWindowRequestStrict.stdout.includes("| Окно и строка меню проверены | ок |"),
    "accepted window entrypoint review should pass window audit row"
  );

  const showOnlyWindowRequestDb = join(tempDir, "show-only-window-request.db");
  await copyDb(goodDb, showOnlyWindowRequestDb);
  await runSql(showOnlyWindowRequestDb, "DELETE FROM app_events WHERE kind = 'window_hide_requested';");
  const showOnlyWindowRequestStrict = await runRcCheck(showOnlyWindowRequestDb, ["--strict"]);
  assert(showOnlyWindowRequestStrict.code !== 0, "strict RC check should fail without hide request evidence");
  assert(
    showOnlyWindowRequestStrict.stdout.includes("Нет telemetry-запроса скрыть окно"),
    "strict RC check should explain missing window hide request evidence when show exists"
  );
  assert(
    showOnlyWindowRequestStrict.stdout.includes("| Окно и строка меню проверены | проверить |"),
    "missing hide request should mark window audit for review"
  );

  const hideOnlyWindowRequestDb = join(tempDir, "hide-only-window-request.db");
  await copyDb(goodDb, hideOnlyWindowRequestDb);
  await runSql(hideOnlyWindowRequestDb, "DELETE FROM app_events WHERE kind = 'window_show_requested';");
  const hideOnlyWindowRequestStrict = await runRcCheck(hideOnlyWindowRequestDb, ["--strict"]);
  assert(hideOnlyWindowRequestStrict.code !== 0, "strict RC check should fail without show request evidence");
  assert(
    hideOnlyWindowRequestStrict.stdout.includes("Нет telemetry-запроса показать окно"),
    "strict RC check should explain missing window show request evidence when hide exists"
  );
  assert(
    hideOnlyWindowRequestStrict.stdout.includes("| Окно и строка меню проверены | проверить |"),
    "missing show request should mark window audit for review"
  );

  const noBadgeReviewDb = join(tempDir, "no-badge-review.db");
  await copyDb(goodDb, noBadgeReviewDb);
  await runSql(noBadgeReviewDb, "DELETE FROM app_events WHERE kind = 'work_item_time_badges_reviewed';");
  const noBadgeReviewStrict = await runRcCheck(noBadgeReviewDb, ["--strict"]);
  assert(noBadgeReviewStrict.code !== 0, "strict RC check should fail without item badge review evidence");
  assert(
    noBadgeReviewStrict.stdout.includes("Нет подтверждения проверки бейджей today/total"),
    "strict RC check should explain missing item badge review evidence"
  );
  assert(
    noBadgeReviewStrict.stdout.includes("| Итоги по делам есть | проверить |"),
    "missing item badge review should mark item totals audit for review"
  );

  const noClosureDb = join(tempDir, "no-closure.db");
  await copyDb(goodDb, noClosureDb);
  await runSql(noClosureDb, "DELETE FROM app_events WHERE kind IN ('day_closure_started', 'day_closure_completed');");
  const noClosureStrict = await runRcCheck(noClosureDb, ["--strict"]);
  assert(noClosureStrict.code !== 0, "strict RC check should fail without closure-duration evidence");
  assert(
    noClosureStrict.stdout.includes("Длительность закрытия дня не измерена"),
    "strict RC check should explain missing closure-duration evidence"
  );
  assert(
    !noClosureStrict.stdout.includes("No measured day-closure duration found"),
    "strict RC check should not show the old English closure-duration warning"
  );
  assert(
    noClosureStrict.stdout.includes("| Длительность закрытия измерена | проверить |"),
    "missing closure duration should mark closure audit for review"
  );

  const savedPath = join(tempDir, "rc-check.md");
  const saved = await runRcCheck(goodDb, ["--out", savedPath]);
  assert(saved.code === 0, "good day should save RC check");
  assert(saved.stdout.includes(`Сохранён RC-аудит dogfood-дня Timeskein: ${savedPath}`), "save output path is missing");
  assert(!saved.stdout.includes("Saved Timeskein dogfood RC check:"), "save output leaked old English RC check message");
  const savedMarkdown = await readFile(savedPath, "utf8");
  assert(savedMarkdown.includes("# RC-аудит dogfood-дня Timeskein - 2026-06-30"), "saved RC check title is missing");
  assert(savedMarkdown.includes("Ручной RC-вердикт"), "saved RC check manual verdict is missing");

  const reviewedOnlyDb = join(tempDir, "reviewed-only.db");
  await copyDb(goodDb, reviewedOnlyDb);
  await runSql(reviewedOnlyDb, `
    DELETE FROM app_events WHERE kind IN ('focus_correction_requested', 'focus_corrected');
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e11', '2026-06-30T10:06:00Z', 'ui', 'focus_correction_reviewed', '{"action_id":"k2","control":"review_checklist"}');
  `);
  const reviewedOnly = await runRcCheck(reviewedOnlyDb);
  assert(reviewedOnly.code === 0, "accepted correction review should not block");
  assert(
    reviewedOnly.stdout.includes("Коррекций запрошено/применено/проверено/ошибок: 0/0/1/0"),
    "accepted correction review telemetry is missing"
  );
  assert(
    reviewedOnly.stdout.includes("Нет коррекции фокуса и нет подтверждения проверки коррекций") === false,
    "accepted correction review should clear missing-correction review item"
  );

  const legacyDb = join(tempDir, "legacy.db");
  await runSqlFile(legacyDb, join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSql(legacyDb, `
    CREATE TABLE focus_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      work_item_id TEXT,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'stopped')),
      target_seconds INTEGER NOT NULL DEFAULT 1500,
      note TEXT,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
    );

    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at)
    VALUES ('lw1', 'Legacy Work', 'task', 'unknown', 0, 'Legacy context', '2026-06-30T06:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('ls1', 'Legacy Work', 'lw1', 'stopped', 1500, NULL, '2026-06-30T06:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z');
  `);
  const legacy = await runRcCheck(legacyDb, ["--min-focus-minutes", "60"]);
  assert(legacy.code === 0, "legacy schema should not crash the RC check");
  assert(legacy.stdout.includes("Всего учтено: 2:00:00"), "legacy schema total tracked is missing");
  assert(legacy.stdout.includes("## Аудит закрытия дня"), "legacy schema goal audit section is missing");
  assert(legacy.stdout.includes("| 2:00:00 | 1 | Работа |"), "legacy schema should fall back to localized Work zone");

  const openCaptureDb = join(tempDir, "open-capture.db");
  await copyDb(goodDb, openCaptureDb);
  await runSql(openCaptureDb, `
    INSERT INTO captures (id, text, state, created_at, updated_at)
    VALUES ('c2', 'Unresolved incoming request', 'open', '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z');
  `);
  const openCapture = await runRcCheck(openCaptureDb);
  assert(openCapture.code === 0, "open capture should be a review item, not a hard blocker");
  assert(openCapture.stdout.includes("Открытых отвлечений: 1"), "open capture count is missing");
  assert(
    openCapture.stdout.includes("| Разрывы и отвлечения видны | проверить |"),
    "open capture should mark gap/capture audit for review"
  );
  assert(openCapture.stdout.includes("Что проверить"), "open capture review section is missing");
  const openCaptureStrict = await runRcCheck(openCaptureDb, ["--strict"]);
  assert(openCaptureStrict.code !== 0, "strict RC check should fail on review items");
  assert(
    openCaptureStrict.stdout.includes("Вердикт: заблокировано пунктами проверки в strict-режиме"),
    "strict RC check should explain review-item failure"
  );

  const acceptedOpenCaptureDb = join(tempDir, "accepted-open-capture.db");
  await copyDb(openCaptureDb, acceptedOpenCaptureDb);
  await runSql(acceptedOpenCaptureDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e16', '2026-06-30T10:20:00Z', 'ui', 'capture_followup_reviewed', '{"action_id":"c2","control":"review_checklist","open_count":1}');
  `);
  const acceptedOpenCaptureStrict = await runRcCheck(acceptedOpenCaptureDb, ["--strict"]);
  assert(acceptedOpenCaptureStrict.code === 0, "accepted open capture should pass strict RC check");
  assert(
    acceptedOpenCaptureStrict.stdout.includes("Проверок открытых отвлечений: 1"),
    "accepted open capture follow-up evidence is missing"
  );
  assert(
    acceptedOpenCaptureStrict.stdout.includes("| Разрывы и отвлечения видны | ок |"),
    "accepted open capture should pass gap/capture audit row"
  );
  assert(
    acceptedOpenCaptureStrict.stdout.includes("открытых отвлечений осталось") === false,
    "accepted open capture should clear open-capture review item"
  );

  const noActiveFocusCaptureDb = join(tempDir, "no-active-focus-capture.db");
  await copyDb(goodDb, noActiveFocusCaptureDb);
  await runSql(noActiveFocusCaptureDb, "UPDATE captures SET focus_session_id = NULL WHERE id = 'c1';");
  const noActiveFocusCapture = await runRcCheck(noActiveFocusCaptureDb);
  assert(noActiveFocusCapture.code === 0, "capture without active focus should be a review item, not a hard blocker");
  assert(
    noActiveFocusCapture.stdout.includes("Отвлечений во время активного фокуса: 0"),
    "active-focus capture count should show zero"
  );
  assert(
    noActiveFocusCapture.stdout.includes("| Разрывы и отвлечения видны | проверить |"),
    "capture without active focus should mark gap/capture audit for review"
  );
  assert(
    noActiveFocusCapture.stdout.includes("ни один не связан с активной фокус-сессией"),
    "missing active-focus capture review item"
  );
  const noActiveFocusCaptureStrict = await runRcCheck(noActiveFocusCaptureDb, ["--strict"]);
  assert(noActiveFocusCaptureStrict.code !== 0, "strict RC check should fail without active-focus capture evidence");
  const acceptedNoActiveFocusCaptureDb = join(tempDir, "accepted-no-active-focus-capture.db");
  await copyDb(noActiveFocusCaptureDb, acceptedNoActiveFocusCaptureDb);
  await runSql(acceptedNoActiveFocusCaptureDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e23', '2026-06-30T10:20:00Z', 'ui', 'capture_usage_reviewed', '{"action_id":"u1","control":"review_checklist","capture_count":1}');
  `);
  const acceptedNoActiveFocusCaptureStrict = await runRcCheck(acceptedNoActiveFocusCaptureDb, ["--strict"]);
  assert(acceptedNoActiveFocusCaptureStrict.code === 0, "accepted capture usage review should pass strict RC check");
  assert(
    acceptedNoActiveFocusCaptureStrict.stdout.includes("Проверок использования инбокса: 1"),
    "accepted capture usage review evidence is missing"
  );
  assert(
    acceptedNoActiveFocusCaptureStrict.stdout.includes("| Разрывы и отвлечения видны | ок |"),
    "accepted capture usage review should pass gap/capture audit row"
  );

  const noCaptureDb = join(tempDir, "no-capture.db");
  await copyDb(goodDb, noCaptureDb);
  await runSql(noCaptureDb, "DELETE FROM captures;");
  const noCapture = await runRcCheck(noCaptureDb);
  assert(noCapture.code === 0, "missing captures should be a review item, not a hard blocker");
  assert(noCapture.stdout.includes("Отвлечений создано сегодня: 0"), "missing capture count should show zero");
  assert(
    noCapture.stdout.includes("| Разрывы и отвлечения видны | проверить |"),
    "missing captures should mark gap/capture audit for review"
  );
  assert(
    noCapture.stdout.includes("инбокс отвлечений не проверен в бою"),
    "missing captures review item is missing"
  );
  const acceptedNoCaptureDb = join(tempDir, "accepted-no-capture.db");
  await copyDb(noCaptureDb, acceptedNoCaptureDb);
  await runSql(acceptedNoCaptureDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e23', '2026-06-30T10:20:00Z', 'ui', 'capture_usage_reviewed', '{"action_id":"u2","control":"review_checklist","capture_count":0}');
  `);
  const acceptedNoCaptureStrict = await runRcCheck(acceptedNoCaptureDb, ["--strict"]);
  assert(acceptedNoCaptureStrict.code === 0, "accepted no-capture usage review should pass strict RC check");
  assert(
    acceptedNoCaptureStrict.stdout.includes("инбокс отвлечений не проверен в бою") === false,
    "accepted no-capture usage review should clear missing-capture review item"
  );

  const captureFailureDb = join(tempDir, "capture-failure.db");
  await copyDb(goodDb, captureFailureDb);
  await runSql(captureFailureDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e12', '2026-06-30T10:30:00Z', 'ui', 'capture_create_failed', '{"action_id":"c1","error_code":"validation_error"}');
  `);
  const captureFailure = await runRcCheck(captureFailureDb);
  assert(captureFailure.code === 0, "capture failure should be a review item, not a hard blocker");
  assert(captureFailure.stdout.includes("Ошибок инбокса отвлечений: 1"), "capture failure count is missing");
  assert(
    captureFailure.stdout.includes("Найдено ошибок инбокса отвлечений"),
    "capture failure review item is missing"
  );

  const emptyDb = join(tempDir, "empty.db");
  await migrate(emptyDb);
  const empty = await runRcCheck(emptyDb);
  assert(empty.code !== 0, "empty day should be blocked");
  assert(empty.stdout.includes("За эту дату нет фокус-блоков"), "empty day blocker is missing");

  const duplicateDb = join(tempDir, "duplicate.db");
  await copyDb(goodDb, duplicateDb);
  await runSql(duplicateDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w3', 'deep work', 'task', 'unknown', 0, '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z');
  `);
  const duplicate = await runRcCheck(duplicateDb);
  assert(duplicate.code !== 0, "duplicate title should be blocked");
  assert(duplicate.stdout.includes("Дублируется название дела"), "duplicate title blocker is missing");

  const activeDb = join(tempDir, "active.db");
  await copyDb(goodDb, activeDb);
  await runSql(activeDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w4', 'Active Work', 'task', 'active', 0, '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s3', 'Active Work', 'w4', 'active', 1500, NULL, '2026-06-30T11:00:00Z', NULL, '2026-06-30T11:00:00Z');
  `);
  const active = await runRcCheck(activeDb);
  assert(active.code !== 0, "active session should be blocked");
  assert(active.stdout.includes("Активный фокус-блок ещё идёт"), "active session blocker is missing");

  console.log(
    JSON.stringify(
      {
        ok: true,
        temp_dir: tempDir,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function migrate(path) {
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/003_app_events.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/004_captures.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/005_activity_zones.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/006_work_item_note_events.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/008_day_events.sql"));
}

async function runRcCheck(path, extraArgs = []) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [
        join(repoRoot, "scripts/dogfood-rc-check.mjs"),
        "--db",
        path,
        "--date",
        "2026-06-30",
        "--now",
        "2026-06-30T12:00:00Z",
        ...extraArgs,
      ],
      {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function copyDb(from, to) {
  await execFileAsync("cp", [from, to]);
}

async function runSqlFile(path, sqlFile) {
  await execFileAsync("sqlite3", [path, `.read ${sqlFile}`], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runSql(path, sql) {
  await execFileAsync("sqlite3", [path, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
