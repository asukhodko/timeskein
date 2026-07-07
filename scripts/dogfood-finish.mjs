#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const date = options.date ? parseLocalDate(options.date) : new Date();
const dateArg = options.date ?? formatLocalDate(date);
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");

const blockers = [];

if (!existsSync(dbPath)) {
  blockers.push(`База Timeskein не найдена: ${dbPath}`);
} else {
  const summary = await loadSummary(dbPath, date);
  if (summary.activeSessions.length > 0) {
    for (const session of summary.activeSessions) {
      blockers.push(
        `Активный фокус-блок ещё идёт: ${session.work_item_title ?? session.title}, с ${formatClockTime(session.started_at)}`
      );
    }
  }

  if (summary.activeWorkItems.length > 0) {
    for (const item of summary.activeWorkItems) {
      blockers.push(`У дела всё ещё активный статус: ${item.title}`);
    }
  }

  if (summary.daySessionCount === 0) {
    blockers.push(`За ${dateArg} нет фокус-блоков. Закрывать dogfood-день пока нечего.`);
  }
}

if (blockers.length > 0) {
  process.stdout.write(buildNotReadyReport(dateArg, dbPath, blockers));
  process.exit(1);
}

const reportArgs = [resolve(repoRoot, "scripts/dogfood-report.mjs"), "--date", dateArg, "--db", dbPath];
const { stdout } = await execFileAsync(process.execPath, reportArgs, {
  cwd: repoRoot,
  maxBuffer: 10 * 1024 * 1024,
});

const outputPath = outputReportPath(options, dateArg);
if (outputPath) {
  await writeFile(outputPath, stdout);
  process.stdout.write(`Сохранён dogfood-отчёт Timeskein: ${outputPath}\n`);
  if (options.save) {
    await saveRcCheck(dateArg, dbPath);
  }
  const reportState = findReportState(stdout);
  const reviewNextAction = findReviewNextAction(stdout);
  const closureStatus = findAuditRowStatus(stdout, ["Длительность закрытия измерена", "Day closure duration measured"]);
  const pendingAuditRows = findPendingAuditRows(stdout);
  if (closureStatus && !isPassingAuditStatus(closureStatus)) {
    process.stdout.write(buildMeasuredClosureWarning(dateArg, reportState, reviewNextAction));
  } else if (pendingAuditRows.length > 0 || (reportState && !isFinalReportState(reportState))) {
    process.stdout.write(buildPendingReviewWarning(dateArg, pendingAuditRows, reportState, reviewNextAction));
  } else if (options.save && process.exitCode == null) {
    process.stdout.write(buildGoalCheckNextStep(dateArg));
  }
} else {
  process.stdout.write(stdout);
}

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
    } else if (arg === "--out") {
      result.out = args[++index];
    } else if (arg === "--save") {
      result.save = true;
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
  console.log(`Использование: pnpm dogfood:finish [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--save | --out path.md]

Закрывает dogfood-день: проверяет, что нет активного фокус-блока, нет дела с активным статусом, и за день есть хотя бы один фокус-блок.
При успехе печатает Markdown-отчёт или сохраняет его в файл, если передан --save или --out.
С --save рядом с дневным отчётом также сохраняется dogfood RC check.
При блокировке печатает Markdown-диагностику с понятным следующим шагом и завершается с кодом 1.`);
}

function outputReportPath(options, date) {
  if (options.out) {
    return resolve(options.out);
  }

  if (options.save) {
    return resolve(`timeskein-dogfood-report-${date}.md`);
  }

  return undefined;
}

async function saveRcCheck(date, path) {
  const rcArgs = [
    resolve(repoRoot, "scripts/dogfood-rc-check.mjs"),
    "--date",
    date,
    "--db",
    path,
    "--save",
  ];

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, rcArgs, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    if (stderr) {
      process.stderr.write(stderr);
    }
  } catch (error) {
    if (error.stdout) {
      process.stdout.write(error.stdout);
    }
    if (error.stderr) {
      process.stderr.write(error.stderr);
    }
    process.exitCode = error.code ?? 1;
  }
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

async function loadSummary(path, day) {
  const from = startOfLocalDay(day);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  const now = new Date();

  const [activeSessions, activeWorkItems, dayCounts] = await Promise.all([
    queryJson(path, `
      SELECT
        fs.id,
        fs.title,
        wi.title AS work_item_title,
        fs.started_at
      FROM focus_sessions fs
      LEFT JOIN work_items wi ON wi.id = fs.work_item_id
      WHERE fs.state = 'active'
      ORDER BY datetime(fs.started_at) DESC
    `),
    queryJson(path, `
      SELECT id, title, updated_at
      FROM work_items
      WHERE deleted_at IS NULL AND state = 'active'
      ORDER BY datetime(updated_at) DESC
    `),
    queryJson(path, `
      SELECT COUNT(*) AS count
      FROM focus_sessions
      WHERE datetime(COALESCE(stopped_at, ${sqlString(now.toISOString())})) > datetime(${sqlString(from.toISOString())})
        AND datetime(started_at) < datetime(${sqlString(to.toISOString())})
    `),
  ]);

  return {
    activeSessions,
    activeWorkItems,
    daySessionCount: dayCounts[0]?.count ?? 0,
  };
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

function buildNotReadyReport(date, path, items) {
  const lines = [
    `# Закрытие dogfood-дня заблокировано - ${date}`,
    "",
    `База: ${path}`,
    "",
    "## Что мешает",
    "",
  ];

  for (const item of items) {
    lines.push(`- ${item}`);
  }

  lines.push(
    "",
    "## Что сделать дальше",
    "",
    "- Если идёт активный фокус-блок, останови его в Timeskein.",
    "- Если застрял только активный статус дела, сначала выполни `pnpm dogfood:stop-active` и примени план, если он выглядит правильно.",
    "- Если закрываешь другой день, повтори команду с `--date YYYY-MM-DD`.",
    "- Если выбрана не та база, повтори команду с `--db path/to/timeskein.db`."
  );

  return `${lines.join("\n")}\n`;
}

function buildMeasuredClosureWarning(date, reportState, reviewNextAction) {
  return [
    "",
    "## Что ещё осталось",
    "",
    "- Отчёт сохранён, но это ещё не финальное закрытие дня: длительность закрытия не измерена или больше 10 минут.",
    ...formatReportStateWarning(reportState),
    ...formatReviewNextActionWarning(reviewNextAction),
    "- В Timeskein нажми `Начать закрытие дня`, спокойно пройди `Проверка перед отчётом` и дойди до финального `Копировать отчёт` за 10 минут или меньше.",
    `- Затем повтори: \`pnpm dogfood:finish:save -- --date ${date}\`.`,
    "",
  ].join("\n");
}

function buildPendingReviewWarning(date, rows, reportState, reviewNextAction) {
  const visibleRows = rows.slice(0, 5).map((row) => `- ${row.requirement}: ${row.status}`);
  if (rows.length > visibleRows.length) {
    visibleRows.push(`- Ещё строк: ${rows.length - visibleRows.length}`);
  } else if (visibleRows.length === 0) {
    visibleRows.push("- В отчёте всё ещё стоит черновой статус; проверь оставшиеся пункты в панели.");
  }

  return [
    "",
    "## Что ещё осталось",
    "",
    "- Отчёт сохранён как рабочий артефакт, но ещё не готов для финального закрытия дня.",
    ...formatReportStateWarning(reportState),
    ...formatReviewNextActionWarning(reviewNextAction),
    ...visibleRows,
    "- Вернись к `Проверка перед отчётом`: исправь пункты в «Дописать или исправить» и осознанно прими спорные проверки.",
    `- Затем повтори: \`pnpm dogfood:finish:save -- --date ${date}\`.`,
    "",
  ].join("\n");
}

function formatReportStateWarning(reportState) {
  if (!reportState || isFinalReportState(reportState)) {
    return [];
  }

  return [`- Статус сохранённого отчёта: \`${reportState}\`.`];
}

function formatReviewNextActionWarning(reviewNextAction) {
  if (!reviewNextAction) {
    return [];
  }

  return [`- Ближайшее действие из отчёта: ${reviewNextAction}`];
}

function buildGoalCheckNextStep(date) {
  return [
    "",
    "## Следующий шаг",
    "",
    "- Отчёт финальный, закрытие измерено, аудит чистый.",
    `- Запусти финальную проверку цели: \`pnpm dogfood:goal-check -- --date ${date}\`.`,
    "",
  ].join("\n");
}

function findAuditRowStatus(text, aliases) {
  for (const line of text.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length >= 2 && aliases.some((needle) => cells[0] === needle)) {
      return cells[1];
    }
  }

  return undefined;
}

function findPendingAuditRows(text) {
  const section = extractSection(text, ["## Аудит закрытия дня", "## Daily Control Goal Audit"]);
  if (!section) {
    return [];
  }

  const rows = [];
  for (const line of section.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3 || cells[0] === "Проверка" || cells[0] === "Requirement" || /^-+$/.test(cells[0])) {
      continue;
    }

    const [requirement, status] = cells;
    if (requirement && status && !isPassingAuditStatus(status)) {
      rows.push({ requirement, status });
    }
  }

  return rows;
}

function extractSection(text, headings) {
  for (const heading of headings) {
    const start = text.indexOf(heading);
    if (start === -1) {
      continue;
    }

    const next = text.indexOf("\n## ", start + heading.length);
    return next === -1 ? text.slice(start) : text.slice(start, next);
  }

  return undefined;
}

function findReportState(text) {
  for (const line of text.split("\n")) {
    const match = line.match(/^Статус отчёта:\s*(.+)$/);
    if (match) return match[1].trim();
  }

  return undefined;
}

function findReviewNextAction(text) {
  const section = extractSection(text, ["## Проверка перед отчётом", "## Review before report"]);
  if (!section) {
    return undefined;
  }

  for (const line of section.split("\n")) {
    const match = line.match(/^Ближайшее действие:\s*(.+)$/);
    if (match) return match[1].trim();
  }

  return undefined;
}

function isPassingAuditStatus(status) {
  return status === "pass" || status === "ок";
}

function isFinalReportState(state) {
  return state.toLowerCase().startsWith("финальный");
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
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
