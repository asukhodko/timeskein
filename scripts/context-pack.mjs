#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

try {
  const options = parseArgs(process.argv.slice(2));
  const apiUrl = options.apiUrl || process.env.TIMESKEIN_API_URL || resolveLocalApiUrl(options.supportDir);
  const result = await rpc(apiUrl, "context_pack.build", {
    profile: options.profile,
    scope_id: options.scope,
    as_of: options.asOf,
    format: options.format,
  });

  await logExport(apiUrl, options).catch(() => undefined);
  if (options.output) {
    const written = await writeOutput(options, result);
    process.stdout.write(`${written.join("\n")}\n`);
  } else if (options.format === "markdown") {
    process.stdout.write(`${result.markdown.trimEnd()}\n`);
  } else if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result.pack, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function writeOutput(options, result) {
  const output = resolve(options.output);
  if (!existsSync(dirname(output))) {
    throw new Error(`Каталог для экспорта не существует: ${dirname(output)}`);
  }
  if (options.format === "markdown") {
    await writeFile(output, `${result.markdown.trimEnd()}\n`, "utf8");
    return [output];
  }
  if (options.format === "json") {
    await writeFile(output, `${JSON.stringify(result.pack, null, 2)}\n`, "utf8");
    return [output];
  }
  const suffix = extname(output);
  const prefix = suffix === ".md" || suffix === ".json" ? output.slice(0, -suffix.length) : output;
  const markdownPath = `${prefix}.md`;
  const jsonPath = `${prefix}.json`;
  await Promise.all([
    writeFile(markdownPath, `${result.markdown.trimEnd()}\n`, "utf8"),
    writeFile(jsonPath, `${JSON.stringify(result.pack, null, 2)}\n`, "utf8"),
  ]);
  return [markdownPath, jsonPath];
}

async function logExport(apiUrl, options) {
  await rpc(apiUrl, "app_event.log", {
    source: "script",
    kind: "context_pack_exported",
    work_item_id: options.profile === "work-item-reentry" ? options.scope : undefined,
    payload: {
      profile: options.profile,
      scope_id: options.scope,
      format: options.format,
      control: "context_pack_cli",
    },
  });
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
  const options = { format: "both", asOf: new Date().toISOString() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--profile") options.profile = readArg(args, ++index, arg);
    else if (arg === "--scope") options.scope = readArg(args, ++index, arg);
    else if (arg === "--as-of") options.asOf = readArg(args, ++index, arg);
    else if (arg === "--format") options.format = readArg(args, ++index, arg);
    else if (arg === "--output") options.output = readArg(args, ++index, arg);
    else if (arg === "--api-url") options.apiUrl = readArg(args, ++index, arg);
    else if (arg === "--support-dir") options.supportDir = readArg(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Использование:
  pnpm context-pack -- --profile work-item-reentry|track-reentry --scope UUID [параметры]

Строит воспроизводимый Context Pack из канонической локальной базы.

Параметры:
  --as-of RFC3339       Состояние на момент времени, по умолчанию сейчас
  --format FORMAT       markdown, json или both; по умолчанию both
  --output PATH         Файл или префикс; для both создаются PATH.md и PATH.json
  --api-url URL         Явный адрес Local API
  --support-dir PATH    Каталог с agent.port
`);
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!new Set(["work-item-reentry", "track-reentry"]).has(options.profile)) {
    throw new Error("Нужен --profile work-item-reentry или track-reentry.");
  }
  if (!options.scope || !isUuid(options.scope)) throw new Error("Нужен --scope с UUID контура.");
  if (!new Set(["markdown", "json", "both"]).has(options.format)) {
    throw new Error("Допустимы --format markdown, json и both.");
  }
  if (Number.isNaN(Date.parse(options.asOf))) throw new Error("--as-of должен быть RFC3339 timestamp.");
  return options;
}

function readArg(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`После ${option} ожидается значение.`);
  return value;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
