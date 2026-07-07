#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const reportDay = options.date ? parseLocalDate(options.date) : new Date();
const reportDate = options.date ?? formatLocalDate(reportDay);
const from = startOfLocalDay(reportDay);
const to = nextLocalDay(from);
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
const exportArgs = [resolve(repoRoot, "scripts/export-focus-day.mjs"), "--db", dbPath, "--internal"];
const metricsArgs = [resolve(repoRoot, "scripts/dogfood-metrics.mjs"), "--db", dbPath, "--raw"];
const REVIEW_TITLE_LABELS = {
  "Stop the active focus block": "Остановить активный фокус-блок",
  "Clear active Work Item state": "Снять активный статус с дела",
  "Resolve, convert, or accept open captures": "Разобрать открытые отвлечения",
  "Classify significant gaps": "Объяснить большие разрывы",
  "Explain current open gap": "Объяснить текущий открытый разрыв",
  "Review Activity Zone coverage": "Проверить зоны активности",
  "Confirm non-work tracked time": "Проверить нерабочее время",
  "Confirm Work Item today/total badges": "Проверить время по делам",
  "Capture Inbox untested today": "Инбокс отвлечений сегодня не проверен",
  "Captures were not linked to active focus": "Отвлечения не были связаны с активным фокусом",
  "No day or Work Item notes/events": "Нет событий дня или дел",
  "Exercise start and continue paths": "Проверить старт и продолжение",
  "Test window entrypoints": "Проверить входы в окно",
  "Review failed focus corrections": "Проверить ошибки коррекции фокуса",
  "Confirm tracking accuracy or test correction": "Подтвердить точность трекинга",
  "Ready to copy final report": "Можно копировать финальный отчёт",
};
const DAILY_CONTROL_REQUIREMENT_LABELS = {
  "Final state clean": "Финальное состояние чистое",
  "Focus blocks visible": "Фокус-блоки видны",
  "Work Item totals available": "Итоги по делам есть",
  "Activity Zones separated": "Зоны активности разделены",
  "Day and Work Item context present": "Контекст дня и дел сохранён",
  "Gaps and captures visible": "Разрывы и отвлечения видны",
  "Window and menubar friction evidenced": "Окно и строка меню проверены",
  "Start and continue paths evidenced": "Старт и продолжение проверены",
  "Tracking correction or review evidenced": "Коррекция трекинга проверена",
  "Day closure duration measured": "Длительность закрытия измерена",
  "Hard blockers absent": "Красных пунктов нет",
};
const DAILY_CONTROL_STATUS_LABELS = {
  block: "красный пункт",
  pass: "ок",
  review: "проверить",
  manual: "вручную",
};
const ACCEPT_AS_IS_REVIEW_TITLES = new Set([
  "Resolve, convert, or accept open captures",
  "Review Activity Zone coverage",
  "Confirm non-work tracked time",
  "Confirm Work Item today/total badges",
  "Capture Inbox untested today",
  "Captures were not linked to active focus",
  "Exercise start and continue paths",
  "Test window entrypoints",
  "Confirm tracking accuracy or test correction",
]);
const REVIEW_ACTION_LABELS_BY_TITLE = {
  "Resolve, convert, or accept open captures": "Оставить открытыми",
  "Classify significant gaps": "Объяснить",
  "Explain current open gap": "Объяснить",
  "Review Activity Zone coverage": "Зоны верны",
  "Confirm non-work tracked time": "Зоны верны",
  "Confirm Work Item today/total badges": "Время верно",
  "Capture Inbox untested today": "Инбокс проверен",
  "Captures were not linked to active focus": "Инбокс проверен",
  "No day or Work Item notes/events": "Добавить контекст",
  "Exercise start and continue paths": "Пути проверены",
  "Test window entrypoints": "Окно проверено",
  "Review failed focus corrections": "Трекинг верен",
  "Confirm tracking accuracy or test correction": "Трекинг верен",
};

const APP_EVENT_KIND_LABELS = {
  app_started: "приложение запущено",
  agent_started: "агент запущен",
  agent_reused: "агент переиспользован",
  agent_stale_runtime_recovered: "устаревшее состояние агента восстановлено",
  api_error: "ошибка API",
  window_shown: "окно показано",
  window_hidden: "окно скрыто",
  window_drag_started: "перетаскивание окна начато",
  window_show_requested: "запрошен показ окна",
  window_hide_requested: "запрошено скрытие окна",
  window_entrypoints_reviewed: "входы в окно проверены",
  focus_start_requested: "запрошен старт фокуса",
  focus_started: "фокус начат",
  focus_switch_requested: "запрошено переключение фокуса",
  focus_switched: "фокус переключён",
  focus_stop_requested: "запрошена остановка фокуса",
  focus_stopped: "фокус остановлен",
  focus_start_failed: "старт фокуса не удался",
  focus_stop_failed: "остановка фокуса не удалась",
  focus_correction_requested: "запрошена коррекция фокуса",
  focus_corrected: "фокус скорректирован",
  focus_correction_reviewed: "коррекция фокуса проверена",
  focus_correction_failed: "коррекция фокуса не удалась",
  capture_create_requested: "запрошено создание отвлечения",
  capture_created: "отвлечение создано",
  capture_resolve_requested: "запрошено закрытие отвлечения",
  capture_resolved: "отвлечение закрыто",
  capture_update_requested: "запрошено исправление отвлечения",
  capture_updated: "отвлечение исправлено",
  capture_delete_requested: "запрошено удаление отвлечения",
  capture_deleted: "отвлечение удалено",
  capture_convert_requested: "запрошено превращение отвлечения в дело",
  capture_converted: "отвлечение превращено в дело",
  capture_create_failed: "создание отвлечения не удалось",
  capture_resolve_failed: "закрытие отвлечения не удалось",
  capture_update_failed: "исправление отвлечения не удалось",
  capture_delete_failed: "удаление отвлечения не удалось",
  capture_convert_failed: "превращение отвлечения не удалось",
  capture_followup_reviewed: "открытые отвлечения проверены",
  capture_usage_reviewed: "инбокс отвлечений проверен",
  work_item_time_badges_reviewed: "время по делам проверено",
  activity_zone_reviewed: "зоны активности проверены",
  entry_paths_reviewed: "пути входа проверены",
  day_closure_started: "закрытие дня начато",
  day_closure_completed: "закрытие дня завершено",
  report_copy_requested: "запрошено копирование отчёта",
  report_copied: "отчёт скопирован",
  report_copy_failed: "копирование отчёта не удалось",
  manual_copy_fallback_shown: "показано ручное копирование",
};

if (options.date) {
  exportArgs.push("--date", options.date);
  metricsArgs.push("--date", options.date);
}

const activeSummary = existsSync(dbPath)
  ? await loadActiveSummary(dbPath, from, to)
  : { activeFocus: undefined, activeWorkItems: [], openCaptures: [], captureActivity: [] };
const { stdout: dayMarkdown } = await execFileAsync(process.execPath, exportArgs, {
  cwd: repoRoot,
  maxBuffer: 10 * 1024 * 1024,
});
const { stdout: telemetryMarkdown } = await execFileAsync(process.execPath, metricsArgs, {
  cwd: repoRoot,
  maxBuffer: 10 * 1024 * 1024,
});

process.stdout.write(
  buildDogfoodReport(
    reportDate,
    dayMarkdown,
    telemetryMarkdown,
    activeSummary.activeFocus,
    activeSummary.activeWorkItems,
    activeSummary.openCaptures,
    activeSummary.captureActivity,
    dayMarkdown
  )
);

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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (result.date && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    throw new Error(`Некорректное значение --date, ожидается YYYY-MM-DD: ${result.date}`);
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:report [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Печатает Markdown-отчёт закрытия дня из локальной SQLite-базы Timeskein.
Отчёт включает дневную картину фокуса, проверку перед отчётом и короткое закрытие.
Если фокус-блок, дело или проверка ещё требуют внимания, отчёт помечается как черновик.`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Некорректное значение --date, ожидается YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
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

async function loadActiveSummary(path, from, to) {
  const [activeFocusRows, activeWorkItems, openCaptures, captureActivity] = await Promise.all([
    queryJson(path, `
      SELECT
        fs.title,
        wi.title AS work_item_title,
        fs.started_at
      FROM focus_sessions fs
      LEFT JOIN work_items wi ON wi.id = fs.work_item_id
      WHERE fs.state = 'active'
      ORDER BY datetime(fs.started_at) DESC
      LIMIT 1
    `),
    queryJson(path, `
      SELECT id, title, updated_at
      FROM work_items
      WHERE deleted_at IS NULL AND state = 'active'
      ORDER BY datetime(updated_at) DESC
    `),
    loadOpenCaptures(path),
    loadCaptureActivity(path, from, to),
  ]);

  const row = activeFocusRows[0];
  if (!row) {
    return { activeFocus: undefined, activeWorkItems, openCaptures, captureActivity };
  }

  const activeSeconds = Math.max(
    Math.floor((Date.now() - new Date(row.started_at).getTime()) / 1000),
    0
  );

  return {
    activeFocus: {
      title: row.work_item_title ?? row.title,
      started_at: row.started_at,
      active_seconds: activeSeconds,
    },
    activeWorkItems,
    openCaptures,
    captureActivity,
  };
}

async function loadOpenCaptures(path) {
  if (!(await tableExists(path, "captures"))) {
    return [];
  }

  return queryJson(path, `
    SELECT id, text, created_at
    FROM captures
    WHERE state = 'open'
    ORDER BY datetime(created_at) ASC
  `);
}

async function loadCaptureActivity(path, from, to) {
  if (!(await tableExists(path, "captures"))) {
    return [];
  }

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

async function tableExists(path, tableName) {
  const rows = await queryJson(
    path,
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`
  );

  return (rows[0]?.count ?? 0) > 0;
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

function buildDogfoodReport(
  date,
  dayMarkdown,
  telemetryMarkdown,
  activeFocus,
  activeWorkItems,
  openCaptures = [],
  captureActivity = [],
  focusMarkdown = dayMarkdown
) {
  const hasActiveWorkItems = activeWorkItems.length > 0;
  const humanFocusMarkdown = formatFocusMarkdownForReport(dayMarkdown);
  const humanTelemetryMarkdown = formatTelemetryForReport(telemetryMarkdown);
  const reviewItems = buildReviewChecklistItems({
    activeFocus,
    activeWorkItems,
    openCaptures,
    captureActivity,
    focusMarkdown,
    telemetryMarkdown,
  });
  const pendingReviewItemCount = countPendingReviewItems(reviewItems);
  const reportState = formatDogfoodReportState({
    activeFocus: Boolean(activeFocus),
    activeWorkItemCount: activeWorkItems.length,
    pendingReviewItemCount,
  });

  const lines = [
    `# Отчёт закрытия дня Timeskein - ${date}`,
    "",
    `Статус отчёта: ${reportState}`,
    "",
  ];

  if (activeFocus) {
    lines.push(
      "## Что мешает финальному отчёту",
      "",
      `- Активное дело: ${activeFocus.title}`,
      `- Старт: ${formatClockTime(activeFocus.started_at)}`,
      `- Текущая длительность: ${formatDuration(activeFocus.active_seconds)}`,
      "- Останови активный блок перед финальным отчётом.",
      ""
    );
  }

  if (!activeFocus && hasActiveWorkItems) {
    lines.push(
      "## Что мешает финальному отчёту",
      "",
      ...activeWorkItems.map((item) => `- Дело с активным статусом: ${item.title}`),
      "- Сними активный статус с дела перед финальным отчётом.",
      ""
    );
  }

  if (openCaptures.length > 0) {
    lines.push(
      "## Открытые отвлечения",
      "",
      ...openCaptures.map((capture) => `- ${formatClockTime(capture.created_at)} ${formatMarkdownListText(capture.text)}`),
      "- Разбери их: закрыть, превратить в дело, добавить событием или явно оставить открытыми.",
      ""
    );
  }

  if (captureActivity.length > 0) {
    lines.push(formatCaptureActivityMarkdown(captureActivity).trim(), "");
  }

  lines.push(formatReviewChecklistMarkdown(reviewItems).trim(), "");
  lines.push(formatDailyControlGoalAuditMarkdown({
    activeFocus,
    activeWorkItems,
    openCaptures,
    captureActivity,
    focusMarkdown,
    telemetryMarkdown,
    reviewItems,
  }).trim(), "");

  lines.push(
    "## Данные фокуса",
    "",
    humanFocusMarkdown.trim(),
    "",
    humanTelemetryMarkdown.trim(),
    "",
    formatShortClosureMarkdown(telemetryMarkdown).trim(),
    "",
    "## Дополнительный разбор",
    "",
    "Этот раздел не обязателен для закрытия дня. Заполняй его только если нужен глубокий разбор или материал для следующей сессии.",
    "",
    "### Доверие к данным",
    "",
    "- Что поправлено вручную:",
    "- Что осталось спорным:",
    "- Где дело слишком широкое или неверное:",
    "",
    "### Разрывы и восстановление",
    "",
    "- Разрывы, объяснённые реальными перерывами:",
    "- Разрывы, похожие на потерянный трекинг:",
    "- Переключения, которые ощущались дорогими:",
    "",
    "### Цена входа",
    "",
    "- Где вход в следующий блок требовал заметного усилия:",
    "- Что помогло вернуться:",
    "- Что Timeskein должен удешевить:",
    "",
    "### Трения Timeskein",
    "",
    "- Старт/переключение/остановка:",
    "- Окно и строка меню:",
    "- Доверие к данным:",
    "",
    "## Вердикт",
    "",
    "- Данных достаточно для разговора о дне: да/нет",
    "- Отчёту можно доверять без пересборки по памяти: да/нет",
    "- Закрытие заняло не больше 10 минут: да/нет",
    "- Следующая правка продукта:",
  );

  return `${lines.join("\n")}\n`;
}

function formatFocusMarkdownForReport(markdown) {
  return localizeActivityZoneCells(markdown)
    .replace(/^# Timeskein focus day - (.+)$/m, "# Фокус-день Timeskein — $1")
    .replace(/^Total tracked:/gm, "Всего учтено:")
    .replace(/^Work focus:/gm, "Рабочий фокус:")
    .replace(/^Non-work tracked:/gm, "Нерабочее учтено:")
    .replace(/^Entrances:/gm, "Входов:")
    .replace(/^\| Time \| Duration \| Zone \| Work Item \| Note \|$/gm, "| Время | Длительность | Зона | Дело | Заметка |")
    .replace(/^## Day-Boundary Blocks$/gm, "## Блоки на границе дня")
    .replace(/: counted as ([^\n]+) inside this day/g, ": учтено как $1 внутри этого дня")
    .replace(/^## By Work Item$/gm, "## По делам")
    .replace(/^\| Duration \| Entrances \| Work Item \|$/gm, "| Длительность | Входов | Дело |")
    .replace(/^## By Activity Zone$/gm, "## По зонам активности")
    .replace(/^\| Duration \| Entrances \| Zone \|$/gm, "| Длительность | Входов | Зона |")
    .replace(/^## Work Item Notes$/gm, "## Заметки дел")
    .replace(/^## Day Events$/gm, "## События дня")
    .replace(/^\| Time \| Zone \| During \| Event \|$/gm, "| Время | Зона | Во время | Событие |")
    .replace(/\| day \|/g, "| день |")
    .replace(/\| linked focus block \|/g, "| связанный фокус-блок |")
    .replace(/^## Work Item Events$/gm, "## События дел")
    .replace(/^\| Time \| Work Item \| During \| Event \|$/gm, "| Время | Дело | Во время | Событие |")
    .replace(/^## Gaps >=/gm, "## Разрывы >=")
    .replace(/^## Open Gap$/gm, "## Текущий открытый разрыв")
    .replace(/ since last stopped block$/gm, " после последнего остановленного блока");
}

function localizeActivityZoneCells(markdown) {
  const englishZoneLabels = {
    Work: "Работа",
    Coordination: "Координация",
    Recovery: "Восстановление",
    Idle: "Простой",
    Personal: "Личное",
  };
  let zoneColumnIndex = null;

  return markdown
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) {
        zoneColumnIndex = null;
        return line;
      }

      const rawCells = line.split("|");
      const cells = rawCells.slice(1, -1).map((cell) => cell.trim());
      const headerZoneIndex = cells.findIndex((cell) => cell === "Zone");
      if (headerZoneIndex !== -1) {
        zoneColumnIndex = headerZoneIndex;
        return line;
      }

      if (zoneColumnIndex == null) {
        return line;
      }

      const rawCellIndex = zoneColumnIndex + 1;
      const current = rawCells[rawCellIndex]?.trim();
      const label = current ? englishZoneLabels[current] : undefined;
      if (!label) {
        return line;
      }

      rawCells[rawCellIndex] = ` ${label} `;
      return rawCells.join("|");
    })
    .join("\n");
}

function formatShortClosureMarkdown(telemetryMarkdown) {
  return [
    "## Короткое закрытие",
    "",
    "- Данным можно доверять: да/нет",
    formatShortClosureDurationLine(telemetryMarkdown),
    "- Главное наблюдение дня:",
    "- Следующий шаг после закрытия:",
  ].join("\n");
}

function formatShortClosureDurationLine(telemetryMarkdown) {
  const closureCounts = parseCountPair(extractLineValue(telemetryMarkdown, "Day closure started/completed"));
  const lastClosureDuration = parseDurationSeconds(extractLineValue(telemetryMarkdown, "Last day closure duration"));

  if (!closureCounts?.right || lastClosureDuration == null) {
    return "- Закрытие уложилось в 10 минут: нет данных (закрытие не измерено)";
  }

  const verdict = lastClosureDuration <= 10 * 60 ? "да" : "нет";
  return `- Закрытие уложилось в 10 минут: ${verdict} (${formatDuration(lastClosureDuration)})`;
}

function formatAppEventKind(kind) {
  return APP_EVENT_KIND_LABELS[kind] ?? kind;
}

function formatTelemetryForReport(markdown) {
  return markdown
    .replace(/^## App Telemetry$/m, "## Телеметрия приложения")
    .replace(/^Total events:/gm, "Всего событий:")
    .replace(/^Start requests:/gm, "Запросов старта:")
    .replace(/^Switch requests:/gm, "Запросов переключения:")
    .replace(/^Stop requests:/gm, "Запросов остановки:")
    .replace(/^Typed\/selected entry requests:/gm, "Входов вводом/из списка:")
    .replace(/^Start\/stop failures:/gm, "Ошибок старта/остановки:")
    .replace(/^Window shown\/hidden:/gm, "Окно показано/скрыто:")
    .replace(/^Window show\/hide requests:/gm, "Запросы показать/скрыть окно:")
    .replace(/^Window drag starts:/gm, "Начатых перетаскиваний окна:")
    .replace(/^Copy failures:/gm, "Ошибок копирования:")
    .replace(/^Manual copy fallbacks:/gm, "Ручных копирований вместо буфера:")
    .replace(/^Capture created\/resolved\/converted:/gm, "Отвлечений создано/закрыто/превращено:")
    .replace(/^Capture follow-up reviews:/gm, "Проверок открытых отвлечений:")
    .replace(/^Work Item time badge reviews:/gm, "Проверок времени по делам:")
    .replace(/^Activity Zone reviews:/gm, "Проверок зон активности:")
    .replace(/^Capture usage reviews:/gm, "Проверок использования инбокса:")
    .replace(/^Entry path reviews:/gm, "Проверок путей входа:")
    .replace(/^Window entrypoint reviews:/gm, "Проверок входа в окно:")
    .replace(/^Capture updated\/deleted:/gm, "Отвлечений изменено/удалено:")
    .replace(/^Capture failures create\/resolve\/update\/delete\/convert:/gm, "Ошибок отвлечений: создание/закрытие/изменение/удаление/превращение:")
    .replace(/^Corrections requested\/applied\/reviewed\/failed:/gm, "Коррекций запрошено/применено/проверено/ошибок:")
    .replace(/^Day closure started\/completed:/gm, "Закрытий дня начато/завершено:")
    .replace(/^Last day closure duration:/gm, "Последняя длительность закрытия дня:")
    .replace(/^API errors:/gm, "Ошибок API:")
    .replace(/^Already-active start attempts:/gm, "Попыток старта уже активного дела:")
    .replace(/^Stale runtime recoveries:/gm, "Восстановлений устаревшего состояния агента:")
    .replace(/^Average start latency:/gm, "Средняя задержка старта:")
    .replace(/^Slow window-to-focus gaps:/gm, "Медленных переходов окно-фокус:")
    .replace(/^### Events By Kind$/m, "### События по типам")
    .replace(/^\| Count \| Kind \|$/gm, "| Кол-во | Тип |")
    .replace(/: n\/a$/gm, ": нет данных")
    .replace(/(\d+)ms\b/g, "$1 мс")
    .replace(/^\| (\d+) \| ([a-z_]+) \|$/gm, (_line, count, kind) => `| ${count} | ${formatAppEventKind(kind)} |`);
}

function buildReviewChecklistItems({
  activeFocus,
  activeWorkItems,
  openCaptures,
  captureActivity,
  focusMarkdown,
  telemetryMarkdown = "",
}) {
  const items = [];

  if (activeFocus) {
    items.push({
      level: "blocker",
      title: "Stop the active focus block",
      detail: activeFocus.title,
    });
  }

  if (activeWorkItems.length > 0) {
    items.push({
      level: "blocker",
      title: "Clear active Work Item state",
      detail: `${activeWorkItems.length} Work Item с активным статусом`,
    });
  }

  const captureFollowupReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Capture follow-up reviews"));

  if (openCaptures.length > 0 && captureFollowupReviews === 0) {
    items.push({
      level: "review",
      title: "Resolve, convert, or accept open captures",
      detail: `${openCaptures.length} открыто`,
    });
  }

  if (focusMarkdown.includes("## Gaps >=") && !hasGapExplanationEvent(focusMarkdown)) {
    items.push({
      level: "review",
      title: "Classify significant gaps",
      detail: "Проверь секцию больших разрывов",
    });
  }

  if (focusMarkdown.includes("## Open Gap") && !hasOpenGapExplanationEvent(focusMarkdown)) {
    items.push({
      level: "review",
      title: "Explain current open gap",
      detail: "После последнего блока идёт открытый разрыв",
    });
  }

  const activityZoneReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Activity Zone reviews"));
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && countActivityZoneRows(focusMarkdown) <= 1 && activityZoneReviews === 0) {
    items.push({
      level: "review",
      title: "Review Activity Zone coverage",
      detail: "В отчёте видна только одна зона",
    });
  }

  if (focusMarkdown.includes("Non-work tracked: 0:00") && activityZoneReviews === 0) {
    items.push({
      level: "review",
      title: "Confirm non-work tracked time",
      detail: "Перерывы, восстановление, координация или личные дела могли потеряться",
    });
  }

  const workItemTimeBadgeReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Work Item time badge reviews"));
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && workItemTimeBadgeReviews === 0) {
    items.push({
      level: "review",
      title: "Confirm Work Item today/total badges",
      detail: "Проверь, что карточки затронутых дел показывают время за день и всего",
    });
  }

  const captureUsageReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Capture usage reviews"));
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && captureActivity.length === 0 && captureUsageReviews === 0) {
    items.push({
      level: "review",
      title: "Capture Inbox untested today",
      detail: "За день не было ни одного отвлечения",
    });
  }

  if (captureActivity.length > 0 && captureActivity.every((capture) => !capture.focus_session_id) && captureUsageReviews === 0) {
    items.push({
      level: "review",
      title: "Captures were not linked to active focus",
      detail: "Обработка отвлечений в фокусе сегодня не проверена",
    });
  }

  if (
    focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") &&
    !focusMarkdown.includes("## Day Events") &&
    !focusMarkdown.includes("## Work Item Events") &&
    !focusMarkdown.includes("## Work Item Notes")
  ) {
    items.push({
      level: "review",
      title: "No day or Work Item notes/events",
      detail: "Добавь контекст, если отчёт всё ещё требует памяти",
    });
  }

  const correctionTelemetry = parseCorrectionTelemetry(telemetryMarkdown);
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && correctionTelemetry) {
    if (correctionTelemetry.failures > 0) {
      items.push({
        level: "review",
        title: "Review failed focus corrections",
        detail: `${correctionTelemetry.failures} ошибок коррекции`,
      });
    } else if (correctionTelemetry.applied === 0 && correctionTelemetry.reviewed === 0) {
      items.push({
        level: "review",
        title: "Confirm tracking accuracy or test correction",
        detail: "Сегодня не было коррекций фокус-блоков",
      });
    }
  }

  const entryTelemetry = parseEntryTelemetry(telemetryMarkdown);
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && entryTelemetry) {
    const entryPathReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Entry path reviews"));
    if ((entryTelemetry.typedEntryRequests === 0 || entryTelemetry.selectedEntryRequests === 0 || entryTelemetry.stopRequests === 0) && entryPathReviews === 0) {
      items.push({
        level: "review",
        title: "Exercise start and continue paths",
        detail: `${entryTelemetry.typedEntryRequests} вводом, ${entryTelemetry.selectedEntryRequests} из списка, ${entryTelemetry.stopRequests} остановок`,
      });
    }
  }

  const windowTelemetry = parseWindowTelemetry(telemetryMarkdown);
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && windowTelemetry) {
    const windowEntrypointReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Window entrypoint reviews"));
    if ((windowTelemetry.showRequests === 0 || windowTelemetry.hideRequests === 0) && windowEntrypointReviews === 0) {
      items.push({
        level: "review",
        title: "Test window entrypoints",
        detail: `${windowTelemetry.showRequests} запросов показа, ${windowTelemetry.hideRequests} запросов скрытия`,
      });
    }
  }

  if (items.length === 0) {
    items.push({
      level: "ok",
      title: "Ready to copy final report",
      detail: "Автоматических замечаний нет",
    });
  }

  return items;
}

function parseWindowTelemetry(markdown) {
  const match = markdown.match(/Window show\/hide requests:\s*(\d+)\/(\d+)/);
  if (!match) return undefined;

  return {
    showRequests: Number(match[1]),
    hideRequests: Number(match[2]),
  };
}

function formatDailyControlGoalAuditMarkdown({
  activeFocus,
  activeWorkItems,
  openCaptures,
  captureActivity,
  focusMarkdown,
  telemetryMarkdown,
  reviewItems,
}) {
  const hasReview = (title) => reviewItems.some((item) => item.title === title);
  const hasFocusBlocks = focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |");
  const totalTracked = extractLineValue(focusMarkdown, "Total tracked") ?? "n/a";
  const workFocus = extractLineValue(focusMarkdown, "Work focus") ?? "n/a";
  const nonWorkTracked = extractLineValue(focusMarkdown, "Non-work tracked") ?? "n/a";
  const entrances = extractLineValue(focusMarkdown, "Entrances") ?? "0";
  const windowEvidence = extractLineValue(telemetryMarkdown, "Window shown/hidden") ?? "n/a";
  const windowRequestEvidence = extractLineValue(telemetryMarkdown, "Window show/hide requests") ?? "n/a";
  const apiErrors = parseLeadingNumber(extractLineValue(telemetryMarkdown, "API errors"));
  const copyFailures = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Copy failures"));
  const startStopFailures = extractLineValue(telemetryMarkdown, "Start/stop failures") ?? "n/a";
  const entryPathEvidence = extractLineValue(telemetryMarkdown, "Typed/selected entry requests") ?? "n/a";
  const entryTelemetry = parseEntryTelemetry(telemetryMarkdown);
  const captureFollowupReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Capture follow-up reviews"));
  const workItemTimeBadgeReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Work Item time badge reviews"));
  const activityZoneReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Activity Zone reviews"));
  const captureUsageReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Capture usage reviews"));
  const entryPathReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Entry path reviews"));
  const windowEntrypointReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Window entrypoint reviews"));
  const closureCounts = parseCountPair(extractLineValue(telemetryMarkdown, "Day closure started/completed"));
  const lastClosureDuration = parseDurationSeconds(extractLineValue(telemetryMarkdown, "Last day closure duration"));
  const telemetryAvailable = telemetryMarkdown.includes("Total events:");
  const entryPathsCovered =
    entryTelemetry &&
    entryTelemetry.typedEntryRequests > 0 &&
    entryTelemetry.selectedEntryRequests > 0 &&
    entryTelemetry.stopRequests > 0;
  const windowRequestPair = parseCountPair(windowRequestEvidence);
  const windowRequestsCovered = Boolean(windowRequestPair && windowRequestPair.left > 0 && windowRequestPair.right > 0);
  const correctionTelemetry = parseCorrectionTelemetry(telemetryMarkdown);
  const workItemTimeReviewEvidence = workItemTimeBadgeReviews > 0
    ? formatCount(workItemTimeBadgeReviews, "проверка времени по карточкам", "проверки времени по карточкам", "проверок времени по карточкам")
    : hasReview("Confirm Work Item today/total badges")
      ? "проверка времени по карточкам не отмечена"
      : "время по делам есть в отчёте";
  const activityZoneReviewEvidence = activityZoneReviews > 0
    ? formatCount(activityZoneReviews, "проверка зон", "проверки зон", "проверок зон")
    : hasReview("Review Activity Zone coverage") || hasReview("Confirm non-work tracked time")
      ? "проверка зон не отмечена"
      : "зоны подтверждены отчётом";
  const entryPathReviewEvidence = entryPathReviews > 0
    ? formatCount(entryPathReviews, "проверка пути входа", "проверки путей входа", "проверок путей входа")
    : entryPathsCovered
      ? "пути входа покрыты телеметрией"
      : "пути входа не проверены";
  const windowEntrypointReviewEvidence = windowEntrypointReviews > 0
    ? formatCount(windowEntrypointReviews, "проверка окна", "проверки окна", "проверок окна")
    : windowRequestsCovered
      ? "входы через окно покрыты телеметрией"
      : "входы через окно не проверены";
  const workItemTotalsEvidence = focusMarkdown.includes("## By Work Item")
    ? `раздел «По делам» есть; ${workItemTimeReviewEvidence}`
    : "раздела «По делам» нет";
  const activityZoneEvidence = `${workFocus} работа, ${nonWorkTracked} вне работы; ${activityZoneReviewEvidence}`;
  const gapsAndCapturesEvidence = [
    focusMarkdown.includes("## Gaps >=") ? "раздел разрывов есть" : "больших разрывов нет",
    openCaptures.length > 0
      ? formatCount(openCaptures.length, "открытое отвлечение", "открытых отвлечения", "открытых отвлечений")
      : "открытых отвлечений нет",
    captureActivity.length > 0
      ? formatCount(captureActivity.length, "отвлечение за день", "отвлечения за день", "отвлечений за день")
      : "отвлечений за день нет",
    formatReviewEvidence(captureFollowupReviews, "открытые отвлечения не проверены", "проверка открытых отвлечений", "проверки открытых отвлечений", "проверок открытых отвлечений"),
    formatReviewEvidence(captureUsageReviews, "инбокс не проверен", "проверка инбокса", "проверки инбокса", "проверок инбокса"),
  ].join("; ");
  const windowEvidenceText = [
    formatWindowVisibilityEvidence(windowEvidence),
    formatWindowRequestEvidence(windowRequestEvidence),
    windowEntrypointReviewEvidence,
    apiErrors > 0 ? formatCount(apiErrors, "ошибка API", "ошибки API", "ошибок API") : "ошибок API нет",
    formatStartStopFailureEvidence(startStopFailures),
  ].join("; ");
  const entryPathEvidenceText = entryTelemetry
    ? [
        formatCount(entryTelemetry.typedEntryRequests, "старт вводом", "старта вводом", "стартов вводом"),
        formatCount(entryTelemetry.selectedEntryRequests, "старт из списка", "старта из списка", "стартов из списка"),
        formatCount(entryTelemetry.stopRequests, "остановка", "остановки", "остановок"),
        entryPathReviewEvidence,
      ].join("; ")
    : "пути входа: нет телеметрии";
  const correctionEvidenceText = formatCorrectionEvidence(correctionTelemetry);
  const closureEvidenceText = formatClosureEvidence(closureCounts, lastClosureDuration);

  const rows = [
    {
      requirement: "Final state clean",
      status: activeFocus || activeWorkItems.length > 0 ? "block" : "pass",
      evidence: `${formatCount(activeFocus ? 1 : 0, "активный фокус-блок", "активных фокус-блока", "активных фокус-блоков")}, ${formatCount(activeWorkItems.length, "дело", "дела", "дел")} с активным статусом`,
    },
    {
      requirement: "Focus blocks visible",
      status: hasFocusBlocks ? "pass" : "block",
      evidence: `${formatCount(Number(entrances), "вход", "входа", "входов")}, ${totalTracked} учтено`,
    },
    {
      requirement: "Work Item totals available",
      status: focusMarkdown.includes("## By Work Item") && !hasReview("Confirm Work Item today/total badges") ? "pass" : "review",
      evidence: workItemTotalsEvidence,
    },
    {
      requirement: "Activity Zones separated",
      status:
        hasFocusBlocks && ((!hasReview("Review Activity Zone coverage") && !hasReview("Confirm non-work tracked time")) || activityZoneReviews > 0)
          ? "pass"
          : "review",
      evidence: activityZoneEvidence,
    },
    {
      requirement: "Day and Work Item context present",
      status: hasReview("No day or Work Item notes/events") ? "review" : "pass",
      evidence: [
        focusMarkdown.includes("## Day Events") ? "события дня" : "",
        focusMarkdown.includes("## Work Item Events") ? "события дел" : "",
        focusMarkdown.includes("## Work Item Notes") ? "заметки дел" : "",
      ].filter(Boolean).join(", ") || "контекстных секций нет",
    },
    {
      requirement: "Gaps and captures visible",
      status:
        hasReview("Classify significant gaps") ||
        (hasReview("Capture Inbox untested today") && captureUsageReviews === 0) ||
        (hasReview("Captures were not linked to active focus") && captureUsageReviews === 0) ||
        hasReview("Resolve, convert, or accept open captures")
          ? "review"
          : "pass",
      evidence: gapsAndCapturesEvidence,
    },
    {
      requirement: "Window and menubar friction evidenced",
      status:
        !telemetryAvailable ||
        apiErrors > 0 ||
        copyFailures > 0 ||
        startStopFailures !== "0/0" ||
        (hasReview("Test window entrypoints") && windowEntrypointReviews === 0)
          ? "review"
          : "pass",
      evidence: windowEvidenceText,
    },
    {
      requirement: "Start and continue paths evidenced",
      status:
        !telemetryAvailable ||
        !entryTelemetry ||
        (!entryPathsCovered && entryPathReviews === 0)
          ? "review"
          : "pass",
      evidence: entryPathEvidenceText,
    },
    {
      requirement: "Tracking correction or review evidenced",
      status:
        hasReview("Confirm tracking accuracy or test correction") ||
        hasReview("Review failed focus corrections")
          ? "review"
          : "pass",
      evidence: correctionEvidenceText,
    },
    {
      requirement: "Day closure duration measured",
      status:
        closureCounts?.right && lastClosureDuration != null && lastClosureDuration <= 10 * 60
          ? "pass"
          : "review",
      evidence: closureEvidenceText,
    },
    {
      requirement: "Hard blockers absent",
      status: activeFocus || activeWorkItems.length > 0 ? "block" : "pass",
      evidence: formatCount(reviewItems.filter((item) => item.level === "blocker").length, "красный пункт", "красных пункта", "красных пунктов"),
    },
  ];

  return [
    "## Проверка закрытия дня",
    "",
    "| Проверка | Статус | Доказательство |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${escapeMarkdownTable(formatDailyControlRequirement(row.requirement))} | ${escapeMarkdownTable(formatDailyControlStatus(row.status))} | ${escapeMarkdownTable(row.evidence)} |`
    ),
  ].join("\n");
}

function formatDailyControlRequirement(requirement) {
  return DAILY_CONTROL_REQUIREMENT_LABELS[requirement] ?? requirement;
}

function formatDailyControlStatus(status) {
  return DAILY_CONTROL_STATUS_LABELS[status] ?? status;
}

function extractLineValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function parseLeadingNumber(value) {
  if (!value) return 0;
  const match = value.match(/^\d+/);
  return match ? Number(match[0]) : 0;
}

function parseCorrectionTelemetry(markdown) {
  const match = markdown.match(/Corrections requested\/applied\/reviewed\/failed:\s*(\d+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return undefined;

  return {
    requested: Number(match[1]),
    applied: Number(match[2]),
    reviewed: Number(match[3]),
    failures: Number(match[4]),
  };
}

function parseEntryTelemetry(markdown) {
  const entryMatch = markdown.match(/Typed\/selected entry requests:\s*(\d+)\/(\d+)/);
  const stopMatch = markdown.match(/Stop requests:\s*(\d+)/);
  if (!entryMatch || !stopMatch) return undefined;

  return {
    typedEntryRequests: Number(entryMatch[1]),
    selectedEntryRequests: Number(entryMatch[2]),
    stopRequests: Number(stopMatch[1]),
  };
}

function parseCountPair(value) {
  if (!value) return undefined;
  const match = value.match(/^(\d+)\/(\d+)/);
  if (!match) return undefined;
  return {
    left: Number(match[1]),
    right: Number(match[2]),
  };
}

function formatReviewEvidence(value, emptyText, one, few, many) {
  return value > 0 ? formatCount(value, one, few, many) : emptyText;
}

function formatWindowVisibilityEvidence(value) {
  const pair = parseCountPair(value);
  if (!pair) return "окно: нет телеметрии";
  return `окно показывалось ${pair.left} раз, скрывалось ${pair.right} раз`;
}

function formatWindowRequestEvidence(value) {
  const pair = parseCountPair(value);
  if (!pair) return "запросов показать или скрыть окно: нет данных";
  return `${formatCount(pair.left, "запрос на показ", "запроса на показ", "запросов на показ")}, ${formatCount(pair.right, "запрос на скрытие", "запроса на скрытие", "запросов на скрытие")}`;
}

function formatStartStopFailureEvidence(value) {
  const pair = parseCountPair(value);
  if (!pair) return "ошибок старта и остановки: нет данных";
  if (pair.left + pair.right === 0) return "ошибок старта и остановки нет";
  return `${formatCount(pair.left, "ошибка старта", "ошибки старта", "ошибок старта")}, ${formatCount(pair.right, "ошибка остановки", "ошибки остановки", "ошибок остановки")}`;
}

function formatCorrectionEvidence(telemetry) {
  if (!telemetry) return "коррекции трекинга: нет телеметрии";
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

function parseDurationSeconds(value) {
  if (!value || value === "n/a") return undefined;
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

function countActivityZoneRows(markdown) {
  const section = extractMarkdownSection(markdown, "## By Activity Zone");
  if (!section) return 0;

  return section
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .filter((line) => !line.includes("---"))
    .filter((line) => !line.includes("Duration") || !line.includes("Zone"))
    .length;
}

function hasGapExplanationEvent(markdown) {
  return /\bopen\s+gap\b|\bgap\b|разрыв|перерыв|буфер|recovery|восстановлен/i.test(extractMarkdownSection(markdown, "## Day Events"));
}

function hasOpenGapExplanationEvent(markdown) {
  return /\bopen\s+gap\b|открыт[а-яё]*\s+разрыв/i.test(extractMarkdownSection(markdown, "## Day Events"));
}

function extractMarkdownSection(markdown, title) {
  const start = markdown.indexOf(title);
  if (start < 0) return "";

  const rest = markdown.slice(start + title.length);
  const nextSection = rest.search(/\n## /);
  return nextSection >= 0 ? rest.slice(0, nextSection) : rest;
}

function formatReviewChecklistMarkdown(items) {
  const lines = ["## Проверка перед отчётом", "", `Ближайшее действие: ${formatDayReviewNextStep(items)}`, ""];
  const blockers = items.filter((item) => item.level === "blocker");
  const reviews = items.filter((item) => item.level === "review");
  const fixups = reviews.filter((item) => !isAcceptAsIsReviewItem(item));
  const accepts = reviews.filter((item) => isAcceptAsIsReviewItem(item));
  const ready = items.filter((item) => item.level === "ok");

  appendReviewChecklistGroup(lines, "Сначала закрыть", blockers);
  appendReviewChecklistGroup(lines, "Дописать или исправить", fixups);
  appendReviewChecklistGroup(lines, "Осознанно проверить", accepts);
  appendReviewChecklistGroup(lines, "Готово", ready);

  return `${lines.join("\n")}\n`;
}

function formatDayReviewNextStep(items) {
  const blockers = items.filter((item) => item.level === "blocker");
  if (blockers.length > 0) {
    return formatNextStep("закрыть красный пункт", blockers);
  }

  const reviews = items.filter((item) => item.level === "review");
  const fixups = reviews.filter((item) => !isAcceptAsIsReviewItem(item));
  if (fixups.length > 0) {
    return formatNextStep("дописать или исправить", fixups);
  }

  const accepts = reviews.filter((item) => isAcceptAsIsReviewItem(item));
  if (accepts.length > 1) {
    return `осознанно проверить ${accepts.length} ${pluralRu(accepts.length, "пункт", "пункта", "пунктов")} или нажать «Всё проверено», если данные уже честные.`;
  }

  if (accepts.length === 1) {
    return formatNextStep("осознанно проверить", accepts);
  }

  if (items.some((item) => item.level === "ok")) {
    return "нажать «Копировать отчёт».";
  }

  return "дождаться первых фокус-блоков за день.";
}

function formatNextStep(prefix, items) {
  const title = REVIEW_TITLE_LABELS[items[0].title] ?? items[0].title;
  const actionHint = formatNextStepHint(items[0], items.length);
  const rest = items.length > 1 ? ` Ещё ${items.length - 1}.` : "";
  return `${prefix}: ${title}.${actionHint}${rest}`;
}

function formatNextStepHint(item, itemCount) {
  const actionLabel = REVIEW_ACTION_LABELS_BY_TITLE[item.title];
  if (!actionLabel) return formatNextStepBlockerHint(item);
  if (itemCount > 1) return "";

  if (isAcceptAsIsReviewItem(item)) {
    return ` Нажми «${actionLabel}», если данные уже честные.`;
  }

  return ` Нажми «${actionLabel}».`;
}

function formatNextStepBlockerHint(item) {
  if (item.title === "Stop the active focus block") {
    return " Нажми «Стоп» у активного фокуса.";
  }

  if (item.title === "Clear active Work Item state") {
    return " Выбери активное дело и смени состояние с «Активно».";
  }

  return "";
}

function formatDayReviewDetail(detail) {
  if (!detail) return detail;

  const openCapturesMatch = detail.match(/^(\d+) открыто$/);
  if (openCapturesMatch) {
    const count = Number(openCapturesMatch[1]);
    return formatCount(count, "открытое отвлечение", "открытых отвлечения", "открытых отвлечений");
  }

  const unexplainedGapsMatch = detail.match(/^(\d+)\/(\d+) больших разрывов без события дня$/);
  if (unexplainedGapsMatch) {
    const missing = Number(unexplainedGapsMatch[1]);
    const total = Number(unexplainedGapsMatch[2]);
    const gapLabel = formatCount(missing, "большой разрыв", "больших разрыва", "больших разрывов");
    return missing === total ? `${gapLabel} без события дня` : `${missing} из ${total} больших разрывов без события дня`;
  }

  const activeWorkItemMatch = detail.match(/^(\d+) Work Item с активным статусом$/);
  if (activeWorkItemMatch) {
    const count = Number(activeWorkItemMatch[1]);
    return `${formatCount(count, "дело", "дела", "дел")} с активным статусом`;
  }

  const touchedWorkItemMatch = detail.match(/^(\d+) Work Item были в работе сегодня$/);
  if (touchedWorkItemMatch) {
    const count = Number(touchedWorkItemMatch[1]);
    return `${formatCount(count, "дело было", "дела были", "дел было")} в работе сегодня`;
  }

  const entryPathMatch = detail.match(/^(\d+) вводом, (\d+) из списка, (\d+) остановок$/);
  if (entryPathMatch) {
    const typed = Number(entryPathMatch[1]);
    const selected = Number(entryPathMatch[2]);
    const stops = Number(entryPathMatch[3]);
    return [
      formatCount(typed, "старт вводом", "старта вводом", "стартов вводом"),
      formatCount(selected, "старт из списка", "старта из списка", "стартов из списка"),
      formatCount(stops, "остановка", "остановки", "остановок"),
    ].join(", ");
  }

  const windowRequestMatch = detail.match(/^(\d+) запросов показа, (\d+) запросов скрытия$/);
  if (windowRequestMatch) {
    const show = Number(windowRequestMatch[1]);
    const hide = Number(windowRequestMatch[2]);
    return [
      formatCount(show, "запрос на показ", "запроса на показ", "запросов на показ"),
      formatCount(hide, "запрос на скрытие", "запроса на скрытие", "запросов на скрытие"),
    ].join(", ");
  }

  const correctionFailuresMatch = detail.match(/^(\d+) ошибок коррекции$/);
  if (correctionFailuresMatch) {
    const count = Number(correctionFailuresMatch[1]);
    return formatCount(count, "ошибка коррекции", "ошибки коррекции", "ошибок коррекции");
  }

  return detail;
}

function formatCount(value, one, few, many) {
  return `${value} ${pluralRu(value, one, few, many)}`;
}

function appendReviewChecklistGroup(lines, title, items) {
  if (items.length === 0) return;
  if (lines.length > 2 && lines[lines.length - 1] !== "") {
    lines.push("");
  }

  lines.push(`### ${title}`, "");

  for (const item of items) {
    const marker = item.level === "ok" ? "[x]" : "[ ]";
    const title = REVIEW_TITLE_LABELS[item.title] ?? item.title;
    const detail = formatDayReviewDetail(item.detail);
    const suffix = detail ? ` - ${formatMarkdownListText(detail)}` : "";
    lines.push(`- ${marker} ${formatMarkdownListText(title)}${suffix}`);
  }
}

function isAcceptAsIsReviewItem(item) {
  return item.level === "review" && ACCEPT_AS_IS_REVIEW_TITLES.has(item.title);
}

function countPendingReviewItems(items) {
  return items.filter((item) => item.level !== "ok").length;
}

function formatDogfoodReportState({ activeFocus, activeWorkItemCount, pendingReviewItemCount }) {
  if (activeFocus) return "черновик — фокус-блок ещё активен";
  if (activeWorkItemCount > 0) return "черновик — у дела ещё стоит активный статус";
  if (pendingReviewItemCount > 0) {
    return `черновик — осталось ${pendingReviewItemCount} ${pluralRu(pendingReviewItemCount, "проверка", "проверки", "проверок")} перед финальным отчётом`;
  }
  return "финальный — нет активных фокус-блоков, активных дел и незакрытых проверок";
}

function pluralRu(value, one, few, many) {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatCaptureActivityMarkdown(captures) {
  const lines = [
    "## История отвлечений",
    "",
    "| Время | Статус | Отвлечение | Во время | Итог |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const capture of captures) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(capture.created_at))} | ${escapeMarkdownTable(formatCaptureState(capture.state))} | ${escapeMarkdownTable(capture.text)} | ${escapeMarkdownTable(formatCaptureDuring(capture))} | ${escapeMarkdownTable(formatCaptureOutcome(capture))} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatCaptureDuring(capture) {
  if (!capture.focus_session_id) {
    return "без активного фокуса";
  }

  return capture.focus_work_item_title ?? capture.focus_title ?? "связанный фокус-блок";
}

function formatCaptureOutcome(capture) {
  if (capture.state === "resolved") {
    return `закрыто ${formatClockTime(capture.resolved_at ?? capture.updated_at)}`;
  }

  if (capture.state === "converted") {
    const itemTitle = capture.work_item_title ? ` -> ${capture.work_item_title}` : "";
    return `создано ${formatClockTime(capture.converted_at ?? capture.updated_at)}${itemTitle}`;
  }

  return "открыто";
}

function formatCaptureState(state) {
  const labels = {
    open: "открыто",
    resolved: "закрыто",
    converted: "превращено",
  };
  return labels[state] ?? state;
}

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

function formatMarkdownListText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
