#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
try {
  const apiUrl = options.apiUrl || process.env.TIMESKEIN_API_URL || resolveLocalApiUrl(options.supportDir);
  const projection = await rpc(apiUrl, "operational_reality.list", options.asOf ? { as_of: options.asOf } : {});
  const output = `${JSON.stringify(projection, null, 2)}\n`;

  if (options.output) {
    const outputPath = resolve(options.output);
    await writeFile(outputPath, output, "utf8");
    process.stdout.write(`${outputPath}\n`);
  } else {
    process.stdout.write(output);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error([
    `Не удалось получить Рабочую реальность: ${message}`,
    "Локальный агент отвечает только пока Timeskein запущен.",
    "Открой приложение командой `pnpm dogfood:continue` и повтори экспорт.",
  ].join("\n"));
  process.exitCode = 1;
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
    body: JSON.stringify({
      version: "1.0",
      request_id: crypto.randomUUID(),
      method,
      params,
    }),
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
    if (arg === "--api-url") options.apiUrl = args[++index];
    else if (arg === "--support-dir") options.supportDir = args[++index];
    else if (arg === "--as-of") options.asOf = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Использование: pnpm export:operational-reality -- [параметры]

Параметры:
  --as-of ISO_TIME      Построить исторический снимок на указанное время
  --output PATH         Сохранить JSON в файл
  --api-url URL         Использовать явно заданный Local API
  --support-dir PATH    Читать agent.port из другого каталога данных`);
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (options.asOf && Number.isNaN(new Date(options.asOf).getTime())) {
    throw new Error(`Некорректное значение --as-of: ${options.asOf}`);
  }
  return options;
}
