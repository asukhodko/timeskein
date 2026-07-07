#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const repoRoot = resolve(import.meta.dirname, "..");
const date = options.date ?? formatLocalDate(new Date());
const rcArgs = [resolve(repoRoot, "scripts/dogfood-rc-check.mjs"), "--strict"];
const shouldCheckSavedEvidence = !options.db && !options.skipSavedEvidenceCheck;
const shouldRequireNoCodexGuidance = !options.db && !options.checkSavedEvidenceOnly;

if (options.db) {
  rcArgs.push("--db", options.db);
}

rcArgs.push("--date", date);

if (options.minFocusMinutes !== undefined) {
  rcArgs.push("--min-focus-minutes", String(options.minFocusMinutes));
}

if (options.save) {
  rcArgs.push("--save");
}

if (options.out) {
  rcArgs.push("--out", options.out);
}

const savedEvidenceSteps = [
  ...(shouldCheckSavedEvidence
    ? [[process.execPath, [resolve(repoRoot, "scripts/dogfood-goal-check.mjs"), "--check-saved-evidence-only", "--date", date]]]
    : []),
];
const verificationSteps = [
  ["pnpm", ["test"]],
  ["pnpm", ["dogfood:preflight"]],
  [process.execPath, rcArgs],
];
const dryRunSteps = [
  ...savedEvidenceSteps,
  ...(shouldRequireNoCodexGuidance ? [["self", ["--no-codex-guidance"]]] : []),
  ...verificationSteps,
];

if (options.checkSavedEvidenceOnly) {
  try {
    await checkSavedEvidence(date);
    console.log(`Сохранённые материалы дня Timeskein за ${date} найдены.`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

if (options.status) {
  try {
    await checkSavedEvidence(date);
    console.log(buildStatusReadyMessage(date));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("# Финальная проверка пока не готова")) {
      console.log(buildStatusNotReadyMessage(date, message));
      process.exit(0);
    }

    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

if (options.dryRun) {
  console.log("# Финальная проверка цели Timeskein — dry run");
  console.log("");
  console.log("Будут выполнены команды:");
  console.log("");
  for (const [command, args] of dryRunSteps) {
    console.log(`- ${formatCommand(command, args)}`);
  }
  process.exit(0);
}

for (const [command, args] of savedEvidenceSteps) {
  await runOrExit(command, args);
}

if (shouldRequireNoCodexGuidance && !options.noCodexGuidance) {
  process.stderr.write(`${buildMissingNoCodexGuidanceMessage(date)}\n`);
  process.exit(1);
}

if (shouldRequireNoCodexGuidance) {
  console.log("\nПодтверждение: закрытие прошло без подсказок Codex.");
}

for (const [command, args] of verificationSteps) {
  await runOrExit(command, args);
}

console.log("\nФинальная проверка цели Timeskein прошла.");

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
    } else if (arg === "--min-focus-minutes") {
      result.minFocusMinutes = Number(args[++index]);
      if (!Number.isFinite(result.minFocusMinutes) || result.minFocusMinutes < 0) {
        throw new Error("--min-focus-minutes must be a non-negative number");
      }
    } else if (arg === "--save") {
      result.save = true;
    } else if (arg === "--out") {
      result.out = args[++index];
    } else if (arg === "--skip-saved-evidence-check") {
      result.skipSavedEvidenceCheck = true;
    } else if (arg === "--check-saved-evidence-only") {
      result.checkSavedEvidenceOnly = true;
    } else if (arg === "--no-codex-guidance") {
      result.noCodexGuidance = true;
    } else if (arg === "--status") {
      result.status = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
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

  if (result.save && result.out) {
    throw new Error("Use either --save or --out, not both");
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:goal-check [--date YYYY-MM-DD] [--no-codex-guidance] [--db path/to/timeskein.db] [--min-focus-minutes N] [--save | --out path.md] [--skip-saved-evidence-check] [--status] [--dry-run]

Запускает финальную локальную проверку цели про дешёвое вечернее закрытие дня:

1. сохранённый отчёт закрытия дня и проверка закрытия дня есть за выбранную дату
2. есть явное подтверждение \`--no-codex-guidance\`, что закрытие прошло без подсказок Codex
3. pnpm test
4. pnpm dogfood:preflight
5. dogfood:rc-check --strict для выбранного дня Timeskein

Используй это после реального дня Timeskein, перед закрытием цели.

Для спокойного просмотра состояния без дорогих проверок и без падения на ожидаемой неготовности:

  pnpm dogfood:goal-check:status -- --date YYYY-MM-DD`);
}

function buildStatusReadyMessage(date) {
  return [
    "# Статус финальной проверки цели Timeskein",
    "",
    `Сохранённые материалы дня Timeskein за ${date} найдены.`,
    "",
    "## Что дальше",
    "",
    `- Если вечернее закрытие прошло без подсказок Codex, запусти строгую проверку: \`pnpm dogfood:goal-check -- --date ${date} --no-codex-guidance\`.`,
    "- Если Codex понадобился как навигатор закрытия, этот день ещё не закрывает цель.",
  ].join("\n");
}

function buildStatusNotReadyMessage(date, message) {
  return [
    message,
    "",
    "## Мягкая проверка",
    "",
    "- Эта команда только показывает состояние.",
    "- Она не закрывает цель и не запускает локальные проверки.",
    `- Когда материалы будут готовы, строгая проверка останется такой: \`pnpm dogfood:goal-check -- --date ${date} --no-codex-guidance\`.`,
  ].join("\n");
}

async function checkSavedEvidence(date) {
  const reportPath = `timeskein-dogfood-report-${date}.md`;
  const rcPath = `timeskein-dogfood-rc-check-${date}.md`;
  const missing = [];

  const report = await readEvidenceFile(reportPath, missing);
  const rcCheck = await readEvidenceFile(rcPath, missing);

  if (missing.length > 0) {
    throw new Error(buildMissingEvidenceMessage(date, missing));
  }

  const weak = [];
  const notPassing = [];
  const reportRequirements = [
    ["# Отчёт закрытия дня Timeskein", "# Dogfood-отчёт Timeskein", "# Timeskein dogfood report"],
    ["## Данные фокуса", "## Focus Data"],
    ["## Короткое закрытие"],
    ["Закрытие уложилось в 10 минут"],
    ["## Проверка перед отчётом", "## Review before report"],
    ["## Аудит закрытия дня", "## Daily Control Goal Audit"],
    ["## Телеметрия приложения", "## App Telemetry"],
  ];
  const rcRequirements = [
    ["# Проверка закрытия дня Timeskein", "# RC-аудит закрытия дня Timeskein", "# RC-аудит dogfood-дня Timeskein", "# Timeskein dogfood RC check"],
    ["## Сводка доказательств", "## Evidence Summary"],
    ["## Аудит закрытия дня", "## Daily Control Goal Audit"],
  ];
  const reportDailyControlRows = [
    ["Финальное состояние чистое", "Final state clean"],
    ["Фокус-блоки видны", "Focus blocks visible"],
    ["Итоги по делам есть", "Итоги по Work Item есть", "Work Item totals available"],
    ["Зоны активности разделены", "Activity Zones separated"],
    ["Контекст дня и дел сохранён", "Контекст дня и Work Item сохранён", "Day and Work Item context present"],
    ["Разрывы и отвлечения видны", "Gaps and captures visible"],
    ["Окно и строка меню проверены", "Окно и menu bar проверены", "Window and menubar friction evidenced"],
    ["Старт и продолжение проверены", "Start and continue paths evidenced"],
    ["Коррекция трекинга проверена", "Tracking correction or review evidenced"],
    ["Длительность закрытия измерена", "Day closure duration measured"],
    ["Жёстких блокеров нет", "Hard blockers absent"],
  ];
  const rcDailyControlRows = [
    ["Финальное состояние чистое", "Final state clean"],
    ["Фокус-блоки видны", "Focus blocks visible"],
    ["Итоги по делам есть", "Итоги по Work Item есть", "Work Item totals available"],
    ["Зоны активности разделены", "Activity Zones separated"],
    ["Контекст дня и дел сохранён", "Контекст дня и Work Item сохранён", "Day and Work Item context present"],
    ["Разрывы и отвлечения видны", "Gaps and captures visible"],
    ["Окно и строка меню проверены", "Окно и menu bar проверены", "Window and menubar friction evidenced"],
    ["Старт и продолжение проверены", "Start and continue paths evidenced"],
    ["Коррекция трекинга проверена", "Tracking correction or review evidenced"],
    ["Длительность закрытия измерена", "Day closure duration measured"],
    ["Жёстких блокеров нет", "Hard blockers absent"],
  ];
  const rcOnlyDailyControlRows = [["Локальные проверки", "Local gates"]];

  for (const aliases of reportRequirements) {
    if (!includesAny(report, aliases)) {
      weak.push(`В ${reportPath} нет раздела «${aliases[0]}»`);
    }
  }
  const reportState = findReportState(report);
  if (!reportState) {
    weak.push(`В ${reportPath} нет строки «Статус отчёта»`);
  } else if (!isFinalReportState(reportState)) {
    notPassing.push(`В ${reportPath} статус отчёта ещё не финальный: ${reportState}`);
  }
  if (!hasGroupedReviewChecklist(report)) {
    weak.push(
      `В ${reportPath} раздел «Проверка перед отчётом» должен быть сохранён с группами «Сначала закрыть», «Дописать или исправить», «Осознанно проверить» или «Готово»`
    );
  }
  if (!hasReviewNextAction(report)) {
    weak.push(`В ${reportPath} раздел «Проверка перед отчётом» должен содержать строку «Ближайшее действие»`);
  }
  const reviewNextAction = findReviewNextAction(report);
  const shortClosureVerdict = findShortClosureVerdict(report);
  if (!shortClosureVerdict) {
    weak.push(`В ${reportPath} раздел «Короткое закрытие» должен содержать строку «Закрытие уложилось в 10 минут»`);
  } else if (!isPassingShortClosureVerdict(shortClosureVerdict)) {
    notPassing.push(`В ${reportPath} короткое закрытие ещё не подтверждает критерий 10 минут: ${shortClosureVerdict}`);
  }
  for (const aliases of rcRequirements) {
    if (!includesAny(rcCheck, aliases)) {
      weak.push(`В ${rcPath} нет раздела «${aliases[0]}»`);
    }
  }
  for (const aliases of reportDailyControlRows) {
    if (!includesAny(report, aliases)) {
      weak.push(`В ${reportPath} нет строки аудита «${aliases[0]}»`);
    } else if (!isPassingAuditStatus(findAuditRowStatus(report, aliases))) {
      notPassing.push(`В ${reportPath} строка аудита «${aliases[0]}» ещё не подтверждена`);
    }
  }
  for (const aliases of rcDailyControlRows) {
    if (!includesAny(rcCheck, aliases)) {
      weak.push(`В ${rcPath} нет строки аудита «${aliases[0]}»`);
    } else if (!isPassingAuditStatus(findAuditRowStatus(rcCheck, aliases))) {
      notPassing.push(`В ${rcPath} строка аудита «${aliases[0]}» ещё не подтверждена`);
    }
  }
  for (const aliases of rcOnlyDailyControlRows) {
    if (!includesAny(rcCheck, aliases)) {
      weak.push(`В ${rcPath} нет строки аудита «${aliases[0]}»`);
    }
    if (includesAny(report, aliases)) {
      weak.push(`В ${reportPath} строка «${aliases[0]}» должна оставаться на уровне RC/goal-check, а не в дневном отчёте`);
    }
  }

  if (weak.length > 0 || notPassing.length > 0) {
    throw new Error(buildIncompleteEvidenceMessage(date, weak, notPassing, reviewNextAction));
  }
}

function buildMissingEvidenceMessage(date, missing) {
  return [
    "# Финальная проверка пока не готова",
    "",
    "## До финальной проверки",
    "",
    "- Сохранённые материалы дня Timeskein ещё не найдены.",
    `- Сохрани вечерний отчёт и проверку закрытия дня: \`pnpm dogfood:finish:save -- --date ${date}\`.`,
    "",
    "## Детали",
    "",
    ...missing.map((item) => `- ${item}`),
  ].join("\n");
}

function buildMissingNoCodexGuidanceMessage(date) {
  return [
    "# Финальная проверка пока не готова",
    "",
    "## До финальной проверки",
    "",
    "- Нужна явная отметка, что вечернее закрытие прошло без подсказок Codex.",
    `- Если ты шёл по \`Ближайшее действие\` и не спрашивал Codex, запусти: \`pnpm dogfood:goal-check -- --date ${date} --no-codex-guidance\`.`,
    "- Если Codex всё же понадобился как навигатор закрытия, этот день не закрывает цель: проведи ещё один день Timeskein.",
  ].join("\n");
}

function buildIncompleteEvidenceMessage(date, weak, notPassing, reviewNextAction) {
  return [
    "# Финальная проверка пока не готова",
    "",
    "## До финальной проверки",
    "",
    ...(weak.length > 0 ? [`- Пересобери устаревшие или неполные файлы: \`pnpm dogfood:finish:save -- --date ${date}\`.`] : []),
    ...formatReviewNextActionHint(reviewNextAction),
    ...(notPassing.length > 0
      ? [
          "- Вернись к `Проверка перед отчётом`, закрой оставшиеся строки аудита и снова сохрани отчёт.",
          `- Для измерения закрытия дня нажми \`Начать закрытие дня\`, скопируй финальный отчёт за 10 минут или меньше, затем повтори \`pnpm dogfood:finish:save -- --date ${date}\`.`,
        ]
      : []),
    "",
    "## Детали",
    "",
    ...weak.map((item) => `- ${item}`),
    ...notPassing.map((item) => `- ${item}`),
  ].join("\n");
}

function formatReviewNextActionHint(reviewNextAction) {
  if (!reviewNextAction) {
    return [];
  }

  return [`- Ближайшее действие из сохранённого отчёта: ${reviewNextAction}`];
}

function includesAny(text, aliases) {
  return aliases.some((needle) => text.includes(needle));
}

function findReportState(text) {
  for (const line of text.split("\n")) {
    const match = line.match(/^Статус отчёта:\s*(.+)$/);
    if (match) return match[1].trim();
  }

  return undefined;
}

function isFinalReportState(state) {
  return state.toLowerCase().startsWith("финальный");
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

function isPassingAuditStatus(status) {
  return status === "pass" || status === "ок";
}

function hasGroupedReviewChecklist(text) {
  const section = extractMarkdownSection(text, ["## Проверка перед отчётом", "## Review before report"]);
  if (!section) {
    return false;
  }

  return includesAny(section, [
    "### Сначала закрыть",
    "### Дописать или исправить",
    "### Осознанно проверить",
    "### Готово",
  ]);
}

function hasReviewNextAction(text) {
  const section = extractMarkdownSection(text, ["## Проверка перед отчётом", "## Review before report"]);
  return Boolean(section && /^Ближайшее действие:\s*\S/m.test(section));
}

function findReviewNextAction(text) {
  const section = extractMarkdownSection(text, ["## Проверка перед отчётом", "## Review before report"]);
  if (!section) {
    return undefined;
  }

  for (const line of section.split("\n")) {
    const match = line.match(/^Ближайшее действие:\s*(.+)$/);
    if (match) return match[1].trim();
  }

  return undefined;
}

function findShortClosureVerdict(text) {
  const section = extractMarkdownSection(text, ["## Короткое закрытие"]);
  if (!section) {
    return undefined;
  }

  for (const line of section.split("\n")) {
    const match = line.match(/^-\s*(Закрытие уложилось в 10 минут:\s*.+)$/);
    if (match) return match[1].trim().replace(/\.$/, "");
  }

  return undefined;
}

function isPassingShortClosureVerdict(value) {
  return /^Закрытие уложилось в 10 минут:\s*да(?:\s|\(|$)/u.test(value);
}

function extractMarkdownSection(text, headings) {
  const lines = text.split("\n");
  const startIndex = lines.findIndex((line) => headings.includes(line.trim()));
  if (startIndex === -1) {
    return "";
  }

  const bodyStart = startIndex + 1;
  const endIndex = lines.findIndex((line, index) => index > startIndex && /^##\s+/.test(line));
  return lines.slice(bodyStart, endIndex === -1 ? lines.length : endIndex).join("\n");
}

async function readEvidenceFile(path, missing) {
  try {
    const text = await readFile(path, "utf8");
    if (text.trim().length === 0) {
      missing.push(`пустой файл: ${path}`);
      return "";
    }
    return text;
  } catch (error) {
    if (error?.code === "ENOENT") {
      missing.push(path);
      return "";
    }
    throw error;
  }
}

async function runOrExit(command, args) {
  try {
    await run(command, args);
  } catch (error) {
    if (!isExpectedStepFailure(error)) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

function run(command, args) {
  const label = formatCommand(command, args);
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        const error = new Error(`${label} terminated by ${signal}`);
        error.expectedStepFailure = true;
        reject(error);
        return;
      }

      if (code !== 0) {
        const error = new Error(`${label} exited with code ${code}`);
        error.expectedStepFailure = true;
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function isExpectedStepFailure(error) {
  return Boolean(error && typeof error === "object" && error.expectedStepFailure);
}

function formatCommand(command, args) {
  if (command === "self" && args[0] === "--no-codex-guidance") {
    return "подтверждение: --no-codex-guidance (закрытие прошло без подсказок Codex)";
  }

  const displayCommand = command === process.execPath ? "node" : command;
  return [displayCommand, ...args.map(formatCommandArg)].map(shellQuote).join(" ");
}

function formatCommandArg(value) {
  if (value.startsWith(`${repoRoot}/`)) {
    return relative(repoRoot, value);
  }

  return value;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
