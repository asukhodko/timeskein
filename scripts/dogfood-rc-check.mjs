#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SIGNIFICANT_GAP_SECONDS = 20 * 60;
const DEFAULT_MIN_FOCUS_MINUTES = 180;
const WORK_ACTIVITY_ZONE = "work";

const options = parseArgs(process.argv.slice(2));
const date = options.date ? parseLocalDate(options.date) : new Date();
const now = options.now ? parseIsoDate(options.now) : new Date();
const minFocusSeconds = (options.minFocusMinutes ?? DEFAULT_MIN_FOCUS_MINUTES) * 60;
const dateArg = options.date ?? formatLocalDate(date);
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");

if (!existsSync(dbPath)) {
  process.stdout.write(buildMissingDbReport(dateArg, dbPath));
  process.exit(1);
}

const from = startOfLocalDay(date);
const to = nextLocalDay(from);
const evidence = await loadEvidence(dbPath, from, to, now);
const assessment = assessEvidence(evidence, minFocusSeconds);
const output = buildRcReport(dateArg, dbPath, evidence, assessment, minFocusSeconds, options.strict ?? false);
const outputPath = outputReportPath(options, dateArg);
const shouldFail =
  assessment.hardBlockers.length > 0 || Boolean(options.strict && assessment.reviewItems.length > 0);

if (outputPath) {
  await writeFile(outputPath, output);
  process.stdout.write(`Сохранена проверка закрытия дня Timeskein: ${outputPath}\n`);
} else {
  process.stdout.write(output);
}
process.exit(shouldFail ? 1 : 0);

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--db") {
      result.db = args[++index];
    } else if (arg === "--date") {
      result.date = args[++index];
    } else if (arg === "--now") {
      result.now = args[++index];
    } else if (arg === "--min-focus-minutes") {
      result.minFocusMinutes = Number(args[++index]);
      if (!Number.isFinite(result.minFocusMinutes) || result.minFocusMinutes < 0) {
        throw new Error("--min-focus-minutes must be a non-negative number");
      }
    } else if (arg === "--out") {
      result.out = args[++index];
    } else if (arg === "--save") {
      result.save = true;
    } else if (arg === "--strict") {
      result.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:rc-check [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--min-focus-minutes N] [--strict] [--save | --out path.md]

Проверяет, достаточно ли данных Timeskein для строгой проверки закрытия дня.
Команда завершается с кодом 1 при красных пунктах: активное состояние, дубли названий дел или пустой день.
Пункты проверки печатаются, но без --strict оставляют код 0, потому что финальное решение всё ещё требует человеческого взгляда.
С --strict пункты проверки тоже дают код 1. Используй это перед закрытием цели про дешёвое вечернее закрытие дня.`);
}

function outputReportPath(options, date) {
  if (options.out) {
    return resolve(options.out);
  }

  if (options.save) {
    return resolve(`timeskein-dogfood-rc-check-${date}.md`);
  }

  return undefined;
}

async function loadEvidence(path, from, to, now) {
  const [
    sessions,
    activeSessions,
    activeWorkItems,
    duplicateTitles,
    openCaptures,
    capturesCreatedToday,
    workItemEvents,
    dayEvents,
    events,
  ] = await Promise.all([
    loadSessions(path, from, to, now),
    loadActiveSessions(path),
    loadActiveWorkItems(path),
    loadDuplicateTitles(path),
    loadOpenCaptures(path),
    loadCapturesCreatedToday(path, from, to),
    loadWorkItemEvents(path, from, to),
    loadDayEvents(path, from, to),
    loadEvents(path, from, to),
  ]);

  const totalFocusSeconds = sessions.reduce((sum, session) => sum + session.active_seconds, 0);
  const workItemTotals = aggregateWorkItemTotals(sessions);
  const activityZoneTotals = aggregateActivityZoneTotals(sessions);
  const workFocusSeconds = getZoneActiveSeconds(activityZoneTotals, WORK_ACTIVITY_ZONE);
  const nonWorkSeconds = Math.max(totalFocusSeconds - workFocusSeconds, 0);
  const gaps = gapsBetweenSessions(sessions).filter((gap) => gap.seconds >= SIGNIFICANT_GAP_SECONDS);
  const gapExplanationEvents = dayEvents.filter((event) => isGapExplanationText(event.text)).length;
  const unexplainedGapCount = Math.max(gaps.length - gapExplanationEvents, 0);
  const capturesDuringActiveFocus = capturesCreatedToday.filter((capture) => capture.focus_session_id).length;
  const workItemNoteCount = workItemTotals.filter((item) => item.note?.trim()).length;
  const workItemEventsDuringActiveFocus = workItemEvents.filter((event) => event.focus_session_id).length;
  const dayEventsDuringActiveFocus = dayEvents.filter((event) => event.focus_session_id).length;
  const dayEventsWithZone = dayEvents.filter((event) => event.activity_zone).length;
  const telemetry = summarizeEvents(events);

  return {
    sessions,
    activeSessions,
    activeWorkItems,
    duplicateTitles,
    openCaptures,
    capturesCreatedToday,
    capturesDuringActiveFocus,
    workItemEvents,
    workItemEventsDuringActiveFocus,
    dayEvents,
    dayEventsDuringActiveFocus,
    dayEventsWithZone,
    events,
    totalFocusSeconds,
    workFocusSeconds,
    nonWorkSeconds,
    workItemTotals,
    workItemNoteCount,
    activityZoneTotals,
    gaps,
    gapExplanationEvents,
    unexplainedGapCount,
    telemetry,
  };
}

async function loadSessions(path, from, to, now) {
  const hasActivityZone = await columnExists(path, "focus_sessions", "activity_zone");
  const activityZoneExpression = hasActivityZone
    ? "fs.activity_zone"
    : `${sqlString(WORK_ACTIVITY_ZONE)}`;

  const rows = await queryJson(path, `
    SELECT
      fs.id,
      fs.title,
      fs.work_item_id,
      wi.title AS work_item_title,
      ${activityZoneExpression} AS activity_zone,
      wi.note AS work_item_note,
      fs.state,
      fs.note,
      fs.started_at,
      fs.stopped_at
    FROM focus_sessions fs
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    WHERE datetime(COALESCE(fs.stopped_at, ${sqlString(now.toISOString())})) > datetime(${sqlString(from.toISOString())})
      AND datetime(fs.started_at) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(fs.started_at) ASC
  `);

  return rows.map((row) => ({
    ...row,
    work_item_id: row.work_item_id ?? undefined,
    work_item_title: row.work_item_title ?? undefined,
    activity_zone: row.activity_zone ?? WORK_ACTIVITY_ZONE,
    work_item_note: row.work_item_note ?? undefined,
    note: row.note ?? undefined,
    stopped_at: row.stopped_at ?? undefined,
    active_seconds: clippedActiveSeconds(row.started_at, row.stopped_at, from, to, now),
  }));
}

async function loadActiveSessions(path) {
  return queryJson(path, `
    SELECT fs.id, fs.title, wi.title AS work_item_title, fs.started_at
    FROM focus_sessions fs
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    WHERE fs.state = 'active'
    ORDER BY datetime(fs.started_at) DESC
  `);
}

async function loadActiveWorkItems(path) {
  return queryJson(path, `
    SELECT id, title, updated_at
    FROM work_items
    WHERE deleted_at IS NULL AND state = 'active'
    ORDER BY datetime(updated_at) DESC
  `);
}

async function loadDuplicateTitles(path) {
  return queryJson(path, `
    SELECT
      lower(trim(title)) AS normalized_title,
      COUNT(*) AS count,
      GROUP_CONCAT(title, ' | ') AS titles
    FROM work_items
    WHERE deleted_at IS NULL
    GROUP BY lower(trim(title))
    HAVING COUNT(*) > 1
    ORDER BY count DESC, normalized_title ASC
  `);
}

async function loadOpenCaptures(path) {
  if (!(await tableExists(path, "captures"))) return [];

  return queryJson(path, `
    SELECT id, text, created_at
    FROM captures
    WHERE state = 'open'
    ORDER BY datetime(created_at) ASC
  `);
}

async function loadCapturesCreatedToday(path, from, to) {
  if (!(await tableExists(path, "captures"))) return [];

  return queryJson(path, `
    SELECT
      c.id,
      c.text,
      c.state,
      c.work_item_id,
      c.focus_session_id,
      c.created_at,
      c.updated_at,
      c.resolved_at,
      c.converted_at,
      fs.title AS focus_title,
      focus_wi.title AS focus_work_item_title,
      capture_wi.title AS work_item_title
    FROM captures c
    LEFT JOIN focus_sessions fs ON fs.id = c.focus_session_id
    LEFT JOIN work_items focus_wi ON focus_wi.id = fs.work_item_id
    LEFT JOIN work_items capture_wi ON capture_wi.id = c.work_item_id
    WHERE datetime(c.created_at) >= datetime(${sqlString(from.toISOString())})
      AND datetime(c.created_at) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(c.created_at) ASC
  `);
}

async function loadWorkItemEvents(path, from, to) {
  if (!(await tableExists(path, "work_item_events"))) return [];

  const rows = await queryJson(path, `
    SELECT
      e.id,
      e.ts,
      e.work_item_id,
      e.kind,
      e.payload,
      wi.title AS work_item_title
    FROM work_item_events e
    LEFT JOIN work_items wi ON wi.id = e.work_item_id
    WHERE e.kind = 'note_added'
      AND datetime(e.ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(e.ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(e.ts) ASC
  `);

  return rows
    .map((row) => {
      const payload = parsePayload(row.payload);
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";

      return {
        id: row.id,
        ts: row.ts,
        work_item_id: row.work_item_id,
        work_item_title: row.work_item_title ?? undefined,
        kind: row.kind,
        text,
        focus_session_id: typeof payload?.focus_session_id === "string" ? payload.focus_session_id : undefined,
      };
    })
    .filter((event) => event.text);
}

async function loadDayEvents(path, from, to) {
  if (!(await tableExists(path, "day_events"))) return [];

  const [hasFocusSessionId, hasActivityZone, hasUpdatedAt] = await Promise.all([
    columnExists(path, "day_events", "focus_session_id"),
    columnExists(path, "day_events", "activity_zone"),
    columnExists(path, "day_events", "updated_at"),
  ]);
  const focusSessionExpression = hasFocusSessionId ? "focus_session_id" : "NULL";
  const activityZoneExpression = hasActivityZone ? "activity_zone" : "NULL";
  const updatedAtExpression = hasUpdatedAt ? "updated_at" : "ts";

  const rows = await queryJson(path, `
    SELECT
      id,
      ts,
      kind,
      text,
      ${focusSessionExpression} AS focus_session_id,
      ${activityZoneExpression} AS activity_zone,
      ${updatedAtExpression} AS updated_at
    FROM day_events
    WHERE kind = 'note_added'
      AND datetime(ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(ts) ASC
  `);

  return rows
    .map((row) => ({
      id: row.id,
      ts: row.ts,
      kind: row.kind,
      text: typeof row.text === "string" ? row.text.trim() : "",
      focus_session_id: row.focus_session_id ?? undefined,
      activity_zone: row.activity_zone ?? undefined,
      updated_at: row.updated_at,
    }))
    .filter((event) => event.text);
}

async function loadEvents(path, from, to) {
  if (!(await tableExists(path, "app_events"))) return [];

  return queryJson(path, `
    SELECT id, ts, source, kind, work_item_id, focus_session_id, payload
    FROM app_events
    WHERE datetime(ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(ts) ASC
  `).then((rows) =>
    rows.map((row) => ({
      ...row,
      payload: parsePayload(row.payload),
    }))
  );
}

async function tableExists(path, tableName) {
  const rows = await queryJson(
    path,
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`
  );

  return (rows[0]?.count ?? 0) > 0;
}

async function columnExists(path, tableName, columnName) {
  if (!(await tableExists(path, tableName))) {
    return false;
  }

  const rows = await queryJson(path, `PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return rows.some((row) => row.name === columnName);
}

async function queryJson(path, sql) {
  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, sql), {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sqliteReadArgs(path, sql) {
  return ["-readonly", "-cmd", ".timeout 5000", "-json", path, sql];
}

function assessEvidence(evidence, minFocusSeconds) {
  const hardBlockers = [];
  const reviewItems = [];

  for (const session of evidence.activeSessions) {
    hardBlockers.push(
      `Активный фокус-блок ещё идёт: ${session.work_item_title ?? session.title}, с ${formatClockTime(session.started_at)}`
    );
  }

  for (const item of evidence.activeWorkItems) {
    hardBlockers.push(`У дела всё ещё активный статус: ${item.title}`);
  }

  if (evidence.sessions.length === 0) {
    hardBlockers.push("За эту дату нет фокус-блоков.");
  }

  for (const duplicate of evidence.duplicateTitles) {
    hardBlockers.push(`Дублируется название дела: ${duplicate.titles}`);
  }

  if (evidence.totalFocusSeconds < minFocusSeconds && evidence.sessions.length > 0) {
    reviewItems.push(
      `Всего учтено ${formatDuration(evidence.totalFocusSeconds)}, меньше порога проверки ${formatDuration(minFocusSeconds)}. Подтверди, что это всё равно был полноценный рабочий день.`
    );
  }

  if (evidence.activityZoneTotals.length <= 1 && evidence.sessions.length > 0 && evidence.telemetry.activityZoneReviews === 0) {
    reviewItems.push("В дне видна только одна зона активности. Подтверди, что координации, восстановления, простоя и личных дел действительно не было или это не потерялось.");
  }

  if (evidence.nonWorkSeconds === 0 && evidence.sessions.length > 0 && evidence.telemetry.activityZoneReviews === 0) {
    reviewItems.push("Нерабочее время равно нулю. Проверь, что перерывы, восстановление, координация и личные дела не были случайно сложены в рабочий фокус.");
  }

  if (
    evidence.dayEvents.length === 0 &&
    evidence.workItemEvents.length === 0 &&
    evidence.workItemNoteCount === 0 &&
    evidence.sessions.length > 0
  ) {
    reviewItems.push("Нет событий дня, заметок дел или timestamped-событий дел. Если без памяти день не восстановить, добавь контекст перед финальным отчётом.");
  }

  if (evidence.sessions.length > 0 && evidence.workItemTotals.length > 0 && evidence.telemetry.workItemTimeBadgeReviews === 0) {
    reviewItems.push("Нет подтверждения проверки времени по затронутым делам. Посмотри карточки дел за день и прими эту проверку перед закрытием цели.");
  }

  if (evidence.dayEvents.length > 0 && evidence.dayEventsWithZone === 0) {
    reviewItems.push("События дня есть, но ни у одного нет зоны активности. Перед финальным вердиктом выбери зону: буфер, восстановление, простой, координация или личное; либо подтверди, что это не нужно.");
  }

  if (evidence.workItemEvents.length === 0 && evidence.sessions.length > 0) {
    reviewItems.push("Нет timestamped-событий дел. Если важны детали конкретной задачи, добавь событие или подними отвлечение в событие, не полагаясь на память.");
  }

  if (evidence.openCaptures.length > 0 && evidence.telemetry.captureFollowupReviews === 0) {
    reviewItems.push(`${evidence.openCaptures.length} открытых отвлечений осталось. Закрой, преврати в дело или явно оставь открытыми.`);
  }

  if (evidence.capturesCreatedToday.length === 0 && evidence.telemetry.captureUsageReviews === 0) {
    reviewItems.push("Сегодня не было отвлечений. Если отвлечения были, инбокс отвлечений не проверен в бою.");
  }

  if (evidence.capturesCreatedToday.length > 0 && evidence.capturesDuringActiveFocus === 0 && evidence.telemetry.captureUsageReviews === 0) {
    reviewItems.push("Capture создавались, но ни один не связан с активной фокус-сессией. Inbox ещё не доказал, что умеет удерживать фокус при отвлечениях.");
  }

  if (evidence.telemetry.total === 0) {
    reviewItems.push("За эту дату нет событий телеметрии приложения.");
  }

  if (
    evidence.sessions.length > 0 &&
    evidence.telemetry.startRequests + evidence.telemetry.switchRequests === 0 &&
    evidence.telemetry.entryPathReviews === 0
  ) {
    reviewItems.push("Нет событий телеметрии о старте или переключении фокуса. Цена входа за этот день не доказана.");
  }

  if (evidence.sessions.length > 0 && evidence.telemetry.typedEntryRequests === 0 && evidence.telemetry.entryPathReviews === 0) {
    reviewItems.push("Нет входа через ввод названия. Перед закрытием цели стартуй новое дело вводом названия или явно прими эту проверку.");
  }

  if (evidence.sessions.length > 0 && evidence.telemetry.selectedEntryRequests === 0 && evidence.telemetry.entryPathReviews === 0) {
    reviewItems.push("Нет входа через выбранное дело из списка. Перед закрытием цели продолжи существующее дело из списка или явно прими эту проверку.");
  }

  if (evidence.sessions.length > 0 && evidence.telemetry.stopRequests === 0 && evidence.telemetry.entryPathReviews === 0) {
    reviewItems.push("Нет событий телеметрии об остановке фокуса. Сценарий остановки за этот день не доказан.");
  }

  if (
    evidence.telemetry.total > 0 &&
    evidence.telemetry.windowShown + evidence.telemetry.windowHidden === 0 &&
    evidence.telemetry.windowEntrypointReviews === 0
  ) {
    reviewItems.push("Нет событий телеметрии о показе или скрытии окна. Трение входа через окно за этот день не доказано.");
  }

  if (evidence.telemetry.total > 0 && evidence.telemetry.windowShowRequested === 0 && evidence.telemetry.windowEntrypointReviews === 0) {
    reviewItems.push("Нет события телеметрии о запросе показать окно. Проверь вход через меню, горячую клавишу или повторное открытие приложения либо явно прими эту проверку перед закрытием цели.");
  }

  if (evidence.telemetry.total > 0 && evidence.telemetry.windowHideRequested === 0 && evidence.telemetry.windowEntrypointReviews === 0) {
    reviewItems.push("Нет события телеметрии о запросе скрыть окно. Проверь скрытие через Esc, закрытие окна или меню либо явно прими эту проверку перед закрытием цели.");
  }

  if (evidence.telemetry.apiErrors > 0) {
    reviewItems.push(`Найдено API-ошибок: ${evidence.telemetry.apiErrors}. Проверь, не потерялись ли данные трекинга.`);
  }

  if (evidence.telemetry.copyFailures > 0 || evidence.telemetry.manualCopyFallbacks > 0) {
    reviewItems.push("При копировании отчёта было трение. Проверь, осталось ли вечернее экспортирование достаточно дешёвым.");
  }

  if (evidence.telemetry.startFailures > 0 || evidence.telemetry.stopFailures > 0) {
    reviewItems.push("Были ошибки старта/остановки фокуса. Проверь, не сломали ли они доверие к таймеру.");
  }

  if (evidence.telemetry.captureFailures > 0) {
    reviewItems.push(`Найдено ошибок инбокса отвлечений: ${evidence.telemetry.captureFailures}. Проверь, остался ли захват отвлечений надёжным.`);
  }

  if (evidence.telemetry.correctionFailures > 0) {
    reviewItems.push(`Найдено ошибок коррекции фокуса: ${evidence.telemetry.correctionFailures}. Проверь, можно ли было исправить трекинг перед финальным отчётом.`);
  }

  if (evidence.telemetry.corrections === 0 && evidence.telemetry.correctionReviews === 0 && evidence.sessions.length > 0) {
    reviewItems.push("Нет коррекции фокуса и нет подтверждения проверки коррекций. Если коррекция не требовалась, явно прими это; иначе проверь add/edit/split перед закрытием цели.");
  }

  if (evidence.telemetry.dayClosureCompletions === 0 || evidence.telemetry.lastDayClosureDurationSeconds == null) {
    reviewItems.push(
      "Длительность закрытия дня не измерена. Начни закрытие кнопкой «Начать закрытие дня», дойди до финального «Копировать отчёт» за 10 минут или меньше, затем пересохрани evidence."
    );
  } else if (evidence.telemetry.lastDayClosureDurationSeconds > 10 * 60) {
    reviewItems.push(
      `Последнее закрытие дня заняло ${formatDuration(evidence.telemetry.lastDayClosureDurationSeconds)}, это больше цели 10:00. Повтори вечернее закрытие спокойным коротким проходом.`
    );
  }

  if (evidence.unexplainedGapCount > 0) {
    reviewItems.push(
      `${evidence.unexplainedGapCount} из ${evidence.gaps.length} больших разрывов без события дня. Используй «Объяснить» или добавь событие дня перед закрытием цели.`
    );
  }

  return {
    hardBlockers,
    reviewItems,
  };
}

function buildMissingDbReport(date, path) {
  return [
    `# Проверка закрытия дня Timeskein - ${date}`,
    "",
    "Вердикт: заблокировано",
    "",
    `База не найдена: ${path}`,
    "",
  ].join("\n");
}

function buildRcReport(date, path, evidence, assessment, minFocusSeconds, strict) {
  const verdict = formatRcVerdict(assessment, strict);

  const lines = [
    `# Проверка закрытия дня Timeskein - ${date}`,
    "",
    `Вердикт: ${verdict}`,
    `База: ${path}`,
    `Строгий режим: ${formatYesNo(strict)}`,
    "",
    "## Сводка доказательств",
    "",
    `- Всего учтено: ${formatDuration(evidence.totalFocusSeconds)} (порог проверки: ${formatDuration(minFocusSeconds)})`,
    `- Рабочий фокус: ${formatDuration(evidence.workFocusSeconds)}`,
    `- Нерабочее учтено: ${formatDuration(evidence.nonWorkSeconds)}`,
    `- Входов: ${evidence.sessions.length}`,
    `- Дел в отчёте: ${evidence.workItemTotals.length}`,
    `- Проверок времени по делам: ${evidence.telemetry.workItemTimeBadgeReviews}`,
    `- Заметок дел в отчёте: ${evidence.workItemNoteCount}`,
    `- Событий дня: ${evidence.dayEvents.length}`,
    `- Событий дня с зоной активности: ${evidence.dayEventsWithZone}`,
    `- Событий дня во время активного фокуса: ${evidence.dayEventsDuringActiveFocus}`,
    `- Событий дел: ${evidence.workItemEvents.length}`,
    `- Событий дел во время активного фокуса: ${evidence.workItemEventsDuringActiveFocus}`,
    `- Зон активности в отчёте: ${evidence.activityZoneTotals.length}`,
    `- Больших разрывов: ${evidence.gaps.length}`,
    `- Больших разрывов объяснено: ${Math.min(evidence.gapExplanationEvents, evidence.gaps.length)}/${evidence.gaps.length}`,
    `- Отвлечений создано сегодня: ${evidence.capturesCreatedToday.length}`,
    `- Отвлечений во время активного фокуса: ${evidence.capturesDuringActiveFocus}`,
    `- Открытых отвлечений: ${evidence.openCaptures.length}`,
    `- Проверок открытых отвлечений: ${evidence.telemetry.captureFollowupReviews}`,
    `- Проверок зон активности: ${evidence.telemetry.activityZoneReviews}`,
    `- Проверок использования инбокса: ${evidence.telemetry.captureUsageReviews}`,
    `- Проверок путей входа: ${evidence.telemetry.entryPathReviews}`,
    `- Проверок входа через окно: ${evidence.telemetry.windowEntrypointReviews}`,
    `- Событий телеметрии приложения: ${evidence.telemetry.total}`,
    `- Запросов старт/переключение/остановка: ${evidence.telemetry.startRequests}/${evidence.telemetry.switchRequests}/${evidence.telemetry.stopRequests}`,
    `- Входов вводом/из списка: ${evidence.telemetry.typedEntryRequests}/${evidence.telemetry.selectedEntryRequests}`,
    `- API-ошибок: ${evidence.telemetry.apiErrors}`,
    `- Ошибок копирования/ручного копирования: ${evidence.telemetry.copyFailures}/${evidence.telemetry.manualCopyFallbacks}`,
    `- Ошибок старта/остановки: ${evidence.telemetry.startFailures}/${evidence.telemetry.stopFailures}`,
    `- Ошибок инбокса отвлечений: ${evidence.telemetry.captureFailures}`,
    `- Коррекций запрошено/применено/проверено/ошибок: ${evidence.telemetry.correctionRequests}/${evidence.telemetry.corrections}/${evidence.telemetry.correctionReviews}/${evidence.telemetry.correctionFailures}`,
    `- Закрытий дня начато/завершено: ${evidence.telemetry.dayClosureStarts}/${evidence.telemetry.dayClosureCompletions}`,
    `- Последняя длительность закрытия дня: ${evidence.telemetry.lastDayClosureDurationSeconds == null ? "нет данных" : formatDuration(evidence.telemetry.lastDayClosureDurationSeconds)}`,
    `- Окно показано/скрыто: ${evidence.telemetry.windowShown}/${evidence.telemetry.windowHidden}`,
    `- Запросы показать/скрыть окно: ${evidence.telemetry.windowShowRequested}/${evidence.telemetry.windowHideRequested}`,
    `- Начатых перетаскиваний окна: ${evidence.telemetry.windowDragStarted}`,
    `- Групп дублей названий дел: ${evidence.duplicateTitles.length}`,
    "",
  ];

  lines.push(...formatGoalAuditMarkdown(evidence, assessment, minFocusSeconds), "");

  if (evidence.workItemTotals.length > 0) {
    lines.push("## По делам", "", "| Длительность | Входов | Дело |", "| ---: | ---: | --- |");
    for (const item of evidence.workItemTotals) {
      lines.push(`| ${formatDuration(item.activeSeconds)} | ${item.entrances} | ${escapeMarkdownTable(item.title)} |`);
    }
    lines.push("");
  }

  if (evidence.activityZoneTotals.length > 0) {
    lines.push("## По зонам активности", "", "| Длительность | Входов | Зона |", "| ---: | ---: | --- |");
    for (const item of evidence.activityZoneTotals) {
      lines.push(`| ${formatDuration(item.activeSeconds)} | ${item.entrances} | ${escapeMarkdownTable(formatActivityZoneLabel(item.zone))} |`);
    }
    lines.push("");
  }

  if (evidence.dayEvents.length > 0) {
    lines.push("## События дня", "", "| Время | Зона | Во время фокуса | Событие |", "| --- | --- | --- | --- |");
    for (const event of evidence.dayEvents) {
      lines.push(
        `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(event.activity_zone ? formatActivityZoneLabel(event.activity_zone) : "")} | ${escapeMarkdownTable(event.focus_session_id ? "да" : "")} | ${escapeMarkdownTable(event.text)} |`
      );
    }
    lines.push("");
  }

  if (evidence.workItemEvents.length > 0) {
    lines.push("## События дел", "", "| Время | Дело | Во время фокуса | Событие |", "| --- | --- | --- | --- |");
    for (const event of evidence.workItemEvents) {
      lines.push(
        `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(event.work_item_title ?? "неизвестное дело")} | ${escapeMarkdownTable(event.focus_session_id ? "да" : "")} | ${escapeMarkdownTable(event.text)} |`
      );
    }
    lines.push("");
  }

  if (evidence.capturesCreatedToday.length > 0) {
    lines.push(formatCaptureActivityMarkdown(evidence.capturesCreatedToday).trim(), "");
  }

  if (assessment.hardBlockers.length > 0) {
    lines.push("## Что мешает", "");
    for (const item of assessment.hardBlockers) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (assessment.reviewItems.length > 0) {
    lines.push("## Что проверить", "");
    for (const item of assessment.reviewItems) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push(
    "## Ручной вердикт",
    "",
    "- Timeskein был основным трекером всего дня: да/нет",
    "- Зоны активности достаточно отделили работу от координации, восстановления, простоя и личных дел: да/нет",
    "- События дня, события дел или заметки снизили восстановление дня по памяти: да/нет",
    "- Ошибки трекинга можно было исправить перед финальным отчётом: да/нет",
    "- Capture Inbox удерживал фокус, а не стал ещё одной кучей: да/нет",
    "- Отчёта достаточно без реконструкции по памяти: да/нет",
    "- Оставшиеся ограничения приемлемы для ежедневного использования: да/нет",
    "- Финальное решение: годится/не годится",
    "",
    "## Что дальше",
    "",
    "- Если есть красные пункты, исправь только их и проведи ещё один день Timeskein.",
    "- Если остались пункты проверки, заполни ручной вердикт перед закрытием текущей цели.",
    "- Если вердикт «годится», обнови docs/opskarta и закоммить рабочую точку пробной эксплуатации.",
    ""
  );

  return lines.join("\n");
}

function formatRcVerdict(assessment, strict) {
  if (assessment.hardBlockers.length > 0) {
    return "заблокировано";
  }

  if (strict && assessment.reviewItems.length > 0) {
    return "заблокировано пунктами проверки в strict-режиме";
  }

  if (assessment.reviewItems.length > 0) {
    return "готово к ручному вердикту, есть пункты проверки";
  }

  return "готово к ручному вердикту";
}

function formatYesNo(value) {
  return value ? "да" : "нет";
}

function formatGoalAuditMarkdown(evidence, assessment, minFocusSeconds) {
  const gapCaptureStatus = evidence.sessions.length === 0
    ? "block"
    : evidence.unexplainedGapCount > 0 ||
        (evidence.openCaptures.length > 0 && evidence.telemetry.captureFollowupReviews === 0) ||
        (evidence.capturesCreatedToday.length === 0 && evidence.telemetry.captureUsageReviews === 0) ||
        (evidence.capturesCreatedToday.length > 0 && evidence.capturesDuringActiveFocus === 0 && evidence.telemetry.captureUsageReviews === 0)
      ? "review"
      : "pass";
  const windowRequestsCovered =
    evidence.telemetry.windowShowRequested > 0 && evidence.telemetry.windowHideRequested > 0;
  const windowFailureCount =
    evidence.telemetry.apiErrors +
    evidence.telemetry.copyFailures +
    evidence.telemetry.startFailures +
    evidence.telemetry.stopFailures;
  const entryPathsCovered =
    evidence.telemetry.typedEntryRequests > 0 &&
    evidence.telemetry.selectedEntryRequests > 0 &&
    evidence.telemetry.stopRequests > 0;
  const workItemTimeReviewEvidence = evidence.telemetry.workItemTimeBadgeReviews > 0
    ? formatCount(evidence.telemetry.workItemTimeBadgeReviews, "проверка времени по карточкам", "проверки времени по карточкам", "проверок времени по карточкам")
    : "проверка времени по карточкам не отмечена";
  const activityZoneReviewEvidence = evidence.telemetry.activityZoneReviews > 0
    ? formatCount(evidence.telemetry.activityZoneReviews, "проверка зон", "проверки зон", "проверок зон")
    : evidence.activityZoneTotals.length > 1 && evidence.nonWorkSeconds > 0
      ? "зоны подтверждены отчётом"
      : "проверка зон не отмечена";
  const entryPathReviewEvidence = evidence.telemetry.entryPathReviews > 0
    ? formatCount(evidence.telemetry.entryPathReviews, "проверка пути входа", "проверки путей входа", "проверок путей входа")
    : entryPathsCovered
      ? "пути входа покрыты телеметрией"
      : "пути входа не проверены";
  const windowEntrypointReviewEvidence = evidence.telemetry.windowEntrypointReviews > 0
    ? formatCount(evidence.telemetry.windowEntrypointReviews, "проверка окна", "проверки окна", "проверок окна")
    : windowRequestsCovered
      ? "входы через окно покрыты телеметрией"
      : "входы через окно не проверены";
  const workItemTotalsEvidence = `${formatCount(evidence.workItemTotals.length, "строка итогов дел", "строки итогов дел", "строк итогов дел")}; ${workItemTimeReviewEvidence}`;
  const activityZoneEvidence = `${formatCount(evidence.activityZoneTotals.length, "зона", "зоны", "зон")}; ${formatDuration(evidence.workFocusSeconds)} работа, ${formatDuration(evidence.nonWorkSeconds)} вне работы; ${activityZoneReviewEvidence}`;
  const gapCaptureEvidence = [
    formatCount(evidence.gaps.length, "большой разрыв", "больших разрыва", "больших разрывов"),
    formatCount(Math.min(evidence.gapExplanationEvents, evidence.gaps.length), "разрыв объяснён", "разрыва объяснены", "разрывов объяснено"),
    evidence.openCaptures.length > 0
      ? formatCount(evidence.openCaptures.length, "открытое отвлечение", "открытых отвлечения", "открытых отвлечений")
      : "открытых отвлечений нет",
    formatReviewEvidence(evidence.telemetry.captureFollowupReviews, "открытые отвлечения не проверены", "проверка открытых отвлечений", "проверки открытых отвлечений", "проверок открытых отвлечений"),
    formatReviewEvidence(evidence.telemetry.captureUsageReviews, "инбокс не проверен", "проверка инбокса", "проверки инбокса", "проверок инбокса"),
    `${evidence.capturesDuringActiveFocus}/${evidence.capturesCreatedToday.length} отвлечений во время активного фокуса`,
  ].join("; ");
  const windowEvidence = [
    `окно показывалось ${evidence.telemetry.windowShown} раз, скрывалось ${evidence.telemetry.windowHidden} раз`,
    `${formatCount(evidence.telemetry.windowShowRequested, "запрос на показ", "запроса на показ", "запросов на показ")}, ${formatCount(evidence.telemetry.windowHideRequested, "запрос на скрытие", "запроса на скрытие", "запросов на скрытие")}`,
    formatCount(evidence.telemetry.windowDragStarted, "начало перетаскивания", "начала перетаскивания", "начал перетаскивания"),
    windowEntrypointReviewEvidence,
    evidence.telemetry.apiErrors > 0
      ? formatCount(evidence.telemetry.apiErrors, "ошибка API", "ошибки API", "ошибок API")
      : "ошибок API нет",
  ].join("; ");
  const entryPathEvidence = [
    formatCount(evidence.telemetry.typedEntryRequests, "старт вводом", "старта вводом", "стартов вводом"),
    formatCount(evidence.telemetry.selectedEntryRequests, "старт из списка", "старта из списка", "стартов из списка"),
    formatCount(evidence.telemetry.stopRequests, "остановка", "остановки", "остановок"),
    entryPathReviewEvidence,
  ].join("; ");
  const correctionEvidence = formatCorrectionEvidence({
    requested: evidence.telemetry.correctionRequests,
    applied: evidence.telemetry.corrections,
    reviewed: evidence.telemetry.correctionReviews,
    failures: evidence.telemetry.correctionFailures,
  });
  const closureEvidence = formatClosureEvidence(
    { left: evidence.telemetry.dayClosureStarts, right: evidence.telemetry.dayClosureCompletions },
    evidence.telemetry.lastDayClosureDurationSeconds
  );

  const rows = [
    {
      requirement: "Final state clean",
      status: evidence.activeSessions.length === 0 && evidence.activeWorkItems.length === 0 ? "pass" : "block",
      evidence: `${formatCount(evidence.activeSessions.length, "активная фокус-сессия", "активные фокус-сессии", "активных фокус-сессий")}, ${formatCount(evidence.activeWorkItems.length, "дело", "дела", "дел")} с активным статусом`,
    },
    {
      requirement: "Focus blocks visible",
      status: evidence.sessions.length === 0
        ? "block"
        : evidence.totalFocusSeconds >= minFocusSeconds
          ? "pass"
          : "review",
      evidence: `${formatCount(evidence.sessions.length, "вход", "входа", "входов")}, ${formatDuration(evidence.totalFocusSeconds)} учтено`,
    },
    {
      requirement: "Work Item totals available",
      status: evidence.workItemTotals.length === 0
        ? "block"
        : evidence.telemetry.workItemTimeBadgeReviews > 0
          ? "pass"
          : "review",
      evidence: workItemTotalsEvidence,
    },
    {
      requirement: "Activity Zones separated",
      status: evidence.sessions.length === 0
        ? "block"
        : (evidence.activityZoneTotals.length > 1 && evidence.nonWorkSeconds > 0) || evidence.telemetry.activityZoneReviews > 0
          ? "pass"
          : "review",
      evidence: activityZoneEvidence,
    },
    {
      requirement: "Day and Work Item context present",
      status: evidence.dayEvents.length + evidence.workItemEvents.length + evidence.workItemNoteCount > 0
        ? "pass"
        : "review",
      evidence: `${evidence.dayEvents.length} событий дня, ${evidence.workItemEvents.length} событий дел, ${evidence.workItemNoteCount} заметок дел`,
    },
    {
      requirement: "Gaps and captures visible",
      status: gapCaptureStatus,
      evidence: gapCaptureEvidence,
    },
    {
      requirement: "Window and menubar friction evidenced",
      status:
        evidence.telemetry.total > 0 &&
        windowFailureCount === 0 &&
        (windowRequestsCovered || evidence.telemetry.windowEntrypointReviews > 0)
          ? "pass"
          : "review",
      evidence: windowEvidence,
    },
    {
      requirement: "Start and continue paths evidenced",
      status: evidence.sessions.length === 0
        ? "block"
        : entryPathsCovered || evidence.telemetry.entryPathReviews > 0
          ? "pass"
          : "review",
      evidence: entryPathEvidence,
    },
    {
      requirement: "Tracking correction or review evidenced",
      status: evidence.sessions.length === 0
        ? "block"
        : evidence.telemetry.corrections > 0 || evidence.telemetry.correctionReviews > 0
          ? "pass"
          : "review",
      evidence: correctionEvidence,
    },
    {
      requirement: "Day closure duration measured",
      status:
        evidence.telemetry.dayClosureCompletions > 0 &&
        evidence.telemetry.lastDayClosureDurationSeconds != null &&
        evidence.telemetry.lastDayClosureDurationSeconds <= 10 * 60
          ? "pass"
          : "review",
      evidence: closureEvidence,
    },
    {
      requirement: "Hard blockers absent",
      status: assessment.hardBlockers.length === 0 ? "pass" : "block",
      evidence: formatCount(assessment.hardBlockers.length, "красный пункт", "красных пункта", "красных пунктов"),
    },
    {
      requirement: "Local gates",
      status: "manual",
      evidence: "Запусти pnpm dogfood:goal-check -- --no-codex-guidance на том же коде перед закрытием цели",
    },
  ];

  return [
    "## Проверка закрытия дня",
    "",
    "| Проверка | Статус | Доказательство |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${escapeMarkdownTable(formatGoalAuditRequirement(row.requirement))} | ${escapeMarkdownTable(formatGoalAuditStatus(row.status))} | ${escapeMarkdownTable(row.evidence)} |`
    ),
  ];
}

function formatCaptureActivityMarkdown(captures) {
  const lines = [
    "## История отвлечений",
    "",
    "| Время | Состояние | Отвлечение | Во время | Результат |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const capture of captures) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(capture.created_at))} | ${escapeMarkdownTable(formatCaptureState(capture.state))} | ${escapeMarkdownTable(capture.text)} | ${escapeMarkdownTable(formatCaptureDuring(capture))} | ${escapeMarkdownTable(formatCaptureOutcome(capture))} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatGoalAuditRequirement(requirement) {
  const labels = new Map([
    ["Final state clean", "Финальное состояние чистое"],
    ["Focus blocks visible", "Фокус-блоки видны"],
    ["Work Item totals available", "Итоги по делам есть"],
    ["Activity Zones separated", "Зоны активности разделены"],
    ["Day and Work Item context present", "Контекст дня и дел сохранён"],
    ["Gaps and captures visible", "Разрывы и отвлечения видны"],
    ["Window and menubar friction evidenced", "Окно и строка меню проверены"],
    ["Start and continue paths evidenced", "Старт и продолжение проверены"],
    ["Tracking correction or review evidenced", "Коррекция трекинга проверена"],
    ["Day closure duration measured", "Длительность закрытия измерена"],
    ["Hard blockers absent", "Красных пунктов нет", "Жёстких блокеров нет"],
    ["Local gates", "Локальные проверки"],
  ]);

  return labels.get(requirement) ?? requirement;
}

function formatGoalAuditStatus(status) {
  const labels = new Map([
    ["pass", "ок"],
    ["review", "проверить"],
    ["block", "красный пункт", "блокер"],
    ["manual", "вручную"],
  ]);

  return labels.get(status) ?? status;
}

function formatCaptureState(state) {
  const labels = new Map([
    ["open", "открыто"],
    ["resolved", "закрыто"],
    ["converted", "превращено"],
  ]);

  return labels.get(state) ?? state;
}

function formatCaptureDuring(capture) {
  if (!capture.focus_session_id) {
    return "нет активного фокуса";
  }

  return capture.focus_work_item_title ?? capture.focus_title ?? "связанный фокус-блок";
}

function formatCaptureOutcome(capture) {
  if (capture.state === "resolved") {
    return `закрыто ${formatClockTime(capture.resolved_at ?? capture.updated_at)}`;
  }

  if (capture.state === "converted") {
    const itemTitle = capture.work_item_title ? ` -> ${capture.work_item_title}` : "";
    return `превращено ${formatClockTime(capture.converted_at ?? capture.updated_at)}${itemTitle}`;
  }

  return "открыто";
}

function isGapExplanationText(text) {
  return /\bopen\s+gap\b|\bgap\b|разрыв|перерыв|буфер|recovery|восстановлен/i.test(text ?? "");
}

function clippedActiveSeconds(startedAtValue, stoppedAtValue, from, to, now) {
  const startedAt = new Date(startedAtValue);
  const stoppedAt = stoppedAtValue ? new Date(stoppedAtValue) : now;
  const clippedStart = new Date(Math.max(startedAt.getTime(), from.getTime()));
  const clippedStop = new Date(Math.min(stoppedAt.getTime(), to.getTime()));

  return Math.max(Math.floor((clippedStop.getTime() - clippedStart.getTime()) / 1000), 0);
}

function aggregateWorkItemTotals(sessions) {
  const totals = new Map();

  for (const session of sessions) {
    const key = session.work_item_id ?? `title:${session.title}`;
    const title = session.work_item_title ?? session.title;
    const current = totals.get(key) ?? { title, note: undefined, activeSeconds: 0, entrances: 0 };

    current.title = title;
    if (session.work_item_note) {
      current.note = session.work_item_note;
    }
    current.activeSeconds += session.active_seconds;
    current.entrances += 1;
    totals.set(key, current);
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.activeSeconds !== left.activeSeconds) {
      return right.activeSeconds - left.activeSeconds;
    }

    return left.title.localeCompare(right.title);
  });
}

function aggregateActivityZoneTotals(sessions) {
  const totals = new Map();

  for (const session of sessions) {
    const zone = session.activity_zone ?? WORK_ACTIVITY_ZONE;
    const current = totals.get(zone) ?? { zone, activeSeconds: 0, entrances: 0 };

    current.activeSeconds += session.active_seconds;
    current.entrances += 1;
    totals.set(zone, current);
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.activeSeconds !== left.activeSeconds) {
      return right.activeSeconds - left.activeSeconds;
    }

    return left.zone.localeCompare(right.zone);
  });
}

function getZoneActiveSeconds(zoneTotals, zone) {
  return zoneTotals.find((item) => item.zone === zone)?.activeSeconds ?? 0;
}

function gapsBetweenSessions(sessionsOldestFirst) {
  return sessionsOldestFirst.slice(1).map((session, index) => {
    const previous = sessionsOldestFirst[index];
    const previousEnd = previous.stopped_at ?? previous.started_at;
    const seconds = Math.max(
      Math.floor((new Date(session.started_at).getTime() - new Date(previousEnd).getTime()) / 1000),
      0
    );

    return {
      from: previousEnd,
      to: session.started_at,
      seconds,
    };
  });
}

function formatActivityZoneLabel(zone) {
  switch (zone) {
    case "work":
      return "Работа";
    case "coordination":
      return "Координация";
    case "recovery":
      return "Восстановление";
    case "idle":
      return "Простой";
    case "personal":
      return "Личное";
    default:
      return zone;
  }
}

function summarizeEvents(events) {
  const byKind = {};
  const pendingClosures = new Map();
  const closureDurationsSeconds = [];

  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;

    if (event.kind === "day_closure_started") {
      const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId) pendingClosures.set(actionId, new Date(event.ts).getTime());
    }

    if (event.kind === "day_closure_completed") {
      const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId && pendingClosures.has(actionId)) {
        closureDurationsSeconds.push(Math.floor(Math.max(new Date(event.ts).getTime() - pendingClosures.get(actionId), 0) / 1000));
        pendingClosures.delete(actionId);
      }
    }
  }

  const count = (kind) => byKind[kind] ?? 0;

  return {
    total: events.length,
    byKind,
    apiErrors: count("api_error"),
    startRequests: count("focus_start_requested"),
    switchRequests: count("focus_switch_requested"),
    stopRequests: count("focus_stop_requested"),
    typedEntryRequests: countEntryRequestsByControls(events, ["typed"]),
    selectedEntryRequests: countEntryRequestsByControls(events, ["selected_item", "selected_shortcut", "double_click"]),
    copyFailures: count("report_copy_failed"),
    manualCopyFallbacks: count("manual_copy_fallback_shown"),
    startFailures: count("focus_start_failed"),
    stopFailures: count("focus_stop_failed"),
    correctionRequests: count("focus_correction_requested"),
    corrections: count("focus_corrected"),
    correctionReviews: count("focus_correction_reviewed"),
    correctionFailures: count("focus_correction_failed"),
    dayClosureStarts: count("day_closure_started"),
    dayClosureCompletions: count("day_closure_completed"),
    lastDayClosureDurationSeconds: closureDurationsSeconds.at(-1),
    captureFollowupReviews: count("capture_followup_reviewed"),
    workItemTimeBadgeReviews: count("work_item_time_badges_reviewed"),
    activityZoneReviews: count("activity_zone_reviewed"),
    captureUsageReviews: count("capture_usage_reviewed"),
    entryPathReviews: count("entry_paths_reviewed"),
    windowEntrypointReviews: count("window_entrypoints_reviewed"),
    windowShown: count("window_shown"),
    windowHidden: count("window_hidden"),
    windowShowRequested: count("window_show_requested"),
    windowHideRequested: count("window_hide_requested"),
    windowDragStarted: count("window_drag_started"),
    captureFailures:
      count("capture_create_failed") +
      count("capture_resolve_failed") +
      count("capture_update_failed") +
      count("capture_delete_failed") +
      count("capture_convert_failed"),
  };
}

function countEntryRequestsByControls(events, controls) {
  const allowedControls = new Set(controls);

  return events.filter((event) => {
    if (event.kind !== "focus_start_requested" && event.kind !== "focus_switch_requested") {
      return false;
    }

    const control = event.payload?.control;
    return typeof control === "string" && allowedControls.has(control);
  }).length;
}

function parsePayload(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseIsoDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --now value, expected ISO date: ${value}`);
  }

  return date;
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function nextLocalDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(Math.floor(totalSeconds), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function pluralRu(value, one, few, many) {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatCount(value, one, few, many) {
  return `${value} ${pluralRu(value, one, few, many)}`;
}

function formatReviewEvidence(value, emptyText, one, few, many) {
  return value > 0 ? formatCount(value, one, few, many) : emptyText;
}

function formatCorrectionEvidence(telemetry) {
  return [
    telemetry.requested > 0
      ? formatCount(telemetry.requested, "запрос коррекции", "запроса коррекции", "запросов коррекции")
      : "запросов коррекции не было",
    telemetry.applied > 0
      ? formatCount(telemetry.applied, "применённая коррекция", "применённые коррекции", "применённых коррекций")
      : "коррекций не было",
    formatReviewEvidence(telemetry.reviewed, "проверка трекинга не отмечена", "проверка трекинга", "проверки трекинга", "проверок трекинга"),
    telemetry.failures > 0
      ? formatCount(telemetry.failures, "ошибка коррекции", "ошибки коррекции", "ошибок коррекции")
      : "ошибок коррекции нет",
  ].join("; ");
}

function formatClosureEvidence(closureCounts, lastClosureDuration) {
  if (!closureCounts || (closureCounts.left === 0 && closureCounts.right === 0)) {
    return "закрытие дня ещё не измерялось";
  }
  const durationText = lastClosureDuration == null ? "длительность пока не зафиксирована" : `длительность ${formatDuration(lastClosureDuration)}`;
  return `закрытие начато ${closureCounts.left} раз, завершено ${closureCounts.right} раз; ${durationText}`;
}

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
