#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));

try {
  if (options.resetDb) {
    const resetArgs = [resolve(repoRoot, "scripts/dogfood-reset-db.mjs")];
    if (!options.dryRun) {
      resetArgs.push("--apply");
    }
    if (options.db) {
      resetArgs.push("--db", options.db);
    }

    await run(process.execPath, resetArgs);

    if (options.dryRun) {
      await run(process.execPath, openMacosAppArgs("--check-running-only"));
      if (!options.skipPreflight) {
        await run("pnpm", ["dogfood:preflight"]);
      }
      console.log("\nПроверка чистого старта Timeskein прошла. Сухой прогон: база не перемещалась, приложение не открывалось.");
      process.exit(0);
    }
  }

  const readyArgs = [resolve(repoRoot, "scripts/dogfood-ready.mjs")];
  if (options.mode) {
    readyArgs.push("--mode", options.mode);
  }
  if (options.db) {
    readyArgs.push("--db", options.db);
  }
  if (options.date) {
    readyArgs.push("--date", options.date);
  }

  await run(process.execPath, readyArgs);

  await run(process.execPath, openMacosAppArgs("--check-running-only"));

  if (!options.skipPreflight) {
    await run("pnpm", ["dogfood:preflight"]);
  }

  if (options.dryRun) {
    console.log("\nПроверка старта дня Timeskein прошла. Сухой прогон: приложение не открывалось.");
  } else {
    await run(process.execPath, openMacosAppArgs());
    await run(process.execPath, [resolve(repoRoot, "scripts/dogfood-agent-status.mjs")]);
    console.log("\nПроверка старта дня Timeskein прошла. Приложение открыто, встроенный агент отвечает.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nПроверка старта дня Timeskein не прошла: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const result = {
    dryRun: false,
    resetDb: false,
    skipPreflight: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--db") {
      result.db = args[++index];
    } else if (arg === "--date") {
      result.date = args[++index];
    } else if (arg === "--mode") {
      const mode = args[++index];
      if (mode !== "start" && mode !== "continue") {
        throw new Error(`Некорректное значение --mode, ожидается start или continue: ${mode}`);
      }
      result.mode = mode;
    } else if (arg === "--continue") {
      result.mode = "continue";
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--reset-db") {
      result.resetDb = true;
    } else if (arg === "--skip-preflight") {
      result.skipPreflight = true;
    } else if (arg === "--allow-running") {
      result.allowRunning = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:start [--mode start|continue] [--skip-preflight] [--dry-run] [--reset-db] [--allow-running] [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Проверяет старт дня Timeskein:
1. при --reset-db готовит резервный сброс локальной базы;
2. проверяет готовность реальной локальной базы в режиме start или continue;
3. проверяет, не запущено ли приложение;
4. запускает dogfood preflight, если не передан --skip-preflight;
5. открывает macOS-приложение, если не передан --dry-run;
6. ждёт ответа встроенного агента.

С --reset-db --dry-run только печатает план сброса и проверяет защитные условия. Файлы базы не перемещаются.
По умолчанию команда отказывается работать, если Timeskein уже запущен. Используй --allow-running только когда сознательно переиспользуешь текущий процесс приложения.`);
}

function openMacosAppArgs(...extraArgs) {
  const args = [resolve(repoRoot, "scripts/open-macos-app.mjs"), ...extraArgs];
  if (options.allowRunning) {
    args.push("--allow-running");
  }
  return args;
}

function run(command, args) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} завершился по сигналу ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} завершился с кодом ${code}`));
        return;
      }

      resolve();
    });
  });
}
