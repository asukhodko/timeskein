#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const date = options.date ?? formatLocalDate(new Date());
const rcArgs = ["scripts/dogfood-rc-check.mjs", "--strict"];
const shouldCheckSavedEvidence = !options.db && !options.skipSavedEvidenceCheck;

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

const steps = [
  ...(shouldCheckSavedEvidence
    ? [["node", ["scripts/dogfood-goal-check.mjs", "--check-saved-evidence-only", "--date", date]]]
    : []),
  ["pnpm", ["test"]],
  ["pnpm", ["dogfood:preflight"]],
  [process.execPath, rcArgs],
];

if (options.checkSavedEvidenceOnly) {
  try {
    await checkSavedEvidence(date);
    console.log(`Сохранённые материалы dogfood-дня за ${date} найдены.`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

if (options.dryRun) {
  console.log("# Финальная проверка цели Timeskein — dry run");
  console.log("");
  console.log("Будут выполнены команды:");
  console.log("");
  for (const [command, args] of steps) {
    console.log(`- ${formatCommand(command, args)}`);
  }
  process.exit(0);
}

for (const [command, args] of steps) {
  await run(command, args);
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
  console.log(`Использование: pnpm dogfood:goal-check [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--min-focus-minutes N] [--save | --out path.md] [--skip-saved-evidence-check] [--dry-run]

Запускает финальный локальный gate для цели про дешёвое вечернее закрытие дня:

1. сохранённый dogfood-отчёт и RC-аудит есть за выбранную дату
2. pnpm test
3. pnpm dogfood:preflight
4. dogfood:rc-check --strict для выбранного dogfood-дня

Используй это после реального dogfood-дня, перед закрытием цели.`);
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
    ["# Dogfood-отчёт Timeskein", "# Timeskein dogfood report"],
    ["## Данные фокуса", "## Focus Data"],
    ["## Проверка перед отчётом", "## Review before report"],
    ["## Аудит закрытия дня", "## Daily Control Goal Audit"],
    ["## Телеметрия приложения", "## App Telemetry"],
  ];
  const rcRequirements = [
    ["# RC-аудит dogfood-дня Timeskein", "# Timeskein dogfood RC check"],
    ["## Сводка доказательств", "## Evidence Summary"],
    ["## Аудит закрытия дня", "## Daily Control Goal Audit"],
  ];
  const reportDailyControlRows = [
    ["Финальное состояние чистое", "Final state clean"],
    ["Фокус-блоки видны", "Focus blocks visible"],
    ["Итоги по Work Item есть", "Work Item totals available"],
    ["Зоны активности разделены", "Activity Zones separated"],
    ["Контекст дня и Work Item сохранён", "Day and Work Item context present"],
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
    ["Итоги по Work Item есть", "Work Item totals available"],
    ["Зоны активности разделены", "Activity Zones separated"],
    ["Контекст дня и Work Item сохранён", "Day and Work Item context present"],
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
  for (const aliases of rcRequirements) {
    if (!includesAny(rcCheck, aliases)) {
      weak.push(`В ${rcPath} нет раздела «${aliases[0]}»`);
    }
  }
  for (const aliases of reportDailyControlRows) {
    if (!includesAny(report, aliases)) {
      weak.push(`В ${reportPath} нет строки аудита «${aliases[0]}»`);
    } else if (!isPassingAuditStatus(findAuditRowStatus(report, aliases))) {
      notPassing.push(`В ${reportPath} строка аудита «${aliases[0]}» ещё не в статусе ok/pass`);
    }
  }
  for (const aliases of rcDailyControlRows) {
    if (!includesAny(rcCheck, aliases)) {
      weak.push(`В ${rcPath} нет строки аудита «${aliases[0]}»`);
    } else if (!isPassingAuditStatus(findAuditRowStatus(rcCheck, aliases))) {
      notPassing.push(`В ${rcPath} строка аудита «${aliases[0]}» ещё не в статусе ok/pass`);
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
    throw new Error(buildIncompleteEvidenceMessage(date, weak, notPassing));
  }
}

function buildMissingEvidenceMessage(date, missing) {
  return [
    "# Финальная проверка пока не готова",
    "",
    "## Что ещё осталось",
    "",
    "- Сохранённые материалы dogfood-дня ещё не найдены.",
    `- Сохрани вечерний отчёт и RC-аудит: \`pnpm dogfood:finish:save -- --date ${date}\`.`,
    "",
    "## Детали",
    "",
    ...missing.map((item) => `- ${item}`),
  ].join("\n");
}

function buildIncompleteEvidenceMessage(date, weak, notPassing) {
  return [
    "# Финальная проверка пока не готова",
    "",
    "## Что ещё осталось",
    "",
    ...(weak.length > 0 ? [`- Пересобери устаревшие или неполные файлы: \`pnpm dogfood:finish:save -- --date ${date}\`.`] : []),
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
  if (!includesAny(text, ["## Проверка перед отчётом", "## Review before report"])) {
    return false;
  }

  return includesAny(text, [
    "### Сначала закрыть",
    "### Дописать или исправить",
    "### Осознанно проверить",
    "### Готово",
  ]);
}

async function readEvidenceFile(path, missing) {
  try {
    const text = await readFile(path, "utf8");
    if (text.trim().length === 0) {
      missing.push(`${path} is empty`);
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
        reject(new Error(`${label} terminated by ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

function formatCommand(command, args) {
  const displayCommand = command === process.execPath ? "node" : command;
  return [displayCommand, ...args].map(shellQuote).join(" ");
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
