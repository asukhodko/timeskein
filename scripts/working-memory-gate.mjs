#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { findFocusSessionOverlaps } from "./lib/focus-overlaps.mjs";

const execFileAsync = promisify(execFile);

try {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
  if (!existsSync(dbPath)) throw new Error(`База Timeskein не найдена: ${dbPath}`);
  await ensureSchema(dbPath);

  const canonicalId = await resolveCanonicalId(dbPath, options.workItem);
  const itemRows = await query(dbPath, `
    SELECT id, title, deleted_at FROM work_items WHERE id = ${sql(canonicalId)};
  `);
  if (itemRows.length === 0) throw new Error(`Work Item не найден: ${options.workItem}`);
  const trackId = options.track || await resolveTrackId(dbPath, canonicalId);
  const fromTs = `${options.from}T00:00:00`;
  const toTs = `${options.to}T00:00:00`;

  const [memory, stages, stageEvents, sessions, appEvents, aliases] = await Promise.all([
    query(dbPath, `
      SELECT wme.id, wme.occurred_at, wme.recorded_at, wme.focus_session_id,
             wme.stage_id, wme.day_contract_revision_id, wme.provenance,
             wme.deleted_at, wme.current_revision_number,
             wmer.entry_kind, wmer.text, wmer.material_kind, wmer.material_value
      FROM work_memory_entries wme
      JOIN work_memory_entry_revisions wmer
        ON wmer.entry_id = wme.id
       AND wmer.revision_number = wme.current_revision_number
      WHERE wme.work_item_id = ${sql(canonicalId)}
        AND datetime(wme.occurred_at) >= datetime(${sql(fromTs)})
        AND datetime(wme.occurred_at) < datetime(${sql(toTs)})
      ORDER BY datetime(wme.occurred_at), wme.id;
    `),
    query(dbPath, `
      SELECT id, title, state, created_at, completed_at, deleted_at
      FROM work_item_stages WHERE work_item_id = ${sql(canonicalId)}
      ORDER BY position, datetime(created_at), id;
    `),
    query(dbPath, `
      SELECT id, stage_id, kind, occurred_at
      FROM work_item_stage_events
      WHERE work_item_id = ${sql(canonicalId)}
      ORDER BY datetime(occurred_at), id;
    `),
    query(dbPath, `
      SELECT fs.id, fs.work_item_id, fs.started_at, fs.stopped_at, fs.state,
             fws.stage_id, fws.stage_title, fws.daily_outcome,
             fws.day_contract_revision_id, fws.provenance AS snapshot_provenance
      FROM focus_sessions fs
      LEFT JOIN focus_session_work_snapshots fws ON fws.focus_session_id = fs.id
      WHERE fs.work_item_id = ${sql(canonicalId)}
        AND datetime(COALESCE(fs.stopped_at, ${sql(new Date().toISOString())})) > datetime(${sql(fromTs)})
        AND datetime(fs.started_at) < datetime(${sql(toTs)})
      ORDER BY datetime(fs.started_at), fs.id;
    `),
    query(dbPath, `
      SELECT id, ts, source, kind, work_item_id, focus_session_id, payload
      FROM app_events
      WHERE datetime(ts) >= datetime(${sql(fromTs)})
        AND datetime(ts) < datetime(${sql(toTs)})
        AND (work_item_id = ${sql(canonicalId)} OR work_item_id IS NULL)
      ORDER BY datetime(ts), id;
    `),
    query(dbPath, `
      SELECT source_work_item_id, canonical_work_item_id, merged_at
      FROM work_item_aliases WHERE canonical_work_item_id = ${sql(canonicalId)};
    `),
  ]);

  const revisionRows = await query(dbPath, `
    SELECT entry_id, COUNT(*) AS revisions,
           SUM(CASE WHEN change_kind = 'delete' THEN 1 ELSE 0 END) AS deletions
    FROM work_memory_entry_revisions
    WHERE entry_id IN (
      SELECT id FROM work_memory_entries WHERE work_item_id = ${sql(canonicalId)}
    )
    GROUP BY entry_id;
  `);
  const stageTransitions = stageEvents.filter((event) =>
    new Set(["activated", "completed", "reopened"]).has(event.kind)
  );
  const semanticKinds = new Set(["thought", "question", "decision", "observation"]);
  const semanticEntries = memory.filter((entry) => semanticKinds.has(entry.entry_kind));
  const materials = memory.filter((entry) => entry.entry_kind === "material" && entry.material_kind && entry.material_value);
  const causalChains = causalChainCount(memory);
  const focusStageIds = new Set(sessions.map((session) => session.stage_id).filter(Boolean));
  const focusWithOutcome = sessions.filter((session) => session.daily_outcome && session.day_contract_revision_id);
  const eventsByKind = groupBy(appEvents, (event) => event.kind);
  const reentryEvents = eventsByKind.get("reentry_started") ?? [];
  const reentryGaps = verifiedReentries(reentryEvents, sessions);
  const pauseEvidence = matchPauseThresholds(reentryGaps, [1, 3, 7]);
  const packBuildEvidence = (eventsByKind.get("context_pack_built") ?? [])
    .map((event) => parsePayload(event.payload))
    .filter((payload) => payload && matchesContextPackScope(payload, canonicalId, options.workItem, trackId));
  const packProfiles = new Set(packBuildEvidence.map((payload) => payload.profile));
  const exportEvidence = (eventsByKind.get("context_pack_exported") ?? [])
    .map((event) => parsePayload(event.payload))
    .filter((payload) => payload && matchesContextPackScope(payload, canonicalId, options.workItem, trackId));
  const exportedProfiles = new Set(exportEvidence.map((payload) => payload.profile));
  const exportedFormats = new Set(exportEvidence.flatMap((payload) =>
    payload.format === "both" ? ["markdown", "json"] : [payload.format]
  ));
  const exportedProfileFormats = new Set(exportEvidence.flatMap((payload) => {
    const formats = payload.format === "both" ? ["markdown", "json"] : [payload.format];
    return formats.filter(Boolean).map((format) => `${payload.profile}:${format}`);
  }));
  const requiredProfileFormats = [
    "work-item-reentry:markdown",
    "work-item-reentry:json",
    "track-reentry:markdown",
    "track-reentry:json",
  ];
  const failures = appEvents.filter((event) =>
    event.kind === "api_error" || event.kind.endsWith("_failed")
  );
  const overlaps = findFocusSessionOverlaps(sessions, { from: fromTs, to: toTs });
  const periodDays = Math.round((Date.parse(`${options.to}T00:00:00Z`) - Date.parse(`${options.from}T00:00:00Z`)) / 86_400_000);
  const stageSnapshotTitles = new Set(sessions.map((session) => session.stage_title).filter(Boolean));
  const hasEditedHistory = revisionRows.some((row) => Number(row.revisions) > 1);

  const checks = [
    check(periodDays >= 7, `календарный период: ${periodDays}/7 дней`),
    check(memory.length >= 6, `записей рабочей памяти: ${memory.length}/6`),
    check(semanticEntries.length >= 3, `мыслей, вопросов, решений и наблюдений: ${semanticEntries.length}/3`),
    check(materials.length >= 1, `зарегистрированных материалов: ${materials.length}/1`),
    check(hasEditedHistory, `история редакций: ${hasEditedHistory ? "есть" : "нет"}`),
    check(stages.length >= 2, `именованных этапов: ${stages.length}/2`),
    check(stageTransitions.length >= 1, `переходов этапов: ${stageTransitions.length}/1`),
    check(focusStageIds.size >= 2 && stageSnapshotTitles.size >= 2, `этапов в исторических снимках фокуса: ${Math.min(focusStageIds.size, stageSnapshotTitles.size)}/2`),
    check(focusWithOutcome.length >= 1, `снимков дневного результата: ${focusWithOutcome.length}/1`),
    check(causalChains >= 2, `следов «результат → изменение → следующий шаг»: ${causalChains}/2`),
    check(pauseEvidence.length === 3, `возвратов после пауз 1/3/7 дней: ${pauseEvidence.length}/3`),
    check(packProfiles.has("work-item-reentry") && packProfiles.has("track-reentry"), `Context Pack в UI: ${[...packProfiles].sort().join(", ") || "нет"}`),
    check(
      requiredProfileFormats.every((pair) => exportedProfileFormats.has(pair)),
      `экспорт профилей и форматов: ${[...exportedProfileFormats].sort().join(", ") || "нет"}`,
    ),
    check(Boolean(trackId), `долгое направление Track: ${trackId ?? "не назначено"}`),
    check(failures.length === 0, `ошибок API и действий: ${failures.length}`),
    check(overlaps.length === 0, `пересечений фокус-блоков: ${overlaps.length}`),
  ];
  const result = {
    ok: checks.every((item) => item.ok),
    work_item: { requested_id: options.workItem, canonical_id: canonicalId, title: itemRows[0].title },
    track_id: trackId,
    period: { from: options.from, to: options.to, upper_bound_inclusive: false, days: periodDays },
    evidence: {
      memory_entries: memory.length,
      edited_entries: revisionRows.filter((row) => Number(row.revisions) > 1).length,
      deleted_entries: revisionRows.filter((row) => Number(row.deletions) > 0).length,
      materials: materials.length,
      stages: stages.length,
      stage_transitions: stageTransitions.length,
      focus_stage_snapshots: focusStageIds.size,
      focus_outcome_snapshots: focusWithOutcome.length,
      causal_chains: causalChains,
      reentry_gaps: reentryGaps,
      rejected_reentry_attempts: reentryEvents.length - reentryGaps.length,
      matched_pause_evidence: pauseEvidence,
      context_pack_profiles: [...packProfiles].sort(),
      exported_profiles: [...exportedProfiles].sort(),
      exported_formats: [...exportedFormats].sort(),
      exported_profile_formats: [...exportedProfileFormats].sort(),
      aliases: aliases.length,
      failures: failures.map((event) => ({ id: event.id, ts: event.ts, kind: event.kind })),
      focus_overlaps: overlaps.length,
    },
    checks,
  };

  process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
  if (!result.ok && !options.softFail) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function causalChainCount(memory) {
  const byFocus = groupBy(memory.filter((entry) => entry.focus_session_id), (entry) => entry.focus_session_id);
  let count = 0;
  for (const entries of byFocus.values()) {
    const kinds = new Set(entries.map((entry) => entry.entry_kind));
    if (kinds.has("result") && kinds.has("state_change") && kinds.has("next_action")) count += 1;
  }
  return count;
}

function verifiedReentries(events, sessions) {
  return events.flatMap((event) => {
    const payload = parsePayload(event.payload);
    if (payload?.has_next_action !== true) return [];
    const eventTime = Date.parse(event.ts);
    if (!Number.isFinite(eventTime)) return [];
    const matchingFocus = sessions
      .map((session) => ({ session, delta: Date.parse(session.started_at) - eventTime }))
      .filter(({ delta }) => Number.isFinite(delta) && delta >= -30_000 && delta <= 300_000)
      .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0];
    if (!matchingFocus) return [];
    return [{
      event_id: event.id,
      ts: event.ts,
      focus_session_id: matchingFocus.session.id,
      focus_started_after_seconds: Math.round(matchingFocus.delta / 1000),
      gap_days: gapFromPreviousFocus(event.ts, sessions),
    }];
  });
}

function gapFromPreviousFocus(timestamp, sessions) {
  const ts = Date.parse(timestamp);
  const prior = sessions
    .map((session) => session.stopped_at)
    .filter(Boolean)
    .map(Date.parse)
    .filter((value) => value < ts)
    .sort((left, right) => right - left)[0];
  return prior == null ? null : Math.floor((ts - prior) / 86_400_000);
}

function matchPauseThresholds(gaps, thresholds) {
  const candidates = gaps.filter((entry) => entry.gap_days != null).sort((left, right) => right.gap_days - left.gap_days);
  const matches = [];
  for (const threshold of [...thresholds].sort((left, right) => right - left)) {
    const index = candidates.findIndex((entry) => entry.gap_days >= threshold);
    if (index < 0) continue;
    matches.push({ threshold_days: threshold, ...candidates[index] });
    candidates.splice(index, 1);
  }
  return matches.sort((left, right) => left.threshold_days - right.threshold_days);
}

async function resolveCanonicalId(dbPath, requestedId) {
  const rows = await query(dbPath, `
    WITH RECURSIVE aliases(id, depth) AS (
      VALUES(${sql(requestedId)}, 0)
      UNION ALL
      SELECT wai.canonical_work_item_id, aliases.depth + 1
      FROM work_item_aliases wai JOIN aliases ON wai.source_work_item_id = aliases.id
      WHERE aliases.depth < 32
    )
    SELECT id FROM aliases ORDER BY depth DESC LIMIT 1;
  `);
  return rows[0]?.id ?? requestedId;
}

async function resolveTrackId(dbPath, workItemId) {
  const rows = await query(dbPath, `
    SELECT track_id FROM work_item_tracks WHERE work_item_id = ${sql(workItemId)} LIMIT 1;
  `);
  return rows[0]?.track_id;
}

function check(ok, label) {
  return { ok: Boolean(ok), label };
}

function renderMarkdown(result) {
  const lines = [
    "# Приёмка Working Memory Bridge v1",
    "",
    `Дело: ${result.work_item.title} (${result.work_item.canonical_id})`,
    `Период: ${result.period.from} включительно — ${result.period.to} исключительно`,
    `Итог: ${result.ok ? "пройдено" : "ещё не пройдено"}`,
    "",
    "## Проверки",
    "",
    ...result.checks.map((item) => `- [${item.ok ? "x" : " "}] ${item.label}`),
    "",
    "## Возвраты",
    "",
    ...(result.evidence.reentry_gaps.length > 0
      ? result.evidence.reentry_gaps.map((entry) => `- ${entry.ts}: пауза ${entry.gap_days ?? "не вычислена"} дн.`)
      : ["- Нет зафиксированных запусков через поверхность возвращения."]),
    "",
  ];
  if (!result.ok) {
    lines.push(
      "## Следующее доказательство",
      "",
      "Выполни первый незакрытый пункт в интерфейсе, затем повтори gate. Для возврата открывай память дела и нажимай «Начать отсюда»; Context Pack скопируй для Work Item и Track в обоих форматах.",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function ensureSchema(dbPath) {
  const rows = await query(dbPath, `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'work_memory_entries', 'work_memory_entry_revisions', 'work_item_stages',
      'work_item_stage_events', 'focus_session_work_snapshots', 'work_item_aliases',
      'focus_sessions', 'app_events', 'work_items', 'work_item_tracks'
    );
  `);
  const names = new Set(rows.map((row) => row.name));
  const required = [
    "work_memory_entries", "work_memory_entry_revisions", "work_item_stages",
    "work_item_stage_events", "focus_session_work_snapshots", "work_item_aliases",
    "focus_sessions", "app_events", "work_items", "work_item_tracks",
  ];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`База ещё не обновлена для Working Memory Bridge: нет ${missing.join(", ")}. Запусти свежую сборку Timeskein.`);
  }
}

async function query(dbPath, statement) {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-readonly", "-cmd", ".timeout 5000", "-json", dbPath, statement],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function groupBy(values, keyOf) {
  const result = new Map();
  for (const value of values) {
    const key = keyOf(value);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function parsePayload(value) {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function matchesContextPackScope(payload, canonicalId, requestedId, trackId) {
  if (payload.profile === "work-item-reentry") {
    return payload.scope_id === canonicalId || payload.scope_id === requestedId;
  }
  return payload.profile === "track-reentry" && Boolean(trackId) && payload.scope_id === trackId;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseArgs(args) {
  const result = { format: "md", softFail: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--work-item") result.workItem = readArg(args, ++index, arg);
    else if (arg === "--track") result.track = readArg(args, ++index, arg);
    else if (arg === "--from") result.from = readArg(args, ++index, arg);
    else if (arg === "--to") result.to = readArg(args, ++index, arg);
    else if (arg === "--db") result.db = readArg(args, ++index, arg);
    else if (arg === "--format") result.format = readArg(args, ++index, arg);
    else if (arg === "--soft-fail") result.softFail = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Использование:
  pnpm working-memory:gate -- --work-item UUID --from YYYY-MM-DD --to YYYY-MM-DD [параметры]

Проверяет реальную приёмку Working Memory Bridge v1. Верхняя граница периода не включается.

Параметры:
  --track UUID       Ожидаемый Track; без параметра берётся текущий Track дела
  --db PATH          SQLite-база, по умолчанию основная база Timeskein
  --format md|json   Формат результата, по умолчанию md
  --soft-fail        Показать незакрытые проверки, но вернуть код 0
`);
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!result.workItem || !isUuid(result.workItem)) throw new Error("Нужен --work-item с UUID.");
  if (result.track && !isUuid(result.track)) throw new Error("--track должен быть UUID.");
  if (!result.from || !result.to) throw new Error("Нужны --from и --to; верхняя граница не включается.");
  for (const [name, value] of [["--from", result.from], ["--to", result.to]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} должен иметь формат YYYY-MM-DD.`);
  }
  if (result.from >= result.to) throw new Error("--to должен быть позже --from.");
  if (!new Set(["md", "json"]).has(result.format)) throw new Error("Допустимы --format md и json.");
  return result;
}

function readArg(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`После ${option} ожидается значение.`);
  return value;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
