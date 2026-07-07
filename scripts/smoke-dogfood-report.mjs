#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-report-smoke-"));
const dbPath = join(tempDir, "timeskein.db");

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/003_app_events.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/005_activity_zones.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/004_captures.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/008_day_events.sql"));
  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Deep Work', 'task', 'unknown', 0, 'Keep the implementation context here.', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w2', 'Meetings', 'task', 'unknown', 0, NULL, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Deep Work', 'w1', 'stopped', 1500, 'first block', '2026-06-30T06:00:00Z', '2026-06-30T06:25:00Z', '2026-06-30T06:25:00Z'),
      ('s2', 'Meetings', 'w2', 'stopped', 1500, NULL, '2026-06-30T07:00:00Z', '2026-06-30T07:30:00Z', '2026-06-30T07:30:00Z'),
      ('s3', 'Deep Work', 'w1', 'stopped', 1500, NULL, '2026-06-30T07:35:00Z', '2026-06-30T07:45:00Z', '2026-06-30T07:45:00Z');

    INSERT INTO captures (id, text, state, work_item_id, focus_session_id, created_at, updated_at, resolved_at, converted_at)
    VALUES
      ('c1', 'Reply to incoming thread after focus', 'open', NULL, NULL, '2026-06-30T07:10:00Z', '2026-06-30T07:10:00Z', NULL, NULL),
      ('c2', 'Already handled interruption', 'resolved', NULL, 's1', '2026-06-30T07:12:00Z', '2026-06-30T07:20:00Z', '2026-06-30T07:20:00Z', NULL),
      ('c3', 'Turn into follow-up', 'converted', 'w2', 's2', '2026-06-30T07:40:00Z', '2026-06-30T07:45:00Z', NULL, '2026-06-30T07:45:00Z');

    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES
      ('e1', '2026-06-30T06:12:00Z', 'w1', 'note_added', '{"text":"implementation checkpoint","focus_session_id":"s1"}');

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES
      ('de1', '2026-06-30T06:20:00Z', 'note_added', 'buffer before meeting felt expensive', 's1', 'work', '2026-06-30T06:20:00Z');

    INSERT INTO app_events (id, ts, source, kind, focus_session_id, payload)
    VALUES
      ('ae0', '2026-06-30T05:59:59Z', 'ui', 'focus_start_requested', NULL, '{"action_id":"a1","control":"typed"}'),
      ('ae00', '2026-06-30T06:00:01Z', 'ui', 'focus_start_requested', NULL, '{"action_id":"a2","control":"selected_item"}'),
      ('ae000', '2026-06-30T07:45:01Z', 'ui', 'focus_stop_requested', 's3', '{"action_id":"a3","control":"stop_button_or_enter"}'),
      ('ae1', '2026-06-30T07:50:00Z', 'ui', 'focus_correction_requested', 's1', '{"action_id":"k1","control":"edit_block"}'),
      ('ae2', '2026-06-30T07:50:01Z', 'ui', 'focus_corrected', 's1', '{"action_id":"k1","control":"edit_block"}'),
      ('ae3', '2026-06-30T07:51:00Z', 'ui', 'window_show_requested', NULL, '{"control":"tray_click"}'),
      ('ae4', '2026-06-30T07:52:00Z', 'ui', 'window_hide_requested', NULL, '{"control":"global_shortcut"}'),
      ('ae5', '2026-06-30T07:53:00Z', 'ui', 'work_item_time_badges_reviewed', NULL, '{"action_id":"b1","control":"review_checklist","touched_work_item_count":2}'),
      ('ae6', '2026-06-30T07:54:00Z', 'ui', 'day_closure_started', NULL, '{"action_id":"d1","control":"review_panel"}'),
      ('ae7', '2026-06-30T08:01:00Z', 'ui', 'day_closure_completed', NULL, '{"action_id":"d1","control":"copy_report"}');

    UPDATE work_items SET activity_zone = 'coordination' WHERE id = 'w2';
    UPDATE focus_sessions SET activity_zone = 'coordination' WHERE work_item_id = 'w2';
  `);

  const { stdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(stdout.includes("# Отчёт закрытия дня Timeskein - 2026-06-30"), "report title is missing");
  assert(
    stdout.includes("Статус отчёта: черновик — осталось") &&
      stdout.includes("перед финальным отчётом"),
    "report with pending review items should not look final"
  );
  assert(stdout.includes("## Данные фокуса"), "report did not include focus data section");
  assert(stdout.includes("## Телеметрия приложения"), "report did not include app telemetry section");
  assert(stdout.includes("## Проверка перед отчётом"), "report did not include review checklist section");
  assert(stdout.includes("Ближайшее действие:"), "report review checklist did not include next action");
  assert(
    stdout.includes("Ближайшее действие: дописать или исправить: Объяснить большие разрывы. Нажми «Объяснить»."),
    "report review checklist did not name the single remaining action button"
  );
  assert(stdout.includes("### Дописать или исправить"), "report review checklist did not group fix-up items");
  assert(stdout.includes("### Осознанно проверить"), "report review checklist did not group accept-as-is items");
  assert(stdout.includes("## Аудит закрытия дня"), "report did not include daily-control audit section");
  assert(stdout.includes("| Фокус-блоки видны | ок |"), "report daily-control audit did not pass focus blocks");
  assert(
    stdout.includes("0 активных фокус-блоков, 0 дел с активным статусом") &&
      stdout.includes("Статус отчёта: черновик — осталось"),
    "report daily-control audit evidence did not localize final-state blockers"
  );
  assert(stdout.includes("3 входа, 1:05:00 учтено"), "report daily-control audit evidence did not localize focus blocks");
  assert(stdout.includes("| Итоги по делам есть | ок |"), "report daily-control audit did not pass work item totals");
  assert(
    stdout.includes("раздел «По делам» есть; 1 проверка времени по карточкам"),
    "report daily-control audit evidence did not localize Work Item totals"
  );
  assert(stdout.includes("| Зоны активности разделены | ок |"), "report daily-control audit did not pass zones");
  assert(
    stdout.includes("35:00 работа, 30:00 вне работы; зоны подтверждены отчётом"),
    "report daily-control audit evidence did not localize zone totals"
  );
  assert(stdout.includes("| Окно и строка меню проверены | ок |"), "report daily-control audit did not pass window evidence");
  assert(
    stdout.includes("окно показывалось") && stdout.includes("запрос на показ"),
    "report daily-control audit evidence did not localize window evidence"
  );
  assert(stdout.includes("| Старт и продолжение проверены | ок |"), "report daily-control audit did not pass entry-path evidence");
  assert(
    stdout.includes("1 старт вводом; 1 старт из списка; 1 остановка; пути входа покрыты телеметрией"),
    "report daily-control audit evidence did not localize entry evidence"
  );
  assert(stdout.includes("| Коррекция трекинга проверена | ок |"), "report daily-control audit did not pass correction evidence");
  assert(stdout.includes("| Длительность закрытия измерена | ок |"), "report daily-control audit did not pass closure duration");
  assert(
    stdout.includes("закрытие начато 1 раз, завершено 1 раз; длительность 7:00"),
    "report daily-control audit evidence did not localize closure duration"
  );
  assert(
    !stdout.includes("| Локальные проверки |") && !stdout.includes("Перед закрытием цели"),
    "report daily-control audit should leave local gates to the goal-check layer"
  );
  assert(stdout.includes("Закрытий дня начато/завершено: 1/1"), "report telemetry did not include day closure counts");
  assert(stdout.includes("Последняя длительность закрытия дня: 7:00"), "report telemetry did not include day closure duration");
  assert(
    !stdout.includes("active focus block(s)") &&
      !stdout.includes("entrance(s)") &&
      !stdout.includes("tracked") &&
      !stdout.includes("gaps section present") &&
      !stdout.includes("started/completed"),
    "report daily-control audit leaked old English evidence text"
  );
  assert(
    stdout.includes("Разобрать открытые отвлечения"),
    "report review checklist did not include open capture cleanup"
  );
  assert(
    stdout.includes("| Разрывы и отвлечения видны | проверить |"),
    "report daily-control audit should review unaccepted open captures"
  );
  assert(
    stdout.includes("No timestamped Work Item events") === false,
    "report review checklist missed existing timestamped Work Item event"
  );
  assert(
    stdout.includes("Проверить зоны активности") === false,
    "report review checklist should not flag zone coverage when two zones are present"
  );
  assert(
    stdout.includes("Проверить нерабочее время") === false,
    "report review checklist should not flag non-work time when coordination is present"
  );
  assert(
    stdout.includes("Нет событий дня или дел") === false,
    "report review checklist should not flag missing context when notes/events are present"
  );
  assert(
    stdout.includes("Подтвердить точность трекинга") === false,
    "report review checklist should not flag correction coverage when a correction was applied"
  );
  assert(
    stdout.includes("Проверить время по делам") === false,
    "report review checklist should not flag Work Item badge coverage when explicitly reviewed"
  );
  assert(stdout.includes("## Открытые отвлечения"), "report did not include open captures section");
  assert(stdout.includes("Reply to incoming thread after focus"), "report did not include open capture text");
  assert(stdout.includes("## История отвлечений"), "report did not include Capture Activity section");
  assert(stdout.includes("| открыто | Reply to incoming thread after focus |"), "report did not include open capture activity");
  assert(stdout.includes("| закрыто | Already handled interruption |"), "report did not include resolved capture activity");
  assert(stdout.includes("| превращено | Turn into follow-up |"), "report did not include converted capture activity");
  assert(stdout.includes("создано") && stdout.includes("Meetings"), "report did not include converted capture target");
  assert(stdout.includes("Всего учтено: 1:05:00"), "report did not include exported tracked total");
  assert(stdout.includes("Рабочий фокус: 35:00"), "report did not include exported work focus total");
  assert(stdout.includes("Нерабочее учтено: 30:00"), "report did not include exported non-work total");
  assert(stdout.includes("## По делам"), "report did not include work item totals");
  assert(stdout.includes("## По зонам активности"), "report did not include activity zone totals");
  assert(stdout.includes("| 35:00 | 2 | Работа |"), "report did not include localized Work zone total");
  assert(stdout.includes("| 30:00 | 1 | Координация |"), "report did not include localized Coordination zone total");
  assert(stdout.includes("## Заметки дел"), "report did not include Work Item Notes section");
  assert(
    stdout.includes("- Deep Work: Keep the implementation context here."),
    "report did not include Work Item note"
  );
  assert(stdout.includes("## События дел"), "report did not include Work Item Events section");
  assert(
    stdout.includes("| Deep Work | Deep Work | implementation checkpoint |"),
    "report did not include timestamped Work Item event"
  );
  assert(stdout.includes("## События дня"), "report did not include Day Events section");
  assert(
    stdout.includes("| Работа | Deep Work | buffer before meeting felt expensive |"),
    "report did not include day event"
  );
  assert(
    !stdout.includes("| 35:00 | 2 | Work |") && !stdout.includes("| 30:00 | 1 | Coordination |"),
    "report leaked old English activity zone labels"
  );
  assert(stdout.includes("## Разрывы >= 20:00"), "report did not include significant gaps");
  assert(stdout.includes("## Короткое закрытие"), "report did not include short closure section");
  assert(stdout.includes("Данным можно доверять: да/нет"), "report did not include short trust prompt");
  assert(
    stdout.includes("Закрытие уложилось в 10 минут: да (7:00)"),
    "report did not prefill short closure duration verdict"
  );
  assert(stdout.includes("## Дополнительный разбор"), "report did not include optional deep-review section");
  assert(
    stdout.includes("Этот раздел не обязателен для закрытия дня"),
    "report did not make the deep-review section optional"
  );
  assert(!stdout.includes("## Вечерний разбор"), "report should not make the deep-review section sound mandatory");
  assert(stdout.includes("### Цена входа"), "report did not include entry cost prompts");
  assert(stdout.includes("Данных достаточно для разговора о дне: да/нет"), "report did not include verdict prompts");

  await runSql(`
    DELETE FROM work_item_events;
    DELETE FROM day_events;
    DELETE FROM app_events;
    UPDATE work_items SET note = NULL, activity_zone = 'work';
    UPDATE focus_sessions SET activity_zone = 'work';
  `);

  const { stdout: thinEvidenceStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    thinEvidenceStdout.includes("Проверить зоны активности"),
    "report review checklist did not flag single-zone evidence"
  );
  assert(
    thinEvidenceStdout.includes("Проверить нерабочее время"),
    "report review checklist did not flag zero non-work time"
  );
  assert(
    thinEvidenceStdout.includes("Нет событий дня или дел"),
    "report review checklist did not flag missing day/Work Item context"
  );
  assert(
    thinEvidenceStdout.includes("Закрытие уложилось в 10 минут: нет данных (закрытие не измерено)"),
    "report did not explain missing closure measurement in the short closure section"
  );
  assert(
    thinEvidenceStdout.includes("Проверить время по делам"),
    "report review checklist did not flag missing Work Item badge review"
  );
  assert(
    thinEvidenceStdout.includes("Подтвердить точность трекинга"),
    "report review checklist did not flag missing correction evidence"
  );
  assert(
    thinEvidenceStdout.includes("Проверить старт и продолжение"),
    "report review checklist did not flag missing entry-path evidence"
  );
  assert(
    thinEvidenceStdout.includes("Проверить входы в окно"),
    "report review checklist did not flag missing window request evidence"
  );
  assert(
    thinEvidenceStdout.includes("0 запросов на показ, 0 запросов на скрытие"),
    "report review checklist did not show missing window request counts"
  );
  assert(
    thinEvidenceStdout.includes("| Длительность закрытия измерена | проверить |"),
    "report daily-control audit should review missing day closure duration"
  );

  await runSql(`
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES
      ('ae_accept_zone', '2026-06-30T07:52:00Z', 'ui', 'activity_zone_reviewed', '{"action_id":"z1","control":"review_checklist","zone_count":1}'),
      ('ae_accept_entry', '2026-06-30T07:53:00Z', 'ui', 'entry_paths_reviewed', '{"action_id":"p1","control":"review_checklist"}'),
      ('ae_accept_window', '2026-06-30T07:54:00Z', 'ui', 'window_entrypoints_reviewed', '{"action_id":"w1","control":"review_checklist"}');
  `);

  const { stdout: acceptedOptionalStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    acceptedOptionalStdout.includes("Проверить зоны активности") === false,
    "report review checklist should not flag Activity Zone coverage after explicit review"
  );
  assert(
    acceptedOptionalStdout.includes("Проверить нерабочее время") === false,
    "report review checklist should not flag non-work time after explicit Activity Zone review"
  );
  assert(
    acceptedOptionalStdout.includes("Проверить старт и продолжение") === false,
    "report review checklist should not flag entry paths after explicit review"
  );
  assert(
    acceptedOptionalStdout.includes("Проверить входы в окно") === false,
    "report review checklist should not flag window entrypoints after explicit review"
  );
  assert(
    acceptedOptionalStdout.includes("| Зоны активности разделены | ок |"),
    "report daily-control audit should pass Activity Zones after explicit review"
  );
  assert(
    acceptedOptionalStdout.includes("| Окно и строка меню проверены | ок |"),
    "report daily-control audit should pass window entrypoints after explicit review"
  );
  assert(
    acceptedOptionalStdout.includes("| Старт и продолжение проверены | ок |"),
    "report daily-control audit should pass entry paths after explicit review"
  );
  assert(acceptedOptionalStdout.includes("Проверок зон активности: 1"), "report telemetry should include Activity Zone review");
  assert(acceptedOptionalStdout.includes("Проверок путей входа: 1"), "report telemetry should include entry path review");
  assert(acceptedOptionalStdout.includes("Проверок входа в окно: 1"), "report telemetry should include window entrypoint review");

  await runSql(`
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('ae3', '2026-06-30T07:55:00Z', 'ui', 'focus_correction_reviewed', '{"action_id":"k2","control":"review_checklist"}');
  `);

  const { stdout: reviewedCorrectionStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    reviewedCorrectionStdout.includes("Подтвердить точность трекинга") === false,
    "report review checklist should not flag correction evidence after explicit review"
  );

  await runSql(`
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('ae_failed_correction', '2026-06-30T07:55:30Z', 'ui', 'focus_correction_failed', '{"action_id":"k3","control":"edit_block","error_code":"validation_error"}');
  `);

  const { stdout: failedCorrectionStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    failedCorrectionStdout.includes("Проверить ошибки коррекции фокуса"),
    "report review checklist should flag failed focus corrections"
  );
  assert(
    failedCorrectionStdout.includes("| Коррекция трекинга проверена | проверить |"),
    "report daily-control audit should not pass when a focus correction failed"
  );

  await runSql(`
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('ae4', '2026-06-30T07:56:00Z', 'ui', 'capture_followup_reviewed', '{"action_id":"c1","control":"review_checklist","open_count":1}');
  `);

  const { stdout: reviewedCaptureStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    reviewedCaptureStdout.includes("Разобрать открытые отвлечения") === false,
    "report review checklist should not flag open captures after explicit follow-up review"
  );
  assert(
    reviewedCaptureStdout.includes("Проверок открытых отвлечений: 1"),
    "report telemetry should include capture follow-up review"
  );

  await runSql(`
    DELETE FROM captures;
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('ae_accept_capture_usage', '2026-06-30T07:57:00Z', 'ui', 'capture_usage_reviewed', '{"action_id":"u1","control":"review_checklist","capture_count":0}');
  `);

  const { stdout: acceptedCaptureUsageStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    acceptedCaptureUsageStdout.includes("Инбокс отвлечений сегодня не проверен") === false,
    "report review checklist should not flag missing captures after explicit usage review"
  );
  assert(
    acceptedCaptureUsageStdout.includes("Проверок использования инбокса: 1"),
    "report telemetry should include capture usage review"
  );

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w3', 'Stuck Active Item', 'task', 'active', 0, '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s4', 'Stuck Active Item', 'w3', 'stopped', 1500, NULL, '2026-06-30T08:00:00Z', '2026-06-30T08:20:00Z', '2026-06-30T08:20:00Z');
  `);

  const { stdout: stuckItemDraftStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    stuckItemDraftStdout.includes("Статус отчёта: черновик — у дела ещё стоит активный статус"),
    "stuck active item report state is missing"
  );
  assert(
    stuckItemDraftStdout.includes("## Что мешает финальному отчёту"),
    "stuck active item report did not include active item warning"
  );
  assert(
    stuckItemDraftStdout.includes("Дело с активным статусом: Stuck Active Item"),
    "stuck active item report did not name active item"
  );
  assert(
    stuckItemDraftStdout.includes("Снять активный статус с дела"),
    "stuck active item review checklist did not include active item cleanup"
  );
  assert(
    stuckItemDraftStdout.includes("Ближайшее действие: закрыть красный пункт: Снять активный статус с дела. Выбери активное дело и смени состояние с «Активно»."),
    "stuck active item next action did not explain how to clear the blocker"
  );

  await runSql(`
    UPDATE work_items SET state = 'unknown' WHERE id = 'w3';

    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w4', 'Still Running', 'task', 'active', 0, '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s5', 'Still Running', 'w4', 'active', 1500, NULL, '2026-06-30T09:00:00Z', NULL, '2026-06-30T09:00:00Z');
  `);

  const { stdout: draftStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(draftStdout.includes("Статус отчёта: черновик — фокус-блок ещё активен"), "draft report state is missing");
  assert(draftStdout.includes("## Что мешает финальному отчёту"), "draft report did not include active block warning");
  assert(draftStdout.includes("Активное дело: Still Running"), "draft report did not name active item");
  assert(
    draftStdout.includes("Остановить активный фокус-блок"),
    "active focus review checklist did not include stop action"
  );
  assert(
    draftStdout.includes("Ближайшее действие: закрыть красный пункт: Остановить активный фокус-блок. Нажми «Стоп» у активного фокуса."),
    "active focus next action did not point to the Stop button"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        db_path: dbPath,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runSqlFile(path) {
  await execFileAsync("sqlite3", [dbPath, `.read ${path}`], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runSql(sql) {
  await execFileAsync("sqlite3", [dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
