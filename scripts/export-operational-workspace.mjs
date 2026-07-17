#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

try {
  const options = parseArgs(process.argv.slice(2));
  const apiUrl = options.apiUrl || process.env.TIMESKEIN_API_URL || resolveLocalApiUrl(options.supportDir);
  const revisions = await rpc(apiUrl, "day_contract.list", { from: options.from, to: options.to });
  const days = groupByDay(revisions.revisions);
  const payload = {
    schema_version: 1,
    kind: "timeskein_operational_workspace_export",
    period: { from: options.from, to: options.to, upper_bound_inclusive: false },
    days,
    total_revisions: revisions.total,
    exported_at: new Date().toISOString(),
  };
  const output = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    await writeFile(outputPath, output, "utf8");
    process.stdout.write(`${outputPath}\n`);
  } else {
    process.stdout.write(output);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function groupByDay(revisions) {
  const grouped = new Map();
  for (const revision of revisions) {
    const list = grouped.get(revision.local_date) ?? [];
    list.push(revision);
    grouped.set(revision.local_date, list);
  }
  return [...grouped.entries()].map(([localDate, dayRevisions]) => ({
    local_date: localDate,
    current_contract: dayRevisions.at(-1),
    revisions: dayRevisions,
  }));
}

function resolveLocalApiUrl(supportDirOption) {
  const supportDir = supportDirOption
    ? resolve(supportDirOption)
    : join(homedir(), "Library/Application Support/Timeskein");
  const portPath = join(supportDir, "agent.port");
  if (!existsSync(portPath)) {
    throw new Error(`Локальный агент не найден: ${portPath}. Сначала запусти Timeskein.`);
  }
  const port = readFileSync(portPath, "utf8").trim();
  if (!/^\d+$/.test(port)) throw new Error(`Некорректный файл порта: ${portPath}`);
  return `http://127.0.0.1:${port}/api`;
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: "1.0", request_id: crypto.randomUUID(), method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
  return data.result;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--from") options.from = readArg(args, ++index, arg);
    else if (arg === "--to") options.to = readArg(args, ++index, arg);
    else if (arg === "--output") options.output = readArg(args, ++index, arg);
    else if (arg === "--api-url") options.apiUrl = readArg(args, ++index, arg);
    else if (arg === "--support-dir") options.supportDir = readArg(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Использование:
  pnpm export:operational-workspace -- --from YYYY-MM-DD --to YYYY-MM-DD [параметры]

Экспортирует договоры дня и неизменяемую историю их ревизий в JSON.
Верхняя граница периода не включается.

Параметры:
  --output PATH       Сохранить JSON в файл
  --api-url URL       Использовать явно заданный Local API
  --support-dir PATH  Читать agent.port из другого каталога данных`);
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!options.from || !options.to) throw new Error("Нужны --from и --to; верхняя граница не включается.");
  for (const [name, value] of [["--from", options.from], ["--to", options.to]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} должен иметь формат YYYY-MM-DD.`);
  }
  if (options.from >= options.to) throw new Error("--to должен быть позже --from.");
  return options;
}

function readArg(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`После ${option} ожидается значение.`);
  return value;
}
