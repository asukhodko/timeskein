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
const exportArgs = [resolve(repoRoot, "scripts/export-focus-day.mjs"), "--db", dbPath];
const metricsArgs = [resolve(repoRoot, "scripts/dogfood-metrics.mjs"), "--db", dbPath];
const REVIEW_TITLE_LABELS = {
  "Stop the active focus block": "Остановить активный фокус-блок",
  "Clear active Work Item state": "Снять активный статус с Work Item",
  "Resolve, convert, or accept open captures": "Разобрать открытые отвлечения",
  "Classify significant gaps": "Объяснить большие разрывы",
  "Explain current open gap": "Объяснить текущий открытый разрыв",
  "Review Activity Zone coverage": "Проверить зоны активности",
  "Confirm non-work tracked time": "Проверить нерабочее время",
  "Confirm Work Item today/total badges": "Проверить today/total у Work Item",
  "Capture Inbox untested today": "Инбокс отвлечений сегодня не проверен",
  "Captures were not linked to active focus": "Отвлечения не были связаны с активным фокусом",
  "No day or Work Item notes/events": "Нет дневных или Work Item событий",
  "Exercise start and continue paths": "Проверить старт и продолжение",
  "Test window entrypoints": "Проверить входы в окно",
  "Review failed focus corrections": "Проверить ошибки коррекции фокуса",
  "Confirm tracking accuracy or test correction": "Подтвердить точность трекинга",
  "Ready to copy final report": "Можно копировать финальный отчёт",
};
const DAILY_CONTROL_REQUIREMENT_LABELS = {
  "Final state clean": "Финальное состояние чистое",
  "Focus blocks visible": "Фокус-блоки видны",
  "Work Item totals available": "Итоги по Work Item есть",
  "Activity Zones separated": "Зоны активности разделены",
  "Day and Work Item context present": "Контекст дня и Work Item сохранён",
  "Gaps and captures visible": "Разрывы и отвлечения видны",
  "Window and menubar friction evidenced": "Окно и строка меню проверены",
  "Start and continue paths evidenced": "Старт и продолжение проверены",
  "Tracking correction or review evidenced": "Коррекция трекинга проверена",
  "Day closure duration measured": "Длительность закрытия измерена",
  "Hard blockers absent": "Жёстких блокеров нет",
};
const DAILY_CONTROL_STATUS_LABELS = {
  block: "блокер",
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
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (result.date && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${result.date}`);
  }

  return result;
}

function printHelp() {
  console.log(`Usage: pnpm dogfood:report [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Prints a Markdown dogfood report from the local Timeskein SQLite database.
The report includes the focus-day export plus review prompts for evening analysis.
If a focus block or Work Item is still active, the report is marked as a draft.`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
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
  const reportState = activeFocus
    ? "черновик — фокус-блок ещё активен"
    : hasActiveWorkItems
      ? "черновик — у Work Item ещё стоит активный статус"
      : "финальный — нет активных фокус-блоков и активных Work Item";

  const lines = [
    `# Dogfood-отчёт Timeskein - ${date}`,
    "",
    `Статус отчёта: ${reportState}`,
    "",
  ];

  if (activeFocus) {
    lines.push(
      "## Блокер финального отчёта",
      "",
      `- Активный Work Item: ${activeFocus.title}`,
      `- Старт: ${formatClockTime(activeFocus.started_at)}`,
      `- Текущая длительность: ${formatDuration(activeFocus.active_seconds)}`,
      "- Останови активный блок перед финальным отчётом.",
      ""
    );
  }

  if (!activeFocus && hasActiveWorkItems) {
    lines.push(
      "## Блокер финального отчёта",
      "",
      ...activeWorkItems.map((item) => `- Work Item с активным статусом: ${item.title}`),
      "- Сними активный статус с Work Item перед финальным отчётом.",
      ""
    );
  }

  if (openCaptures.length > 0) {
    lines.push(
      "## Открытые отвлечения",
      "",
      ...openCaptures.map((capture) => `- ${formatClockTime(capture.created_at)} ${formatMarkdownListText(capture.text)}`),
      "- Разбери их: закрыть, превратить в Work Item, добавить событием или явно оставить открытыми.",
      ""
    );
  }

  if (captureActivity.length > 0) {
    lines.push(formatCaptureActivityMarkdown(captureActivity).trim(), "");
  }

  const reviewItems = buildReviewChecklistItems({
    activeFocus,
    activeWorkItems,
    openCaptures,
    captureActivity,
    focusMarkdown,
    telemetryMarkdown,
  });

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
    "## Вечерний разбор",
    "",
    "### Доверие к данным",
    "",
    "- Что поправлено вручную:",
    "- Что осталось спорным:",
    "- Где Work Item слишком широкий или неверный:",
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
    .replace(/^\| Time \| Duration \| Zone \| Work Item \| Note \|$/gm, "| Время | Длительность | Зона | Work Item | Заметка |")
    .replace(/^## Day-Boundary Blocks$/gm, "## Блоки на границе дня")
    .replace(/: counted as ([^\n]+) inside this day/g, ": учтено как $1 внутри этого дня")
    .replace(/^## By Work Item$/gm, "## По Work Item")
    .replace(/^\| Duration \| Entrances \| Work Item \|$/gm, "| Длительность | Входов | Work Item |")
    .replace(/^## By Activity Zone$/gm, "## По зонам активности")
    .replace(/^\| Duration \| Entrances \| Zone \|$/gm, "| Длительность | Входов | Зона |")
    .replace(/^## Work Item Notes$/gm, "## Заметки Work Item")
    .replace(/^## Day Events$/gm, "## События дня")
    .replace(/^\| Time \| Zone \| During \| Event \|$/gm, "| Время | Зона | Во время | Событие |")
    .replace(/^## Work Item Events$/gm, "## События Work Item")
    .replace(/^\| Time \| Work Item \| During \| Event \|$/gm, "| Время | Work Item | Во время | Событие |")
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

function formatTelemetryForReport(markdown) {
  return markdown
    .replace(/^## App Telemetry$/m, "## Телеметрия приложения")
    .replace(/^Total events:/gm, "Всего событий:")
    .replace(/^Start requests:/gm, "Запросов старта:")
    .replace(/^Switch requests:/gm, "Запросов переключения:")
    .replace(/^Stop requests:/gm, "Запросов остановки:")
    .replace(/^Typed\/selected entry requests:/gm, "Входы typed/selected:")
    .replace(/^Start\/stop failures:/gm, "Ошибки старта/остановки:")
    .replace(/^Window shown\/hidden:/gm, "Окно показано/скрыто:")
    .replace(/^Window show\/hide requests:/gm, "Запросы показать/скрыть окно:")
    .replace(/^Window drag starts:/gm, "Стартов перетаскивания окна:")
    .replace(/^Copy failures:/gm, "Ошибок копирования:")
    .replace(/^Manual copy fallbacks:/gm, "Ручных fallback-копирований:")
    .replace(/^Capture created\/resolved\/converted:/gm, "Отвлечений создано/закрыто/превращено:")
    .replace(/^Capture follow-up reviews:/gm, "Проверок открытых отвлечений:")
    .replace(/^Work Item time badge reviews:/gm, "Проверок бейджей времени Work Item:")
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
    .replace(/^Already-active start attempts:/gm, "Попыток старта уже активного Work Item:")
    .replace(/^Stale runtime recoveries:/gm, "Восстановлений устаревшего runtime:")
    .replace(/^Average start latency:/gm, "Средняя задержка старта:")
    .replace(/^Slow window-to-focus gaps:/gm, "Медленных разрывов окно->фокус:")
    .replace(/^### Events By Kind$/m, "### События по типам")
    .replace(/^\| Count \| Kind \|$/gm, "| Кол-во | Тип |");
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
      detail: "Проверь, что карточки показывают today и total",
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
  const correctionEvidence =
    extractLineValue(telemetryMarkdown, "Corrections requested/applied/reviewed/failed") ?? "n/a";
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

  const rows = [
    {
      requirement: "Final state clean",
      status: activeFocus || activeWorkItems.length > 0 ? "block" : "pass",
      evidence: `${activeFocus ? 1 : 0} активных фокус-блоков, ${activeWorkItems.length} Work Item с активным статусом`,
    },
    {
      requirement: "Focus blocks visible",
      status: hasFocusBlocks ? "pass" : "block",
      evidence: `${entrances} входов, ${totalTracked} учтено`,
    },
    {
      requirement: "Work Item totals available",
      status: focusMarkdown.includes("## By Work Item") && !hasReview("Confirm Work Item today/total badges") ? "pass" : "review",
      evidence: focusMarkdown.includes("## By Work Item")
        ? `Раздел «По Work Item» есть, проверок бейджей в UI: ${workItemTimeBadgeReviews}`
        : "Раздела «По Work Item» нет",
    },
    {
      requirement: "Activity Zones separated",
      status:
        hasFocusBlocks && ((!hasReview("Review Activity Zone coverage") && !hasReview("Confirm non-work tracked time")) || activityZoneReviews > 0)
          ? "pass"
          : "review",
      evidence: `${workFocus} рабочий фокус, ${nonWorkTracked} вне работы, проверок зон: ${activityZoneReviews}`,
    },
    {
      requirement: "Day and Work Item context present",
      status: hasReview("No day or Work Item notes/events") ? "review" : "pass",
      evidence: [
        focusMarkdown.includes("## Day Events") ? "события дня" : "",
        focusMarkdown.includes("## Work Item Events") ? "события Work Item" : "",
        focusMarkdown.includes("## Work Item Notes") ? "заметки Work Item" : "",
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
      evidence: `${focusMarkdown.includes("## Gaps >=") ? "раздел разрывов есть" : "больших разрывов нет"}, открытых отвлечений: ${openCaptures.length}, проверок открытых отвлечений: ${captureFollowupReviews}, проверок инбокса: ${captureUsageReviews}, отвлечений за день: ${captureActivity.length}`,
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
      evidence: `окно показано/скрыто: ${windowEvidence}, запросы показать/скрыть: ${windowRequestEvidence}, проверок окна: ${windowEntrypointReviews}, ошибок API: ${apiErrors}, ошибок старт/стоп: ${startStopFailures}`,
    },
    {
      requirement: "Start and continue paths evidenced",
      status:
        !telemetryAvailable ||
        !entryTelemetry ||
        (!entryPathsCovered && entryPathReviews === 0)
          ? "review"
          : "pass",
      evidence: `входов вводом/из списка: ${entryPathEvidence}, запросов остановки: ${entryTelemetry?.stopRequests ?? "нет данных"}, проверок входа: ${entryPathReviews}`,
    },
    {
      requirement: "Tracking correction or review evidenced",
      status:
        hasReview("Confirm tracking accuracy or test correction") ||
        hasReview("Review failed focus corrections")
          ? "review"
          : "pass",
      evidence: correctionEvidence,
    },
    {
      requirement: "Day closure duration measured",
      status:
        closureCounts?.right && lastClosureDuration != null && lastClosureDuration <= 10 * 60
          ? "pass"
          : "review",
      evidence: `${closureCounts ? `${closureCounts.left}/${closureCounts.right}` : "нет данных"} начато/завершено, последняя длительность: ${lastClosureDuration == null ? "нет данных" : formatDuration(lastClosureDuration)}`,
    },
    {
      requirement: "Hard blockers absent",
      status: activeFocus || activeWorkItems.length > 0 ? "block" : "pass",
      evidence: reviewItems.filter((item) => item.level === "blocker").length + " блокеров",
    },
  ];

  return [
    "## Аудит закрытия дня",
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
  const lines = ["## Проверка перед отчётом", ""];
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

function appendReviewChecklistGroup(lines, title, items) {
  if (items.length === 0) return;
  if (lines.length > 2 && lines[lines.length - 1] !== "") {
    lines.push("");
  }

  lines.push(`### ${title}`, "");

  for (const item of items) {
    const marker = item.level === "ok" ? "[x]" : "[ ]";
    const title = REVIEW_TITLE_LABELS[item.title] ?? item.title;
    const suffix = item.detail ? ` - ${formatMarkdownListText(item.detail)}` : "";
    lines.push(`- ${marker} ${formatMarkdownListText(title)}${suffix}`);
  }
}

function isAcceptAsIsReviewItem(item) {
  return item.level === "review" && ACCEPT_AS_IS_REVIEW_TITLES.has(item.title);
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
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
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
