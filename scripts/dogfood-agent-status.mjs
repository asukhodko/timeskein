#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const supportDir = options.supportDir
  ? resolve(options.supportDir)
  : join(homedir(), "Library/Application Support/Timeskein");
const portFile = join(supportDir, "agent.port");
const timeoutMs = options.timeoutMs ?? 20_000;

const result = await waitForAgent(portFile, timeoutMs);

if (!result.ok) {
  process.stdout.write(
    [
      "# Статус локального агента Timeskein",
      "",
      `Состояние: не готов`,
      `Каталог данных: ${supportDir}`,
      "",
      "## Что мешает",
      "",
      `- ${result.error}`,
      "",
      "## Что сделать",
      "",
      "- Если Timeskein не запущен, начни день командой `pnpm dogfood:start`.",
      "- Если день уже начат, но приложение было закрыто, вернись к нему командой `pnpm dogfood:continue`.",
      "- Если после падения остался устаревший файл порта, повторный запуск приложения должен перезаписать его.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const status = result.status;
process.stdout.write(
  [
    "# Статус локального агента Timeskein",
    "",
    "Состояние: готов",
    `API: ${result.apiUrl}`,
    `Каталог данных: ${supportDir}`,
    `Файл данных: ${status.storage_path}`,
    `База в порядке: ${status.db_ok}`,
    `Дел в базе: ${status.work_items_count}`,
    `Агент работает: ${status.uptime_seconds} с`,
    "",
  ].join("\n")
);

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--support-dir") {
      result.supportDir = args[++index];
    } else if (arg === "--timeout-ms") {
      result.timeoutMs = Number(args[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (result.timeoutMs !== undefined && (!Number.isFinite(result.timeoutMs) || result.timeoutMs <= 0)) {
    throw new Error(`Некорректное значение --timeout-ms: ${result.timeoutMs}`);
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:status [--support-dir path] [--timeout-ms 20000]

Ждёт файл порта встроенного локального агента Timeskein и проверяет agent.status.
Выходит с кодом 1, если агент не отвечает или сообщает db_ok=false.
Для чистого начала дня используй dogfood:start, для возврата к уже начатому дню — dogfood:continue.`);
}

async function waitForAgent(path, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = `файл порта не найден: ${path}`;

  while (Date.now() < deadline) {
    if (!existsSync(path)) {
      await delay(150);
      continue;
    }

    const port = readFileSync(path, "utf8").trim();
    if (!/^\d+$/.test(port)) {
      lastError = `в файле порта некорректное содержимое: ${path}`;
      await delay(150);
      continue;
    }

    const apiUrl = `http://127.0.0.1:${port}/api`;
    try {
      const status = await rpc(apiUrl, "agent.status");
      if (status.db_ok !== true) {
        return {
          ok: false,
          error: `Агент ответил, но база не в порядке: ${apiUrl}`,
        };
      }

      return { ok: true, apiUrl, status };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(150);
    }
  }

  return {
    ok: false,
    error: `Агент не ответил за ${timeout} мс. Последняя ошибка: ${lastError}`,
  };
}

async function rpc(apiUrl, method, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "1.0",
        request_id: crypto.randomUUID(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${method}: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
    }

    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
