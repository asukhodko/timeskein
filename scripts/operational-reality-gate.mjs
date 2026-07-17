#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

try {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
  if (!existsSync(dbPath)) throw new Error(`База Timeskein не найдена: ${dbPath}`);
  await ensureOperationalRealitySchema(dbPath);

  const [starts, records, followups, refs, appStarts, closures] = await Promise.all([
    query(dbPath, `
      SELECT id, ts, work_item_id, json_extract(payload, '$.control') AS control
      FROM app_events
      WHERE kind = 'focus_start_requested'
        AND json_extract(payload, '$.control') = 'operational_reality'
        AND date(ts, 'localtime') >= ${sql(options.from)}
        AND date(ts, 'localtime') < ${sql(options.to)}
      ORDER BY datetime(ts), id;
    `),
    query(dbPath, `
      SELECT id, subject_kind, subject_id, work_item_id, record_kind,
             operational_state, next_action_status, text, occurred_at,
             supersedes_id, evidence_event_id, reflection_decision_id
      FROM causal_records
      WHERE date(occurred_at, 'localtime') >= ${sql(options.from)}
        AND date(occurred_at, 'localtime') < ${sql(options.to)}
      ORDER BY datetime(occurred_at), datetime(recorded_at), id;
    `),
    query(dbPath, `
      SELECT id, prior_decision_id, status, evidence_event_id, created_at
      FROM reflection_decision_followups
      WHERE date(created_at, 'localtime') >= ${sql(options.from)}
        AND date(created_at, 'localtime') < ${sql(options.to)}
      ORDER BY datetime(created_at), id;
    `),
    query(dbPath, `
      SELECT work_item_event_id, ref_kind, ref_value
      FROM evidence_ref_snapshots
      WHERE date(captured_at, 'localtime') >= ${sql(options.from)}
        AND date(captured_at, 'localtime') < ${sql(options.to)};
    `),
    query(dbPath, `
      SELECT id, ts
      FROM app_events
      WHERE kind = 'app_started'
        AND date(ts, 'localtime') >= ${sql(options.from)}
        AND date(ts, 'localtime') < ${sql(options.to)}
      ORDER BY datetime(ts), id;
    `),
    query(dbPath, `
      SELECT id, ts
      FROM app_events
      WHERE kind = 'day_closure_completed'
        AND date(ts, 'localtime') >= ${sql(options.from)}
        AND date(ts, 'localtime') < ${sql(options.to)}
      ORDER BY datetime(ts), id;
    `),
  ]);

  const startDays = [...new Set(starts.map((event) => localDay(event.ts)))];
  const corrections = records.filter(
    (record) => record.record_kind === "correction" && record.supersedes_id,
  );
  const states = [...new Set(records.map((record) => record.operational_state).filter(Boolean))];
  const attentionStates = states.filter((state) =>
    ["waiting", "blocked", "reactive", "stale-important", "meeting-tail"].includes(state),
  );
  const latestCorrectionAt = corrections
    .map((record) => Date.parse(record.occurred_at))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const restartedAfterCorrection = latestCorrectionAt !== undefined && appStarts.some(
    (event) => Date.parse(event.ts) > latestCorrectionAt,
  );
  const closureDays = [...new Set(closures.map((event) => localDay(event.ts)))];
  const refsByEvent = new Map();
  for (const ref of refs) {
    const list = refsByEvent.get(ref.work_item_event_id) ?? [];
    list.push(ref);
    refsByEvent.set(ref.work_item_event_id, list);
  }
  const chains = findCausalChains(records, refsByEvent);

  const checks = [
    {
      ok: startDays.length >= options.minDays,
      label: `реальных дней со стартом из рабочей реальности: ${startDays.length}/${options.minDays}`,
    },
    {
      ok: starts.length >= options.minStarts,
      label: `стартов из рабочей реальности: ${starts.length}/${options.minStarts}`,
    },
    {
      ok: attentionStates.length >= 1,
      label: `реальных waiting/blocked/reactive/stale/meeting-tail состояний: ${attentionStates.join(", ") || "нет"}`,
    },
    {
      ok: corrections.length >= 1,
      label: `явных коррекций состояния: ${corrections.length}/1`,
    },
    {
      ok: restartedAfterCorrection,
      label: `перезапуск после последней коррекции: ${restartedAfterCorrection ? "есть" : "нет"}`,
    },
    {
      ok: followups.length >= 1,
      label: `проверок прежних Reflection-решений: ${followups.length}/1`,
    },
    {
      ok: chains.length >= 1,
      label: `цепочек намерение -> результат с evidence -> следующий шаг: ${chains.length}/1`,
    },
    {
      ok: closureDays.length >= options.minDays,
      label: `дней с завершённым обычным закрытием: ${closureDays.length}/${options.minDays}`,
    },
  ];
  const result = {
    ok: checks.every((check) => check.ok),
    period: { from: options.from, to: options.to },
    start_days: startDays,
    operational_reality_starts: starts.length,
    observed_states: states,
    attention_states: attentionStates,
    restarted_after_correction: restartedAfterCorrection,
    closure_days: closureDays,
    corrections: corrections.map((record) => ({
      id: record.id,
      subject_kind: record.subject_kind,
      subject_id: record.subject_id,
      state: record.operational_state,
      supersedes_id: record.supersedes_id,
    })),
    reflection_followups: followups,
    causal_chains: chains,
    checks,
  };

  process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
  if (!result.ok) process.exit(1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function findCausalChains(records, refsByEvent) {
  const byWorkItem = new Map();
  for (const record of records) {
    if (!record.work_item_id) continue;
    const list = byWorkItem.get(record.work_item_id) ?? [];
    list.push(record);
    byWorkItem.set(record.work_item_id, list);
  }
  const chains = [];
  for (const [workItemId, workItemRecords] of byWorkItem) {
    const intents = workItemRecords.filter((record) => record.record_kind === "intent");
    const results = workItemRecords.filter(
      (record) => record.record_kind === "result" && refsByEvent.has(record.evidence_event_id),
    );
    const nextActions = workItemRecords.filter((record) => record.record_kind === "next_action");
    for (const result of results) {
      const intent = intents.find((candidate) => candidate.occurred_at <= result.occurred_at);
      const nextAction = nextActions.find((candidate) => candidate.occurred_at >= result.occurred_at);
      if (!intent || !nextAction) continue;
      chains.push({
        work_item_id: workItemId,
        intent_id: intent.id,
        result_id: result.id,
        evidence_event_id: result.evidence_event_id,
        refs: refsByEvent.get(result.evidence_event_id),
        next_action_id: nextAction.id,
      });
      break;
    }
  }
  return chains;
}

async function query(dbPath, statement) {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-readonly", "-cmd", ".timeout 5000", "-json", dbPath, statement],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function ensureOperationalRealitySchema(dbPath) {
  const rows = await query(dbPath, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'app_events',
      'causal_records',
      'reflection_decision_followups',
      'evidence_ref_snapshots'
    )
    ORDER BY name;
  `);
  const existing = new Set(rows.map((row) => row.name));
  const required = [
    "app_events",
    "causal_records",
    "reflection_decision_followups",
    "evidence_ref_snapshots",
  ];
  const missing = required.filter((name) => !existing.has(name));
  if (missing.length > 0) {
    throw new Error(
      `База ещё не обновлена для Operational Reality: нет ${missing.join(", ")}. ` +
      "Закрой запущенный Timeskein, запусти свежую сборку через pnpm dogfood:start и повтори проверку.",
    );
  }
}

function localDay(timestamp) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function renderMarkdown(result) {
  const lines = [
    "# Проверка Operational Reality",
    "",
    `Период: ${result.period.from} включительно — ${result.period.to} исключительно`,
    `Итог: ${result.ok ? "пройдено" : "не пройдено"}`,
    "",
    "## Проверки",
    "",
    ...result.checks.map((check) => `- [${check.ok ? "x" : " "}] ${check.label}`),
    "",
    `Дни: ${result.start_days.join(", ") || "нет"}`,
    `Использованные состояния: ${result.observed_states.join(", ") || "нет"}`,
    "",
  ];
  if (!result.ok) {
    lines.push(
      "## Что делать в следующем прогоне",
      "",
      "1. В начале дня и после перерыва выбери пункт в `Рабочей реальности` и нажми `Начать отсюда`; обычный старт и диспетчеризация сюда не засчитываются.",
      "2. Подтверди одно реально встреченное состояние, затем хотя бы один раз исправь состояние с причиной и перезапусти приложение.",
      "3. Проверь одно решение прошлого обзора и собери по одному делу цепочку: старт -> результат с Ref -> следующий шаг.",
      "4. Закрой оба дня обычным вечерним контуром и повтори gate с новым диапазоном.",
      "",
      "Код завершения 1 и строка pnpm `[ELIFECYCLE]` ожидаемы, пока хотя бы один пункт выше не доказан.",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(args) {
  const result = { minDays: 2, minStarts: 3, format: "md" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--from") result.from = readArg(args, ++index, arg);
    else if (arg === "--to") result.to = readArg(args, ++index, arg);
    else if (arg === "--db") result.db = readArg(args, ++index, arg);
    else if (arg === "--min-days") result.minDays = readPositiveInteger(args, ++index, arg);
    else if (arg === "--min-starts") result.minStarts = readPositiveInteger(args, ++index, arg);
    else if (arg === "--format") result.format = readArg(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!result.from || !result.to) throw new Error("Нужны --from и --to; верхняя граница не включается.");
  for (const [name, value] of [["--from", result.from], ["--to", result.to]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} должен иметь формат YYYY-MM-DD.`);
  }
  if (result.from >= result.to) throw new Error("--to должен быть позже --from.");
  if (!new Set(["md", "json"]).has(result.format)) throw new Error("Допустимы --format md и --format json.");
  return result;
}

function readArg(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`После ${option} ожидается значение.`);
  return value;
}

function readPositiveInteger(args, index, option) {
  const value = Number(readArg(args, index, option));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${option} должен быть положительным целым числом.`);
  return value;
}

function printHelp() {
  console.log(`Использование:
  pnpm operational-reality:gate -- --from YYYY-MM-DD --to YYYY-MM-DD [параметры]

Проверяет двухдневную апробацию Operational Reality по реальной локальной базе.
Верхняя граница периода не включается.

Параметры:
  --db PATH          SQLite-база, по умолчанию основная база Timeskein
  --min-days N       Минимум дней со стартами из проекции, по умолчанию 2
  --min-starts N     Минимум стартов из проекции, по умолчанию 3
  --format md|json   Формат результата, по умолчанию md`);
}
