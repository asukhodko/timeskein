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
  const fromTs = localMidnightIso(options.from);
  const toTs = localMidnightIso(options.to);

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
    SELECT wmer.entry_id,
           SUM(CASE WHEN wmer.change_kind = 'edit' THEN 1 ELSE 0 END) AS edits,
           SUM(CASE WHEN wmer.change_kind = 'delete' THEN 1 ELSE 0 END) AS deletions
    FROM work_memory_entry_revisions wmer
    JOIN work_memory_entries wme ON wme.id = wmer.entry_id
    WHERE wme.work_item_id = ${sql(canonicalId)}
      AND datetime(wmer.created_at) >= datetime(${sql(fromTs)})
      AND datetime(wmer.created_at) < datetime(${sql(toTs)})
    GROUP BY wmer.entry_id;
  `);
  const activeMemory = memory.filter((entry) => !entry.deleted_at);
  const stageTransitions = stageEvents.filter((event) =>
    new Set(["activated", "completed", "reopened"]).has(event.kind)
  );
  const semanticKinds = new Set(["thought", "question", "decision", "observation"]);
  const semanticEntries = activeMemory.filter((entry) => semanticKinds.has(entry.entry_kind));
  const materials = activeMemory.filter((entry) => entry.entry_kind === "material" && entry.material_kind && entry.material_value);
  const causalFocusIds = focusIdsWithCausalChain(activeMemory);
  const causalChains = causalFocusIds.size;
  const focusStageIds = new Set(sessions.map((session) => session.stage_id).filter(Boolean));
  const focusWithOutcome = sessions.filter((session) => session.daily_outcome && session.day_contract_revision_id);
  const eventsByKind = groupBy(appEvents, (event) => event.kind);
  const d0Evaluation = evaluateD0Baseline({
    sessions,
    memory: activeMemory,
    materials,
    causalFocusIds,
    trackId,
  });
  const d0Baseline = d0Evaluation.baseline;
  const reentryEvents = (eventsByKind.get("reentry_started") ?? [])
    .filter((event) => d0Baseline && Date.parse(event.ts) > Date.parse(d0Baseline.stopped_at));
  const successfulFocusStarts = [
    ...(eventsByKind.get("focus_started") ?? []),
    ...(eventsByKind.get("focus_switched") ?? []),
  ].filter((event) => {
    if (event.source !== "agent") return false;
    const payload = parsePayload(event.payload);
    return payload?.already_active === false && typeof payload.action_id === "string";
  });
  const reentryGaps = d0Baseline
    ? verifiedReentries(reentryEvents, sessions, causalFocusIds, successfulFocusStarts)
    : [];
  const pauseEvidence = matchPauseSequence(reentryGaps, [1, 3, 7]);
  const projectionEvidenceFloor = pauseEvidence.at(-1)?.ts ?? d0Baseline?.stopped_at;
  const packBuildEvidence = (eventsByKind.get("context_pack_built") ?? [])
    .filter((event) => eventAtOrAfter(event, projectionEvidenceFloor))
    .map((event) => parsePayload(event.payload))
    .filter((payload) => payload && matchesContextPackScope(payload, canonicalId, options.workItem, trackId));
  const packProfiles = new Set(packBuildEvidence.map((payload) => payload.profile));
  const exportEvidence = (eventsByKind.get("context_pack_exported") ?? [])
    .filter((event) => eventAtOrAfter(event, projectionEvidenceFloor))
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
  const requestedPeriodDays = Math.round((Date.parse(`${options.to}T00:00:00Z`) - Date.parse(`${options.from}T00:00:00Z`)) / 86_400_000);
  const observedPeriodDays = observedExperimentDays(d0Baseline, pauseEvidence);
  const stageSnapshotTitles = new Set(sessions.map((session) => session.stage_title).filter(Boolean));
  const hasEditedHistory = revisionRows.some((row) => Number(row.edits) > 0);
  const experiment = experimentStatus(d0Baseline, pauseEvidence, observedPeriodDays);

  const checks = [
    check(d0Evaluation.preparation.memory, `запись памяти до старта D0: ${d0Evaluation.preparation.memory ? "есть" : "нет"}`),
    check(d0Evaluation.preparation.material, `материал до старта D0: ${d0Evaluation.preparation.material ? "есть" : "нет"}`),
    check(Boolean(d0Baseline), `базовый день D0: ${d0Baseline ? formatTimestamp(d0Baseline.stopped_at) : "ещё не зафиксирован"}`),
    check(observedPeriodDays >= 7, `наблюдаемый период после D0: ${observedPeriodDays}/7 дней`),
    check(activeMemory.length >= 6, `актуальных записей рабочей памяти: ${activeMemory.length}/6`),
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
    period: {
      from: options.from,
      to: options.to,
      upper_bound_inclusive: false,
      requested_days: requestedPeriodDays,
      observed_days_after_d0: observedPeriodDays,
    },
    experiment,
    evidence: {
      memory_entries: activeMemory.length,
      historical_memory_entries: memory.length,
      current_deleted_entries: memory.length - activeMemory.length,
      edited_entries: revisionRows.filter((row) => Number(row.edits) > 0).length,
      deleted_entries: revisionRows.filter((row) => Number(row.deletions) > 0).length,
      materials: materials.length,
      d0_setup_memory_before_focus: d0Evaluation.preparation.memory,
      d0_setup_material_before_focus: d0Evaluation.preparation.material,
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

function focusIdsWithCausalChain(memory) {
  const byFocus = groupBy(memory.filter((entry) => entry.focus_session_id), (entry) => entry.focus_session_id);
  const result = new Set();
  for (const entries of byFocus.values()) {
    const kinds = new Set(entries.map((entry) => entry.entry_kind));
    if (kinds.has("result") && kinds.has("state_change") && kinds.has("next_action")) {
      result.add(entries[0].focus_session_id);
    }
  }
  return result;
}

function evaluateD0Baseline({ sessions, memory, materials, causalFocusIds, trackId }) {
  const result = {
    baseline: undefined,
    preparation: { memory: false, material: false },
  };
  if (!trackId) return result;
  for (const session of sessions) {
    if (!session.stopped_at || !session.stage_id || !session.stage_title) continue;
    if (!session.daily_outcome || !session.day_contract_revision_id) continue;
    if (!causalFocusIds.has(session.id)) continue;
    const startedAt = Date.parse(session.started_at);
    const sessionDate = localDateKey(session.started_at);
    if (!Number.isFinite(startedAt) || !sessionDate) continue;
    const recordedBeforeFocus = (entry) => {
      const recordedAt = Date.parse(entry.recorded_at);
      return Number.isFinite(recordedAt) &&
        recordedAt <= startedAt &&
        localDateKey(entry.recorded_at) === sessionDate;
    };
    const preparation = {
      memory: memory.some((entry) => entry.entry_kind !== "material" && recordedBeforeFocus(entry)),
      material: materials.some(recordedBeforeFocus),
    };
    result.preparation.memory ||= preparation.memory;
    result.preparation.material ||= preparation.material;
    if (preparation.memory && preparation.material) {
      result.baseline = session;
      return result;
    }
  }
  return result;
}

function verifiedReentries(events, sessions, causalFocusIds, successfulFocusStarts) {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return events.flatMap((event) => {
    const payload = parsePayload(event.payload);
    if (payload?.has_next_action !== true) return [];
    if (typeof payload.action_id !== "string" || payload.action_id.length === 0) return [];
    if (!event.focus_session_id || !causalFocusIds.has(event.focus_session_id)) return [];
    const confirmedStart = successfulFocusStarts.find((candidate) => {
      if (candidate.focus_session_id !== event.focus_session_id) return false;
      return parsePayload(candidate.payload)?.action_id === payload.action_id;
    });
    if (!confirmedStart) return [];
    const eventTime = Date.parse(event.ts);
    if (!Number.isFinite(eventTime)) return [];
    const session = sessionsById.get(event.focus_session_id);
    if (!session) return [];
    const startedAt = Date.parse(session.started_at);
    const delta = eventTime - startedAt;
    if (!Number.isFinite(startedAt) || delta < 0 || delta > 300_000) return [];
    return [{
      event_id: event.id,
      ts: event.ts,
      focus_session_id: session.id,
      focus_started_before_event_seconds: Math.round(delta / 1000),
      gap_days: gapFromPreviousFocus(event.ts, sessions),
    }];
  });
}

function eventAtOrAfter(event, floorTimestamp) {
  if (!floorTimestamp) return true;
  const eventTime = Date.parse(event.ts);
  const floorTime = Date.parse(floorTimestamp);
  return Number.isFinite(eventTime) && Number.isFinite(floorTime) && eventTime >= floorTime;
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

function matchPauseSequence(gaps, thresholds) {
  const candidates = gaps
    .filter((entry) => entry.gap_days != null)
    .sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  const matches = [];
  let cursor = 0;
  for (const threshold of thresholds) {
    const index = candidates.findIndex((entry, candidateIndex) =>
      candidateIndex >= cursor && entry.gap_days >= threshold
    );
    if (index < 0) break;
    matches.push({ threshold_days: threshold, ...candidates[index] });
    cursor = index + 1;
  }
  return matches;
}

function observedExperimentDays(d0Baseline, pauseEvidence) {
  if (!d0Baseline) return 0;
  const lastTimestamp = pauseEvidence.at(-1)?.ts ?? d0Baseline.stopped_at;
  return Math.max(0, Math.floor(
    (Date.parse(lastTimestamp) - Date.parse(d0Baseline.stopped_at)) / 86_400_000,
  ));
}

function experimentStatus(d0Baseline, pauseEvidence, observedPeriodDays) {
  if (!d0Baseline) {
    return {
      phase: "pre_d0",
      label: "подготовка D0",
      d0_focus_session_id: null,
      d0_stopped_at: null,
      completed_returns: 0,
      next_pause_days: null,
      observed_days: 0,
    };
  }
  const labels = ["D0", "D1", "D4", "D11"];
  const index = Math.min(pauseEvidence.length, labels.length - 1);
  return {
    phase: labels[index].toLowerCase(),
    label: labels[index],
    d0_focus_session_id: d0Baseline.id,
    d0_stopped_at: d0Baseline.stopped_at,
    completed_returns: pauseEvidence.length,
    next_pause_days: [1, 3, 7][pauseEvidence.length] ?? null,
    observed_days: observedPeriodDays,
  };
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
    `Период запроса: ${result.period.from} включительно — ${result.period.to} исключительно`,
    `Стадия эксперимента: ${result.experiment.label}`,
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
      nextEvidence(result),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function nextEvidence(result) {
  if (result.experiment.phase === "pre_d0") {
    const missing = [];
    if (!result.track_id) missing.push("назначить Track");
    if (!result.evidence.d0_setup_memory_before_focus) missing.push("добавить запись памяти до старта фокуса");
    if (!result.evidence.d0_setup_material_before_focus) missing.push("добавить материал до старта фокуса");
    if (result.evidence.stages < 1) missing.push("создать и активировать этап");
    if (result.evidence.focus_outcome_snapshots < 1) missing.push("задать дневной результат");
    if (result.evidence.causal_chains < 1) {
      missing.push("остановить реальный фокус-блок с полями «сделал → изменилось → следующий шаг»");
    }
    const setup = missing.length > 0 ? ` Не хватает: ${missing.join("; ")}.` : "";
    return `Сначала зафиксируй D0 для этого дела.${setup} До этого календарные дни и возвраты не засчитываются.`;
  }
  if (result.experiment.next_pause_days != null) {
    return `Следующий контроль: не открывай это дело в фокусе не менее ${result.experiment.next_pause_days} дн., затем открой «Память», нажми «Начать отсюда» и заверши блок новой причинной цепочкой.`;
  }
  return "Возвраты D1/D4/D11 подтверждены. Закрой оставшиеся пункты структуры и экспорта, затем повтори строгий gate.";
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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

function localMidnightIso(localDate) {
  const value = new Date(`${localDate}T00:00:00`);
  if (Number.isNaN(value.getTime())) throw new Error(`Некорректная календарная дата: ${localDate}`);
  return value.toISOString();
}

function localDateKey(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return undefined;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
Календарный прогресс начинается только с полного базового блока D0; ширина диапазона сама по себе не засчитывается.

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
