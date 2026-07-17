#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  DECISION_TYPES,
  DECISION_FOLLOWUP_STATUSES,
  decisionFollowupStatusIds,
  decisionTypeIds,
  getPeriodReportProfile,
  supportedProfileIds,
} from "./lib/period-report-profiles.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");

try {
  const command = process.argv[2];
  if (!command || ["--help", "-h"].includes(command)) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(process.argv.slice(3));
  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
  if (!existsSync(dbPath)) throw new Error(`База Timeskein не найдена: ${dbPath}`);

  if (command === "save") {
    if (!options.input) throw new Error("Для сохранения нужен --input PATH с JSON-заготовкой обзора.");
    await ensureSchema(dbPath);
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    const session = normalizeReflectionInput(input, options.now);
    await saveReflection(dbPath, session);
    process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
  } else if (command === "list") {
    const sessions = await listReflections(dbPath, options);
    process.stdout.write(options.format === "json" ? `${JSON.stringify(sessions, null, 2)}\n` : renderList(sessions));
  } else {
    throw new Error(`Неизвестная команда: ${command}. Допустимы save и list.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const result = { format: "md" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--input") result.input = readArg(args, ++index, arg);
    else if (arg === "--db") result.db = readArg(args, ++index, arg);
    else if (arg === "--from") result.from = readArg(args, ++index, arg);
    else if (arg === "--to") result.to = readArg(args, ++index, arg);
    else if (arg === "--profile") result.profile = readArg(args, ++index, arg);
    else if (arg === "--format") result.format = readArg(args, ++index, arg);
    else if (arg === "--now") result.now = readArg(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!["md", "json"].includes(result.format)) throw new Error("Допустимы --format md и --format json.");
  if (result.profile && !getPeriodReportProfile(result.profile)) {
    throw new Error(`Неизвестный профиль ${result.profile}. Допустимы: ${supportedProfileIds().join(", ")}.`);
  }
  return result;
}

function readArg(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`После ${option} ожидается значение.`);
  return value;
}

function normalizeReflectionInput(input, nowOverride) {
  const period = input.period ?? {};
  assertDate(period.from, "period.from");
  assertDate(period.to, "period.to");
  if (period.from >= period.to) throw new Error("period.to должно быть позже period.from; верхняя граница не включается.");
  if (!getPeriodReportProfile(input.profile)) {
    throw new Error(`Неизвестный profile. Допустимы: ${supportedProfileIds().join(", ")}.`);
  }
  const summary = String(input.summary ?? "").trim();
  if (!summary) throw new Error("Поле summary обязательно: зафиксируй главный вывод обзора.");
  if (!Array.isArray(input.findings)) throw new Error("Поле findings должно быть массивом строк.");
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) {
    throw new Error("Нужно сохранить хотя бы одно решение в decisions.");
  }
  const allowed = new Set(decisionTypeIds());
  const allowedFollowups = new Set(decisionFollowupStatusIds());
  const createdAt = nowOverride ? new Date(nowOverride) : new Date();
  if (Number.isNaN(createdAt.getTime())) throw new Error("Некорректное значение --now.");

  return {
    id: input.id || randomUUID(),
    created_at: createdAt.toISOString(),
    period: { from: period.from, to: period.to },
    profile: input.profile,
    filters: input.filters && typeof input.filters === "object" ? input.filters : {},
    report_hash: input.report_hash ?? null,
    summary,
    findings: input.findings.map((item) => String(item).trim()).filter(Boolean),
    decisions: input.decisions.map((item, index) => {
      const decision = String(item.decision ?? "").trim();
      const subject = String(item.subject ?? item.work_item_title ?? "").trim();
      if (!allowed.has(decision)) throw new Error(`decisions[${index}].decision неизвестно: ${decision || "пусто"}.`);
      if (!subject) throw new Error(`decisions[${index}].subject обязательно.`);
      return {
        id: item.id || randomUUID(),
        work_item_id: item.work_item_id || null,
        track_id: item.track_id || null,
        track_path: Array.isArray(item.track_path)
          ? item.track_path
          : item.track_id && input.filters?.track?.id === item.track_id
            ? input.filters.track.path ?? []
            : [],
        subject,
        decision,
        note: String(item.note ?? "").trim() || null,
      };
    }),
    decision_followups: (Array.isArray(input.decision_followups) ? input.decision_followups : []).map((item, index) => {
      const priorDecisionId = String(item.prior_decision_id ?? "").trim();
      const status = String(item.status ?? "").trim();
      if (!priorDecisionId) throw new Error(`decision_followups[${index}].prior_decision_id обязательно.`);
      if (!allowedFollowups.has(status)) {
        throw new Error(`decision_followups[${index}].status неизвестно: ${status || "пусто"}.`);
      }
      return {
        id: item.id || randomUUID(),
        prior_decision_id: priorDecisionId,
        status,
        note: String(item.note ?? "").trim() || null,
        evidence_event_id: String(item.evidence_event_id ?? "").trim() || null,
      };
    }),
  };
}

async function ensureSchema(dbPath) {
  const reflectionMigration = join(repoRoot, "apps/agent/migrations/009_reflection_sessions.sql");
  const semanticsMigration = join(repoRoot, "apps/agent/migrations/010_semantic_tracks.sql");
  const evidenceMigration = join(repoRoot, "apps/agent/migrations/011_evidence_story.sql");
  await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", dbPath, `.read ${reflectionMigration}`]);
  await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", dbPath, `.read ${semanticsMigration}`]);
  await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", dbPath, `.read ${evidenceMigration}`]);
}

async function saveReflection(dbPath, session) {
  const sql = [
    "PRAGMA foreign_keys=ON;",
    "BEGIN IMMEDIATE;",
    `INSERT INTO reflection_sessions (id, created_at, period_from, period_to, profile, filters_json, report_hash, summary, findings_json) VALUES (${[
      session.id,
      session.created_at,
      session.period.from,
      session.period.to,
      session.profile,
      JSON.stringify(session.filters),
      session.report_hash,
      session.summary,
      JSON.stringify(session.findings),
    ].map(sqlValue).join(", ")});`,
    ...session.decisions.map((decision) =>
      `INSERT INTO reflection_decisions (id, reflection_session_id, work_item_id, subject, decision, note, created_at) VALUES (${[
        decision.id,
        session.id,
        decision.work_item_id,
        decision.subject,
        decision.decision,
        decision.note,
        session.created_at,
      ].map(sqlValue).join(", ")});`
    ),
    ...session.decisions
      .filter((decision) => decision.track_id)
      .map((decision) =>
        `INSERT INTO reflection_decision_tracks (reflection_decision_id, track_id, track_path_json) VALUES (${[
          decision.id,
          decision.track_id,
          JSON.stringify(decision.track_path ?? []),
        ].map(sqlValue).join(", ")});`
      ),
    ...session.decision_followups.map((followup) =>
      `INSERT INTO reflection_decision_followups (id, reflection_session_id, prior_decision_id, status, note, evidence_event_id, created_at) VALUES (${[
        followup.id,
        session.id,
        followup.prior_decision_id,
        followup.status,
        followup.note,
        followup.evidence_event_id,
        session.created_at,
      ].map(sqlValue).join(", ")});`
    ),
    "COMMIT;",
  ].join("\n");
  await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", dbPath, sql], { maxBuffer: 16 * 1024 * 1024 });
}

async function listReflections(dbPath, options) {
  if (!(await tableExists(dbPath, "reflection_sessions"))) return [];
  const conditions = [];
  if (options.from) {
    assertDate(options.from, "--from");
    conditions.push(`s.period_to > ${sqlValue(options.from)}`);
  }
  if (options.to) {
    assertDate(options.to, "--to");
    conditions.push(`s.period_from < ${sqlValue(options.to)}`);
  }
  if (options.profile) conditions.push(`s.profile = ${sqlValue(options.profile)}`);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const hasDecisionTracks = await tableExists(dbPath, "reflection_decision_tracks");
  const decisionTrackFields = hasDecisionTracks
    ? ", 'track_id', rdt.track_id, 'track_path', json(rdt.track_path_json)"
    : ", 'track_id', NULL, 'track_path', json('[]')";
  const decisionTrackJoin = hasDecisionTracks
    ? "LEFT JOIN reflection_decision_tracks rdt ON rdt.reflection_decision_id = d.id"
    : "";
  const rows = await sqliteJson(dbPath, `
    SELECT s.id, s.created_at, s.period_from, s.period_to, s.profile, s.filters_json,
           s.report_hash, s.summary, s.findings_json,
           COALESCE(json_group_array(CASE WHEN d.id IS NOT NULL THEN json_object(
             'id', d.id,
             'work_item_id', d.work_item_id,
             'subject', d.subject,
             'decision', d.decision,
             'note', d.note,
             'created_at', d.created_at
             ${decisionTrackFields}
           ) END) FILTER (WHERE d.id IS NOT NULL), json('[]')) AS decisions_json
      FROM reflection_sessions s
      LEFT JOIN reflection_decisions d ON d.reflection_session_id = s.id
      ${decisionTrackJoin}
      ${where}
     GROUP BY s.id
     ORDER BY s.created_at DESC;
  `);
  const sessions = rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    period: { from: row.period_from, to: row.period_to },
    profile: row.profile,
    filters: parseJson(row.filters_json, {}),
    report_hash: row.report_hash,
    summary: row.summary,
    findings: parseJson(row.findings_json, []),
    decisions: parseJson(row.decisions_json, []),
  }));
  const hasFollowups = await tableExists(dbPath, "reflection_decision_followups");
  if (hasFollowups && sessions.length > 0) {
    const followups = await sqliteJson(dbPath, `
      SELECT f.id, f.reflection_session_id, f.prior_decision_id, f.status, f.note,
             f.evidence_event_id, f.created_at, d.subject
        FROM reflection_decision_followups f
        JOIN reflection_decisions d ON d.id = f.prior_decision_id
       WHERE f.reflection_session_id IN (${sessions.map((session) => sqlValue(session.id)).join(", ")})
       ORDER BY f.created_at, f.id;
    `);
    for (const session of sessions) {
      session.decision_followups = followups.filter((followup) => followup.reflection_session_id === session.id);
    }
  } else {
    for (const session of sessions) session.decision_followups = [];
  }
  return sessions;
}

function renderList(sessions) {
  const lines = ["# Сохранённые обзоры Timeskein", ""];
  if (sessions.length === 0) return `${lines.join("\n")}- Обзоров пока нет.\n`;
  for (const session of sessions) {
    lines.push(
      `## ${session.period.from} — ${session.period.to} · ${session.profile}`,
      "",
      `${session.summary}`,
      "",
      `Сохранено: ${session.created_at}`,
      "",
      "### Решения",
      ""
    );
    for (const decision of session.decisions) {
      const scope = decision.track_id
        ? ` [Track: ${(decision.track_path ?? []).map((node) => node.title).join(" / ") || decision.track_id}]`
        : "";
      lines.push(`- **${decisionLabel(decision.decision)}:** ${decision.subject}${scope}${decision.note ? ` — ${decision.note}` : ""}`);
    }
    if ((session.decision_followups ?? []).length > 0) {
      lines.push("", "### Проверка прошлых решений", "");
      for (const followup of session.decision_followups) {
        lines.push(`- **${followupLabel(followup.status)}:** ${followup.subject}${followup.note ? ` — ${followup.note}` : ""}${followup.evidence_event_id ? ` [evidence event: ${followup.evidence_event_id}]` : ""}`);
      }
    }
    if (session.findings.length > 0) {
      lines.push("", "### Выводы", "", ...session.findings.map((item) => `- ${item}`));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function decisionLabel(id) {
  return DECISION_TYPES.find((item) => item.id === id)?.title ?? id;
}

function followupLabel(id) {
  return DECISION_FOLLOWUP_STATUSES.find((item) => item.id === id)?.title ?? id;
}

async function tableExists(dbPath, table) {
  const rows = await sqliteJson(dbPath, `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=${sqlValue(table)}`);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function sqliteJson(dbPath, sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-cmd", ".timeout 5000", "-json", dbPath, sql], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new Error(`${label} должно иметь формат YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== Number(value.slice(0, 4)) || parsed.getMonth() + 1 !== Number(value.slice(5, 7)) || parsed.getDate() !== Number(value.slice(8, 10))) {
    throw new Error(`${label} содержит некорректную календарную дату.`);
  }
}

function printHelp() {
  console.log(`Использование:
  pnpm reflection:save -- --input PATH [--db PATH] [--now ISO_DATE]
  pnpm reflection:list -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--profile PROFILE] [--format md|json] [--db PATH]

Заготовку для --input создаёт:
  pnpm report:period -- --from YYYY-MM-DD --to YYYY-MM-DD --profile weekly-review --reflection-template PATH

Профили: ${supportedProfileIds().join(", ")}
Решения: ${decisionTypeIds().join(", ")}
Проверка прошлых решений: ${decisionFollowupStatusIds().join(", ")}`);
}
