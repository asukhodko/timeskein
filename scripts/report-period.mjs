#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { findFocusSessionOverlaps } from "./lib/focus-overlaps.mjs";

import {
  DECISION_TYPES,
  getPeriodReportProfile,
  supportedProfileIds,
} from "./lib/period-report-profiles.mjs";

const execFileAsync = promisify(execFile);
const SIGNIFICANT_GAP_SECONDS = 20 * 60;
const KNOWN_ACTIVITY_ZONES = new Set(["work", "coordination", "recovery", "idle", "personal"]);
const DEFAULT_PROFILE = "weekly-review";

try {
  const options = parseArgs(process.argv.slice(2));
  const now = options.now ? parseIsoDate(options.now, "--now") : new Date();
  const from = parseLocalDate(options.from, "--from");
  const to = parseLocalDate(options.to, "--to");
  if (from.getTime() >= to.getTime()) {
    throw new Error("Значение --to должно быть позже --from. Верхняя граница периода не включается.");
  }

  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
  if (!existsSync(dbPath)) {
    throw new Error(`База Timeskein не найдена: ${dbPath}`);
  }

  const report = await buildPeriodReport({
    dbPath,
    from,
    to,
    fromInput: options.from,
    toInput: options.to,
    now,
    profile: options.profile,
    filterOptions: options,
  });
  const rendered = options.format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderPeriodMarkdown(report);

  if (options.reflectionTemplate) {
    const templatePath = resolve(options.reflectionTemplate);
    await mkdir(dirname(templatePath), { recursive: true });
    await writeFile(templatePath, `${JSON.stringify(buildReflectionTemplate(report), null, 2)}\n`, "utf8");
  }

  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, "utf8");
    process.stdout.write(`${outputPath}\n`);
  } else {
    process.stdout.write(rendered);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const result = {
    format: "md",
    profile: DEFAULT_PROFILE,
    labels: [],
    zones: [],
    includeChildTracks: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }

    if (arg === "--from") {
      result.from = readArgValue(args, ++index, arg);
    } else if (arg === "--to") {
      result.to = readArgValue(args, ++index, arg);
    } else if (arg === "--format") {
      result.format = readArgValue(args, ++index, arg);
    } else if (arg === "--profile") {
      result.profile = readArgValue(args, ++index, arg);
    } else if (arg === "--track") {
      result.track = readArgValue(args, ++index, arg);
    } else if (arg === "--include-child-tracks") {
      result.includeChildTracks = true;
    } else if (arg === "--label") {
      result.labels.push(readArgValue(args, ++index, arg));
    } else if (arg === "--zone") {
      result.zones.push(readArgValue(args, ++index, arg));
    } else if (arg === "--db") {
      result.db = readArgValue(args, ++index, arg);
    } else if (arg === "--now") {
      result.now = readArgValue(args, ++index, arg);
    } else if (arg === "--output") {
      result.output = readArgValue(args, ++index, arg);
    } else if (arg === "--reflection-template") {
      result.reflectionTemplate = readArgValue(args, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (!result.from || !result.to) {
    throw new Error("Нужны обе границы периода: --from YYYY-MM-DD и --to YYYY-MM-DD.");
  }
  if (!new Set(["md", "json"]).has(result.format)) {
    throw new Error(`Некорректный --format: ${result.format}. Допустимы md и json.`);
  }
  if (!getPeriodReportProfile(result.profile)) {
    throw new Error(`Неизвестный профиль ${result.profile}. Допустимы: ${supportedProfileIds().join(", ")}.`);
  }
  for (const zone of result.zones) {
    if (!KNOWN_ACTIVITY_ZONES.has(zone)) {
      throw new Error(`Некорректная зона ${zone}. Допустимы: ${Array.from(KNOWN_ACTIVITY_ZONES).join(", ")}.`);
    }
  }
  if (result.profile === "track-retrospective" && !result.track) {
    throw new Error("Профиль track-retrospective требует --track ID_OR_TITLE.");
  }

  return result;
}

function readArgValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`После ${option} ожидается значение.`);
  }
  return value;
}

function printHelp() {
  console.log(`Использование:
  pnpm report:period -- --from YYYY-MM-DD --to YYYY-MM-DD [параметры]

Границы периода полуоткрытые: --from включается, --to не включается.
Чтобы включить 9 июля, укажи --to 2026-07-10.

Параметры:
  --format md|json          Формат вывода, по умолчанию md
  --profile PROFILE        Профиль: ${supportedProfileIds().join(", ")}
  --track ID_OR_TITLE      Ограничить отчёт одним направлением
  --include-child-tracks   Включить дочерние направления выбранного Track
  --label ID_OR_TITLE      Требуемая метка; можно повторить для пересечения
  --zone ZONE              Зона активности; можно повторить
  --output PATH             Сохранить результат в файл
  --reflection-template P  Сохранить JSON-заготовку решений обзора
  --db PATH                 Путь к SQLite-базе Timeskein
  --now ISO_DATE            Зафиксировать текущее время для активного блока и тестов
  --help                    Показать эту справку

База по умолчанию:
  ~/Library/Application Support/Timeskein/timeskein.db`);
}

async function buildPeriodReport({ dbPath, from, to, fromInput, toInput, now, profile, filterOptions }) {
  const schema = await inspectSchema(dbPath);
  const taxonomy = await loadTaxonomy(dbPath, schema);
  const filters = resolveReportFilters(filterOptions, taxonomy);
  const [sessions, rawDayEvents, rawWorkItemEvents, rawCaptures, reflectionContext] = await Promise.all([
    loadSessions(dbPath, from, to, now, schema, taxonomy),
    loadDayEvents(dbPath, from, to, schema),
    loadWorkItemEvents(dbPath, from, to, schema, taxonomy),
    loadCaptures(dbPath, from, to, schema),
    loadReflectionContext(dbPath, fromInput, toInput, profile, filters.public, schema),
  ]);

  const fullTimeline = sessions
    .map((session) => clipSession(session, from, to, now))
    .filter(Boolean);
  const timeline = fullTimeline.filter((session) => matchesReportFilters(session, filters));
  const sessionById = new Map(fullTimeline.map((session) => [session.id, session]));
  const allDayEvents = rawDayEvents
    .map((event) => enrichLinkedRecord(event, sessionById, taxonomy));
  const dayEvents = allDayEvents.filter((event) => matchesReportFilters(event, filters));
  const workItemEvents = rawWorkItemEvents
    .map((event) => enrichLinkedRecord(event, sessionById, taxonomy))
    .filter((event) => matchesReportFilters(event, filters));
  const captures = rawCaptures
    .map((capture) => enrichCaptureRecord(capture, sessionById, taxonomy))
    .filter((capture) => matchesReportFilters(capture, filters));
  const includedWorkItemIds = new Set([
    ...timeline.map((session) => session.work_item_id),
    ...workItemEvents.map((event) => event.work_item_id),
    ...captures.map((capture) => capture.work_item_id),
  ].filter(Boolean));
  const refs = await loadRefs(dbPath, schema, includedWorkItemIds);
  const classification = buildClassificationCoverage(fullTimeline, timeline, filters);
  const days = aggregateDays(timeline, dayEvents, workItemEvents, captures, from, to);
  const byActivityZone = aggregateByActivityZone(timeline);
  const byWorkItem = aggregateByWorkItem(timeline, workItemEvents);
  const gaps = buildSignificantGaps(timeline, allDayEvents, from, to);
  const warnings = buildWarnings({
    timeline,
    days,
    byActivityZone,
    byWorkItem,
    gaps,
    captures,
    dayEvents,
    workItemEvents,
    schema,
  });
  if (classification.inferred_current_included_entrances > 0) {
    warnings.push({
      code: "legacy_semantic_inference",
      severity: "review",
      message: `${classification.inferred_current_included_entrances} входов выбранного среза восстановлены по текущему Work Item, потому что исторического снимка ещё не было.`,
    });
  }
  if (filters.active && classification.unclassified_source_entrances > 0) {
    warnings.push({
      code: "unclassified_semantic_data",
      severity: "review",
      message: `${classification.unclassified_source_entrances} входов исходного периода не имеют Track; в выбранный срез вошло ${classification.unclassified_included_entrances}. Покрытие показывает их явно.`,
    });
  }
  const observations = buildObservations({ timeline, byActivityZone, byWorkItem, gaps, captures });
  const focusTuning = buildFocusTuning({ byWorkItem, gaps, captures, observations });
  const profileDefinition = getPeriodReportProfile(profile);
  focusTuning.questions = profileDefinition.questions;
  const profileAnalysis = buildProfileAnalysis({
    profile,
    byWorkItem,
    workItemEvents,
    dayEvents,
    focusTuning,
    filters,
    captures,
    refs,
  });
  const evidenceStory = profile === "track-retrospective"
    ? buildEvidenceStory({ workItemEvents, profileAnalysis, reflectionContext })
    : null;
  if (evidenceStory && evidenceStory.changes.length === 0) {
    warnings.push({
      code: "no_result_evidence",
      severity: "review",
      message: "В Track-срезе нет типизированных записей «Результат». Время показывает усилие, но не доказывает изменение состояния.",
    });
  }
  const resultsWithoutRefs = evidenceStory?.changes.filter((entry) => !entry.confirmed) ?? [];
  if (resultsWithoutRefs.length > 0) {
    warnings.push({
      code: "results_without_evidence_refs",
      severity: "review",
      message: `${resultsWithoutRefs.length} результатов записаны без подтверждающего Ref и остаются утверждениями пользователя, а не подтверждёнными артефактами фактами.`,
      evidence: resultsWithoutRefs.map((entry) => ({ id: entry.id, text: entry.text })),
    });
  }
  const trackedSeconds = timeline.reduce((sum, item) => sum + item.active_seconds, 0);
  const executiveWorkSeconds = zoneSeconds(byActivityZone, "work");
  const workingOccupancySeconds = executiveWorkSeconds + zoneSeconds(byActivityZone, "coordination");
  const nonWorkSeconds = Math.max(trackedSeconds - workingOccupancySeconds, 0);
  const contextualWorkItemEvents = workItemEvents.filter((event) => event.kind === "note_added" && event.text);

  const summary = {
    calendar_days: days.length,
    days_with_activity: days.filter((day) => day.entrances > 0).length,
    tracked_seconds: trackedSeconds,
    working_occupancy_seconds: workingOccupancySeconds,
    executive_work_seconds: executiveWorkSeconds,
    non_work_seconds: nonWorkSeconds,
    entrances: timeline.length,
    day_events: dayEvents.length,
    work_item_events: workItemEvents.length,
    contextual_work_item_events: contextualWorkItemEvents.length,
    captures: captures.length,
    refs: refs.length,
    evidence_entries: evidenceStory?.entries.length ?? 0,
    confirmed_results: evidenceStory?.changes.filter((entry) => entry.confirmed).length ?? 0,
    significant_gaps: gaps.length,
    unexplained_gaps: gaps.filter((gap) => !gap.explained).length,
    warning_count: warnings.filter((warning) => warning.severity === "warning").length,
    review_count: warnings.filter((warning) => warning.severity === "review").length,
    classification,
  };
  const totals = {
    by_day: days,
    by_activity_zone: byActivityZone,
    by_work_item: byWorkItem,
  };

  return {
    schema_version: 3,
    generated_at: now.toISOString(),
    request: {
      from: fromInput,
      to: toInput,
      range_semantics: "from_inclusive_to_exclusive",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      profile,
      classification_mode: schema.tables.focus_session_semantic_snapshots
        ? "semantic_snapshot_with_explicit_legacy_fallback"
        : "legacy_current_work_item_inference",
      filters: filters.public,
    },
    profile: {
      ...profileDefinition,
      decision_types: DECISION_TYPES,
    },
    profile_analysis: profileAnalysis,
    evidence_story: evidenceStory,
    facts: {
      summary,
      totals,
      classification,
    },
    summary,
    totals,
    classification,
    timeline,
    events: {
      day: dayEvents,
      work_item: workItemEvents,
    },
    captures,
    refs,
    gaps,
    warnings,
    observations,
    focus_tuning: focusTuning,
    decisions: {
      supported_types: DECISION_TYPES,
      selected_period: reflectionContext.selected_period,
      previous_period: reflectionContext.previous_period,
    },
    provenance: {
      source: "local_sqlite",
      read_only: true,
      source_tables: ["focus_sessions", "work_items", "day_events", "work_item_events", "captures", "refs", "work_item_refs", "reflection_sessions", "reflection_decisions", "tracks", "labels", "focus_session_semantic_snapshots", "work_item_event_semantic_snapshots", "reflection_decision_tracks", "evidence_entries", "evidence_ref_snapshots", "reflection_decision_followups"],
      title_classification_note:
        "Work Item titles and notes use their current values because historical title snapshots are not stored yet.",
      generated_by: "scripts/report-period.mjs",
    },
  };
}

async function inspectSchema(path) {
  const tables = {};
  for (const table of [
    "focus_sessions",
    "work_items",
    "day_events",
    "work_item_events",
    "captures",
    "reflection_sessions",
    "reflection_decisions",
    "tracks",
    "labels",
    "work_item_tracks",
    "work_item_labels",
    "focus_session_semantic_snapshots",
    "work_item_event_semantic_snapshots",
    "reflection_decision_tracks",
    "evidence_entries",
    "evidence_ref_snapshots",
    "reflection_decision_followups",
    "refs",
    "work_item_refs",
  ]) {
    tables[table] = await tableExists(path, table);
  }
  if (!tables.focus_sessions || !tables.work_items) {
    throw new Error("В базе нет обязательных таблиц focus_sessions и work_items.");
  }

  return {
    tables,
    hasActivityZone: await columnExists(path, "focus_sessions", "activity_zone"),
    dayEventsHasFocusSession: tables.day_events && await columnExists(path, "day_events", "focus_session_id"),
    dayEventsHasActivityZone: tables.day_events && await columnExists(path, "day_events", "activity_zone"),
    capturesHasFocusSession: tables.captures && await columnExists(path, "captures", "focus_session_id"),
    capturesHasWorkItem: tables.captures && await columnExists(path, "captures", "work_item_id"),
  };
}

async function loadTaxonomy(path, schema) {
  if (!schema.tables.tracks || !schema.tables.labels) {
    return {
      tracks: [],
      labels: [],
      tracksById: new Map(),
      labelsById: new Map(),
      workItems: new Map(),
    };
  }

  const [trackRows, labelRows, workItemTrackRows, workItemLabelRows] = await Promise.all([
    sqliteJson(path, "SELECT id, title, parent_track_id, archived_at FROM tracks ORDER BY normalized_title;"),
    sqliteJson(path, "SELECT id, title, archived_at FROM labels ORDER BY normalized_title;"),
    schema.tables.work_item_tracks
      ? sqliteJson(path, "SELECT work_item_id, track_id FROM work_item_tracks;")
      : [],
    schema.tables.work_item_labels
      ? sqliteJson(path, "SELECT work_item_id, label_id FROM work_item_labels ORDER BY work_item_id, label_id;")
      : [],
  ]);
  const tracksById = new Map(trackRows.map((row) => [row.id, {
    id: row.id,
    title: row.title,
    parent_track_id: row.parent_track_id ?? null,
    archived: Boolean(row.archived_at),
  }]));
  const buildPath = (track, seen = new Set()) => {
    if (!track || seen.has(track.id)) return [];
    seen.add(track.id);
    const parent = track.parent_track_id ? tracksById.get(track.parent_track_id) : null;
    return [...buildPath(parent, seen), { id: track.id, title: track.title }];
  };
  const tracks = Array.from(tracksById.values()).map((track) => ({
    ...track,
    path: buildPath(track),
  }));
  for (const track of tracks) tracksById.set(track.id, track);
  const labels = labelRows.map((row) => ({
    id: row.id,
    title: row.title,
    archived: Boolean(row.archived_at),
  }));
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  const workItems = new Map();
  for (const row of workItemTrackRows) {
    workItems.set(row.work_item_id, {
      track: tracksById.get(row.track_id) ?? null,
      labels: [],
    });
  }
  for (const row of workItemLabelRows) {
    const semantics = workItems.get(row.work_item_id) ?? { track: null, labels: [] };
    const label = labelsById.get(row.label_id);
    if (label) semantics.labels.push(label);
    workItems.set(row.work_item_id, semantics);
  }

  return { tracks, labels, tracksById, labelsById, workItems };
}

function resolveReportFilters(options, taxonomy) {
  const resolveEntity = (raw, entities, kind) => {
    const normalized = normalizeSemanticFilter(raw);
    const match = entities.find((entity) =>
      entity.id === raw
      || normalizeSemanticFilter(entity.title) === normalized
      || normalizeSemanticFilter(entity.path?.map((node) => node.title).join(" / ") ?? "") === normalized
    );
    if (!match) throw new Error(`${kind} не найден: ${raw}`);
    return match;
  };

  const selectedTrack = options.track
    ? resolveEntity(options.track, taxonomy.tracks, "Track")
    : null;
  const selectedLabels = options.labels.map((label) => resolveEntity(label, taxonomy.labels, "Label"));
  const allowedTrackIds = new Set();
  if (selectedTrack) {
    allowedTrackIds.add(selectedTrack.id);
    if (options.includeChildTracks) {
      for (const track of taxonomy.tracks) {
        if (track.path.some((node) => node.id === selectedTrack.id)) allowedTrackIds.add(track.id);
      }
    }
  }
  const labelIds = new Set(selectedLabels.map((label) => label.id));
  const zones = new Set(options.zones);
  const structuredFilters = {
    track: selectedTrack ? {
      id: selectedTrack.id,
      title: selectedTrack.title,
      path: selectedTrack.path,
      include_children: options.includeChildTracks,
      resolved_track_ids: Array.from(allowedTrackIds).sort(),
    } : null,
    labels: selectedLabels.map((label) => ({ id: label.id, title: label.title })),
    activity_zones: Array.from(zones),
  };
  const active = Boolean(selectedTrack || selectedLabels.length > 0 || zones.size > 0);
  return {
    active,
    selectedTrack,
    selectedLabels,
    allowedTrackIds,
    labelIds,
    zones,
    public: active ? structuredFilters : {},
  };
}

function normalizeSemanticFilter(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function loadReflectionContext(path, from, to, profile, filters, schema) {
  if (!schema.tables.reflection_sessions || !schema.tables.reflection_decisions) {
    return { selected_period: [], previous_period: null };
  }
  const selectedCandidates = await sqliteJson(path, `
    SELECT * FROM reflection_sessions
     WHERE period_from = ${sqlString(from)} AND period_to = ${sqlString(to)} AND profile = ${sqlString(profile)}
     ORDER BY created_at DESC;
  `);
  const previousCandidates = await sqliteJson(path, `
    SELECT * FROM reflection_sessions
     WHERE profile = ${sqlString(profile)} AND period_to <= ${sqlString(from)}
     ORDER BY period_to DESC, created_at DESC;
  `);
  const selectedRows = selectedCandidates.filter((row) => equalReportFilters(parseJsonPayload(row.filters_json) ?? {}, filters));
  const previousMatch = previousCandidates.find((row) => equalReportFilters(parseJsonPayload(row.filters_json) ?? {}, filters));
  const previousRows = previousMatch ? [previousMatch] : [];
  const rows = [...selectedRows, ...previousRows.filter((row) => !selectedRows.some((selected) => selected.id === row.id))];
  const decisionTrackSelect = schema.tables.reflection_decision_tracks
    ? ", rdt.track_id, rdt.track_path_json"
    : ", NULL AS track_id, '[]' AS track_path_json";
  const decisionTrackJoin = schema.tables.reflection_decision_tracks
    ? "LEFT JOIN reflection_decision_tracks rdt ON rdt.reflection_decision_id = d.id"
    : "";
  const decisions = rows.length === 0 ? [] : await sqliteJson(path, `
    SELECT d.id, d.reflection_session_id, d.work_item_id, d.subject, d.decision, d.note, d.created_at
           ${decisionTrackSelect}
      FROM reflection_decisions d
      ${decisionTrackJoin}
     WHERE d.reflection_session_id IN (${rows.map((row) => sqlString(row.id)).join(", ")})
     ORDER BY d.created_at, d.id;
  `);
  const followups = rows.length === 0 || !schema.tables.reflection_decision_followups ? [] : await sqliteJson(path, `
    SELECT f.id, f.reflection_session_id, f.prior_decision_id, f.status, f.note,
           f.evidence_event_id, f.created_at, d.subject
      FROM reflection_decision_followups f
      JOIN reflection_decisions d ON d.id = f.prior_decision_id
     WHERE f.reflection_session_id IN (${rows.map((row) => sqlString(row.id)).join(", ")})
     ORDER BY f.created_at, f.id;
  `);
  const sessions = rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    period: { from: row.period_from, to: row.period_to },
    profile: row.profile,
    filters: parseJsonPayload(row.filters_json) ?? {},
    report_hash: row.report_hash,
    summary: row.summary,
    findings: parseJsonPayload(row.findings_json) ?? [],
    decisions: decisions
      .filter((decision) => decision.reflection_session_id === row.id)
      .map((decision) => ({
        ...decision,
        track_path: parseJsonPayload(decision.track_path_json) ?? [],
      })),
    decision_followups: followups.filter((followup) => followup.reflection_session_id === row.id),
  }));
  return {
    selected_period: sessions.filter((session) => session.period.from === from && session.period.to === to),
    previous_period: sessions.find((session) => session.period.to <= from) ?? null,
  };
}

function equalReportFilters(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]));
}

async function loadSessions(path, from, to, now, schema, taxonomy) {
  const activityZoneExpression = schema.hasActivityZone ? "fs.activity_zone" : "'work'";
  const semanticSelect = schema.tables.focus_session_semantic_snapshots
    ? ", fss.track_id AS snapshot_track_id, fss.track_path_json, fss.labels_json, fss.captured_at AS semantic_captured_at"
    : ", NULL AS snapshot_track_id, NULL AS track_path_json, NULL AS labels_json, NULL AS semantic_captured_at";
  const semanticJoin = schema.tables.focus_session_semantic_snapshots
    ? "LEFT JOIN focus_session_semantic_snapshots fss ON fss.focus_session_id = fs.id"
    : "";
  const query = `
    SELECT
      fs.id,
      fs.title,
      fs.work_item_id,
      wi.title AS work_item_title,
      wi.note AS work_item_note,
      wi.state AS work_item_state,
      ${activityZoneExpression} AS activity_zone,
      fs.state,
      fs.note,
      fs.started_at,
      fs.stopped_at,
      fs.updated_at
      ${semanticSelect}
    FROM focus_sessions fs
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    ${semanticJoin}
    WHERE datetime(COALESCE(fs.stopped_at, ${sqlString(now.toISOString())})) > datetime(${sqlString(from.toISOString())})
      AND datetime(fs.started_at) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(fs.started_at) ASC
  `;
  const rows = await sqliteJson(path, query);

  return rows.map((row) => {
    const hasSnapshot = row.semantic_captured_at != null;
    return {
      id: row.id,
      title: row.title,
      work_item_id: row.work_item_id ?? null,
      work_item_title: row.work_item_title ?? null,
      work_item_note: row.work_item_note ?? null,
      work_item_state: row.work_item_state ?? null,
      activity_zone: row.activity_zone ?? "work",
      state: row.state,
      note: row.note ?? null,
      started_at: row.started_at,
      stopped_at: row.stopped_at ?? null,
      updated_at: row.updated_at,
      semantic: hasSnapshot
        ? semanticFromSnapshotRow(row)
        : semanticFromCurrentWorkItem(row.work_item_id, taxonomy, "inferred-current"),
    };
  });
}

async function loadDayEvents(path, from, to, schema) {
  if (!schema.tables.day_events) return [];

  const focusSessionExpression = schema.dayEventsHasFocusSession ? "de.focus_session_id" : "NULL";
  const activityZoneExpression = schema.dayEventsHasActivityZone ? "de.activity_zone" : "NULL";
  const query = `
    SELECT
      de.id,
      de.ts,
      de.kind,
      de.text,
      ${focusSessionExpression} AS focus_session_id,
      ${activityZoneExpression} AS activity_zone,
      fs.work_item_id,
      COALESCE(wi.title, fs.title) AS during_title
    FROM day_events de
    LEFT JOIN focus_sessions fs ON fs.id = ${focusSessionExpression}
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    WHERE datetime(de.ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(de.ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(de.ts) ASC
  `;
  const rows = await sqliteJson(path, query);

  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    day: formatLocalDate(new Date(row.ts)),
    kind: row.kind,
    text: String(row.text ?? "").trim(),
    focus_session_id: row.focus_session_id ?? null,
    work_item_id: row.work_item_id ?? null,
    during_title: row.during_title ?? null,
    activity_zone: row.activity_zone ?? null,
  }));
}

async function loadWorkItemEvents(path, from, to, schema, taxonomy) {
  if (!schema.tables.work_item_events) return [];

  const semanticSelect = schema.tables.work_item_event_semantic_snapshots
    ? ", wiss.track_id AS snapshot_track_id, wiss.track_path_json, wiss.labels_json, wiss.captured_at AS semantic_captured_at"
    : ", NULL AS snapshot_track_id, NULL AS track_path_json, NULL AS labels_json, NULL AS semantic_captured_at";
  const semanticJoin = schema.tables.work_item_event_semantic_snapshots
    ? "LEFT JOIN work_item_event_semantic_snapshots wiss ON wiss.work_item_event_id = e.id"
    : "";
  const evidenceSelect = schema.tables.evidence_entries
    ? ", ee.evidence_kind, ee.focus_session_id AS evidence_focus_session_id, ee.captured_at AS evidence_captured_at"
    : ", NULL AS evidence_kind, NULL AS evidence_focus_session_id, NULL AS evidence_captured_at";
  const evidenceJoin = schema.tables.evidence_entries
    ? "LEFT JOIN evidence_entries ee ON ee.work_item_event_id = e.id"
    : "";
  const query = `
    SELECT
      e.id,
      e.ts,
      e.work_item_id,
      e.kind,
      e.payload,
      wi.title AS work_item_title
      ${semanticSelect}
      ${evidenceSelect}
    FROM work_item_events e
    LEFT JOIN work_items wi ON wi.id = e.work_item_id
    ${semanticJoin}
    ${evidenceJoin}
    WHERE datetime(e.ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(e.ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(e.ts) ASC
  `;
  const rows = await sqliteJson(path, query);
  const evidenceRefRows = schema.tables.evidence_ref_snapshots && rows.length > 0
    ? await sqliteJson(path, `
        SELECT id, work_item_event_id, ref_id, ref_kind, ref_value, captured_at
          FROM evidence_ref_snapshots
         WHERE work_item_event_id IN (${rows.map((row) => sqlString(row.id)).join(", ")})
         ORDER BY datetime(captured_at), id;
      `)
    : [];
  const evidenceRefsByEvent = new Map();
  for (const row of evidenceRefRows) {
    const refs = evidenceRefsByEvent.get(row.work_item_event_id) ?? [];
    refs.push({
      id: row.id,
      ref_id: row.ref_id ?? null,
      kind: row.ref_kind,
      value: row.ref_value,
      captured_at: row.captured_at,
      provenance: "captured",
    });
    evidenceRefsByEvent.set(row.work_item_event_id, refs);
  }

  return rows.map((row) => {
    const payload = parseJsonPayload(row.payload);
    const evidence = row.evidence_captured_at != null
      ? {
          kind: row.evidence_kind,
          focus_session_id: row.evidence_focus_session_id ?? null,
          refs: evidenceRefsByEvent.get(row.id) ?? [],
          captured_at: row.evidence_captured_at,
          provenance: "captured",
        }
      : null;
    return {
      id: row.id,
      ts: row.ts,
      day: formatLocalDate(new Date(row.ts)),
      work_item_id: row.work_item_id,
      work_item_title: row.work_item_title ?? null,
      kind: row.kind,
      text: typeof payload?.text === "string" ? payload.text.trim() : null,
      focus_session_id: evidence?.focus_session_id
        ?? (typeof payload?.focus_session_id === "string" ? payload.focus_session_id : null),
      payload: payload ?? null,
      evidence,
      evidence_provenance: evidence ? "captured" : row.kind === "note_added" ? "legacy_note" : "system_event",
      semantic: row.semantic_captured_at != null
        ? semanticFromSnapshotRow(row)
        : semanticFromCurrentWorkItem(row.work_item_id, taxonomy, "inferred-current"),
    };
  });
}

async function loadCaptures(path, from, to, schema) {
  if (!schema.tables.captures) return [];

  const focusSessionExpression = schema.capturesHasFocusSession ? "c.focus_session_id" : "NULL";
  const workItemExpression = schema.capturesHasWorkItem ? "c.work_item_id" : "NULL";
  const query = `
    SELECT
      c.id,
      c.text,
      c.state,
      ${workItemExpression} AS work_item_id,
      ${focusSessionExpression} AS focus_session_id,
      c.created_at,
      c.updated_at,
      c.resolved_at,
      c.converted_at,
      converted_wi.title AS converted_work_item_title,
      COALESCE(during_wi.title, fs.title) AS during_title
    FROM captures c
    LEFT JOIN work_items converted_wi ON converted_wi.id = ${workItemExpression}
    LEFT JOIN focus_sessions fs ON fs.id = ${focusSessionExpression}
    LEFT JOIN work_items during_wi ON during_wi.id = fs.work_item_id
    WHERE (
      (datetime(c.created_at) >= datetime(${sqlString(from.toISOString())}) AND datetime(c.created_at) < datetime(${sqlString(to.toISOString())}))
      OR (datetime(c.resolved_at) >= datetime(${sqlString(from.toISOString())}) AND datetime(c.resolved_at) < datetime(${sqlString(to.toISOString())}))
      OR (datetime(c.converted_at) >= datetime(${sqlString(from.toISOString())}) AND datetime(c.converted_at) < datetime(${sqlString(to.toISOString())}))
    )
    ORDER BY datetime(c.created_at) ASC
  `;
  const rows = await sqliteJson(path, query);

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    state: row.state,
    work_item_id: row.work_item_id ?? null,
    converted_work_item_title: row.converted_work_item_title ?? null,
    focus_session_id: row.focus_session_id ?? null,
    during_title: row.during_title ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at ?? null,
    converted_at: row.converted_at ?? null,
  }));
}

async function loadRefs(path, schema, workItemIds) {
  if (!schema.tables.refs || !schema.tables.work_item_refs || workItemIds.size === 0) return [];
  const ids = Array.from(workItemIds).map(sqlString).join(", ");
  return sqliteJson(path, `
    SELECT
      r.id,
      r.kind,
      r.value,
      r.created_at,
      wir.work_item_id,
      wi.title AS work_item_title,
      wir.is_primary,
      wir.created_at AS linked_at
    FROM work_item_refs wir
    JOIN refs r ON r.id = wir.ref_id
    LEFT JOIN work_items wi ON wi.id = wir.work_item_id
    WHERE wir.work_item_id IN (${ids})
    ORDER BY wir.is_primary DESC, datetime(wir.created_at), r.kind, r.normalized_value;
  `).then((rows) => rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    value: row.value,
    created_at: row.created_at,
    work_item_id: row.work_item_id,
    work_item_title: row.work_item_title ?? row.work_item_id,
    is_primary: Boolean(row.is_primary),
    linked_at: row.linked_at,
    provenance: "current_work_item_link",
  })));
}

function semanticFromSnapshotRow(row) {
  const trackPath = parseJsonPayload(row.track_path_json) ?? [];
  const labels = parseJsonPayload(row.labels_json) ?? [];
  return {
    track_id: row.snapshot_track_id ?? trackPath.at(-1)?.id ?? null,
    track_path: trackPath,
    labels,
    captured_at: row.semantic_captured_at,
    provenance: "captured",
  };
}

function semanticFromCurrentWorkItem(workItemId, taxonomy, provenance = "inferred-current") {
  const current = workItemId ? taxonomy.workItems.get(workItemId) : null;
  return {
    track_id: current?.track?.id ?? null,
    track_path: current?.track?.path ?? [],
    labels: current?.labels ?? [],
    captured_at: null,
    provenance: workItemId ? provenance : "unclassified",
  };
}

function enrichLinkedRecord(record, sessionById, taxonomy) {
  const linkedSession = record.focus_session_id ? sessionById.get(record.focus_session_id) : null;
  return {
    ...record,
    activity_zone: record.activity_zone ?? linkedSession?.activity_zone ?? null,
    semantic: record.semantic
      ?? linkedSession?.semantic
      ?? semanticFromCurrentWorkItem(record.work_item_id, taxonomy),
  };
}

function enrichCaptureRecord(capture, sessionById, taxonomy) {
  const linkedSession = capture.focus_session_id ? sessionById.get(capture.focus_session_id) : null;
  return {
    ...capture,
    activity_zone: linkedSession?.activity_zone ?? null,
    semantic: linkedSession?.semantic
      ?? semanticFromCurrentWorkItem(capture.work_item_id, taxonomy),
  };
}

function matchesReportFilters(record, filters) {
  if (!filters.active) return true;
  const semantic = record.semantic ?? { track_id: null, labels: [] };
  if (filters.allowedTrackIds.size > 0) {
    const currentTreeMatch = filters.allowedTrackIds.has(semantic.track_id);
    const historicalPathMatch = Boolean(
      filters.selectedTrack
      && filters.public.track?.include_children
      && (semantic.track_path ?? []).some((node) => node.id === filters.selectedTrack.id)
    );
    if (!currentTreeMatch && !historicalPathMatch) return false;
  }
  if (filters.labelIds.size > 0) {
    const recordLabelIds = new Set((semantic.labels ?? []).map((label) => label.id));
    if (!Array.from(filters.labelIds).every((labelId) => recordLabelIds.has(labelId))) return false;
  }
  if (filters.zones.size > 0 && !filters.zones.has(record.activity_zone)) return false;
  return true;
}

function buildClassificationCoverage(fullTimeline, filteredTimeline, filters) {
  const seconds = (items) => items.reduce((sum, item) => sum + item.active_seconds, 0);
  const unclassified = fullTimeline.filter((item) => !item.semantic?.track_id);
  const inferred = fullTimeline.filter((item) => item.semantic?.provenance === "inferred-current");
  const captured = fullTimeline.filter((item) => item.semantic?.provenance === "captured");
  const includedUnclassified = filteredTimeline.filter((item) => !item.semantic?.track_id);
  const includedInferred = filteredTimeline.filter((item) => item.semantic?.provenance === "inferred-current");
  const includedCaptured = filteredTimeline.filter((item) => item.semantic?.provenance === "captured");
  return {
    filter_active: filters.active,
    source_entrances: fullTimeline.length,
    included_entrances: filteredTimeline.length,
    excluded_entrances: Math.max(fullTimeline.length - filteredTimeline.length, 0),
    source_tracked_seconds: seconds(fullTimeline),
    included_tracked_seconds: seconds(filteredTimeline),
    excluded_tracked_seconds: Math.max(seconds(fullTimeline) - seconds(filteredTimeline), 0),
    captured_entrances: captured.length,
    inferred_current_entrances: inferred.length,
    captured_included_entrances: includedCaptured.length,
    inferred_current_included_entrances: includedInferred.length,
    unclassified_source_entrances: unclassified.length,
    unclassified_source_seconds: seconds(unclassified),
    unclassified_included_entrances: includedUnclassified.length,
    unclassified_included_seconds: seconds(includedUnclassified),
  };
}

function clipSession(session, from, to, now) {
  const originalStart = new Date(session.started_at);
  const originalStop = session.stopped_at ? new Date(session.stopped_at) : now;
  const clippedStart = new Date(Math.max(originalStart.getTime(), from.getTime()));
  const clippedStop = new Date(Math.min(originalStop.getTime(), to.getTime(), now.getTime()));
  if (clippedStop.getTime() <= clippedStart.getTime()) return null;

  return {
    id: session.id,
    title: session.work_item_title ?? session.title,
    original_title: session.title,
    work_item_id: session.work_item_id,
    work_item_note: session.work_item_note,
    work_item_state: session.work_item_state,
    activity_zone: session.activity_zone,
    state: session.state,
    note: session.note,
    semantic: session.semantic,
    started_at: clippedStart.toISOString(),
    stopped_at: clippedStop.toISOString(),
    original_started_at: session.started_at,
    original_stopped_at: session.stopped_at,
    active_seconds: Math.max(Math.floor((clippedStop.getTime() - clippedStart.getTime()) / 1000), 0),
    clipped: clippedStart.getTime() !== originalStart.getTime() || clippedStop.getTime() !== originalStop.getTime(),
  };
}

function aggregateDays(timeline, dayEvents, workItemEvents, captures, from, to) {
  const days = enumerateLocalDays(from, to).map((date) => ({
    date: formatLocalDate(date),
    tracked_seconds: 0,
    working_occupancy_seconds: 0,
    executive_work_seconds: 0,
    non_work_seconds: 0,
    entrances: 0,
    day_events: 0,
    work_item_events: 0,
    captures_created: 0,
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const entrancesByDate = new Map(days.map((day) => [day.date, new Set()]));

  for (const session of timeline) {
    for (const segment of splitSessionByLocalDay(session)) {
      const day = byDate.get(segment.date);
      if (!day) continue;
      day.tracked_seconds += segment.seconds;
      if (session.activity_zone === "work") {
        day.executive_work_seconds += segment.seconds;
        day.working_occupancy_seconds += segment.seconds;
      } else if (session.activity_zone === "coordination") {
        day.working_occupancy_seconds += segment.seconds;
      } else {
        day.non_work_seconds += segment.seconds;
      }
      entrancesByDate.get(segment.date).add(session.id);
    }
  }

  for (const event of dayEvents) {
    const day = byDate.get(event.day);
    if (day) day.day_events += 1;
  }
  for (const event of workItemEvents) {
    const day = byDate.get(event.day);
    if (day) day.work_item_events += 1;
  }
  for (const capture of captures) {
    const day = byDate.get(formatLocalDate(new Date(capture.created_at)));
    if (day) day.captures_created += 1;
  }
  for (const day of days) {
    day.entrances = entrancesByDate.get(day.date).size;
  }

  return days;
}

function aggregateByActivityZone(timeline) {
  const totals = new Map();
  for (const session of timeline) {
    const zone = session.activity_zone ?? "work";
    const current = totals.get(zone) ?? {
      zone,
      active_seconds: 0,
      entrances: 0,
      days: new Set(),
    };
    current.active_seconds += session.active_seconds;
    current.entrances += 1;
    for (const segment of splitSessionByLocalDay(session)) current.days.add(segment.date);
    totals.set(zone, current);
  }

  return Array.from(totals.values())
    .map((item) => ({ ...item, days: item.days.size }))
    .sort((left, right) => right.active_seconds - left.active_seconds || left.zone.localeCompare(right.zone));
}

function aggregateByWorkItem(timeline, workItemEvents) {
  const totals = new Map();
  for (const session of timeline) {
    const key = session.work_item_id ?? `title:${session.title}`;
    const current = totals.get(key) ?? {
      work_item_id: session.work_item_id,
      title: session.title,
      note: session.work_item_note,
      active_seconds: 0,
      working_seconds: 0,
      executive_work_seconds: 0,
      entrances: 0,
      days: new Set(),
      zones: new Map(),
      first_contact_at: session.started_at,
      last_contact_at: session.stopped_at,
      last_event_at: null,
      last_event_text: null,
      context_event_count: 0,
      state: session.work_item_state,
      semantic_slices: new Map(),
    };
    current.title = session.title;
    if (session.work_item_note) current.note = session.work_item_note;
    if (session.work_item_state) current.state = session.work_item_state;
    current.active_seconds += session.active_seconds;
    if (session.activity_zone === "work" || session.activity_zone === "coordination") {
      current.working_seconds += session.active_seconds;
    }
    if (session.activity_zone === "work") current.executive_work_seconds += session.active_seconds;
    current.entrances += 1;
    for (const segment of splitSessionByLocalDay(session)) current.days.add(segment.date);
    current.zones.set(
      session.activity_zone,
      (current.zones.get(session.activity_zone) ?? 0) + session.active_seconds
    );
    const semanticKey = JSON.stringify({
      track_id: session.semantic?.track_id ?? null,
      track_path: session.semantic?.track_path ?? [],
      labels: session.semantic?.labels ?? [],
      provenance: session.semantic?.provenance ?? "unclassified",
    });
    const semanticSlice = current.semantic_slices.get(semanticKey) ?? {
      track_id: session.semantic?.track_id ?? null,
      track_path: session.semantic?.track_path ?? [],
      labels: session.semantic?.labels ?? [],
      provenance: session.semantic?.provenance ?? "unclassified",
      active_seconds: 0,
      entrances: 0,
    };
    semanticSlice.active_seconds += session.active_seconds;
    semanticSlice.entrances += 1;
    current.semantic_slices.set(semanticKey, semanticSlice);
    if (new Date(session.started_at) < new Date(current.first_contact_at)) current.first_contact_at = session.started_at;
    if (new Date(session.stopped_at) > new Date(current.last_contact_at)) current.last_contact_at = session.stopped_at;
    totals.set(key, current);
  }

  for (const event of workItemEvents) {
    const key = event.work_item_id;
    const current = totals.get(key);
    if (!current) continue;
    if (!current.last_event_at || new Date(event.ts) > new Date(current.last_event_at)) {
      current.last_event_at = event.ts;
      current.last_event_text = event.text;
    }
    if (event.kind === "note_added" && event.text) current.context_event_count += 1;
  }

  return Array.from(totals.values())
    .map((item) => ({
      work_item_id: item.work_item_id,
      title: item.title,
      note: item.note,
      active_seconds: item.active_seconds,
      working_seconds: item.working_seconds,
      executive_work_seconds: item.executive_work_seconds,
      entrances: item.entrances,
      days: item.days.size,
      average_block_seconds: item.entrances > 0 ? Math.floor(item.active_seconds / item.entrances) : 0,
      zones: Array.from(item.zones.entries())
        .map(([zone, activeSeconds]) => ({ zone, active_seconds: activeSeconds }))
        .sort((left, right) => right.active_seconds - left.active_seconds),
      first_contact_at: item.first_contact_at,
      last_contact_at: item.last_contact_at,
      last_event_at: item.last_event_at,
      last_event_text: item.last_event_text,
      context_event_count: item.context_event_count,
      state: item.state ?? null,
      semantic_slices: Array.from(item.semantic_slices.values())
        .sort((left, right) => right.active_seconds - left.active_seconds),
    }))
    .sort((left, right) => right.active_seconds - left.active_seconds || left.title.localeCompare(right.title));
}

function buildSignificantGaps(timeline, dayEvents, from, to) {
  const days = enumerateLocalDays(from, to);
  const gaps = [];

  for (const dayStart of days) {
    const dayEnd = nextLocalDay(dayStart);
    const intervals = timeline
      .map((session) => {
        const start = new Date(Math.max(new Date(session.started_at).getTime(), dayStart.getTime()));
        const stop = new Date(Math.min(new Date(session.stopped_at).getTime(), dayEnd.getTime()));
        if (stop.getTime() <= start.getTime()) return null;
        return { session_id: session.id, from: start, to: stop, state: session.state };
      })
      .filter(Boolean)
      .sort((left, right) => left.from - right.from);

    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      const seconds = Math.floor((current.from.getTime() - previous.to.getTime()) / 1000);
      if (seconds < SIGNIFICANT_GAP_SECONDS) continue;
      gaps.push(createGapView(previous.to, current.from, seconds, dayEvents, false));
    }

  }

  return gaps;
}

function createGapView(from, to, seconds, dayEvents, open) {
  const explanation = findGapExplanation({ from, to }, dayEvents);
  return {
    day: formatLocalDate(from),
    from: from.toISOString(),
    to: to.toISOString(),
    seconds,
    open,
    explained: Boolean(explanation),
    classification: explanation?.classification ?? "unexplained",
    explanation_event_id: explanation?.event.id ?? null,
    explanation: explanation?.event.text ?? null,
  };
}

function findGapExplanation(gap, dayEvents) {
  const day = formatLocalDate(gap.from);
  const gapStartMinutes = localMinutes(gap.from);
  const gapEndMinutes = localMinutes(gap.to);
  const candidates = dayEvents.filter((event) => event.day === day && isGapExplanationText(event.text));

  for (const event of candidates) {
    for (const range of extractClockRanges(event.text)) {
      if (Math.abs(range.from - gapStartMinutes) <= 2 && Math.abs(range.to - gapEndMinutes) <= 2) {
        return { event, classification: classifyGapExplanation(event) };
      }
      const eventTime = new Date(event.ts).getTime();
      const describesEarlierOpenGap =
        Math.abs(range.from - gapStartMinutes) <= 2 &&
        range.to <= gapEndMinutes + 2 &&
        eventTime >= gap.from.getTime() - 2 * 60 * 1000 &&
        eventTime <= gap.to.getTime() + 5 * 60 * 1000;
      if (describesEarlierOpenGap) {
        return { event, classification: classifyGapExplanation(event) };
      }
    }
  }

  return undefined;
}

function buildWarnings({
  timeline,
  days,
  byActivityZone,
  byWorkItem,
  gaps,
  captures,
  dayEvents,
  workItemEvents,
  schema,
}) {
  const warnings = [];
  const activeSessions = timeline.filter((session) => session.state === "active");
  if (activeSessions.length > 0) {
    warnings.push({
      code: "active_focus_sessions",
      severity: "warning",
      message: `В периоде есть незавершённые фокус-блоки: ${activeSessions.length}.`,
      evidence: activeSessions.map((session) => ({ id: session.id, title: session.title })),
    });
  }

  const overlaps = findFocusSessionOverlaps(timeline);
  if (overlaps.length > 0) {
    warnings.push({
      code: "overlapping_focus_sessions",
      severity: "warning",
      message: `В периоде пересекаются фокус-блоки: ${overlaps.length}. Итоги времени могут быть завышены до исправления границ.`,
      evidence: overlaps.map((overlap) => ({
        first_id: overlap.first.id,
        first_title: overlap.first.title,
        second_id: overlap.second.id,
        second_title: overlap.second.title,
        from: overlap.from.toISOString(),
        to: overlap.to.toISOString(),
        seconds: overlap.seconds,
      })),
    });
  }

  const unexplainedGaps = gaps.filter((gap) => !gap.explained);
  if (unexplainedGaps.length > 0) {
    warnings.push({
      code: "unexplained_significant_gaps",
      severity: "warning",
      message: `Остались крупные разрывы без привязанного объяснения: ${unexplainedGaps.length}.`,
      evidence: unexplainedGaps.map((gap) => ({ day: gap.day, from: gap.from, to: gap.to, seconds: gap.seconds })),
    });
  }

  const openCaptures = captures.filter((capture) => capture.state === "open");
  if (openCaptures.length > 0) {
    warnings.push({
      code: "open_captures",
      severity: "review",
      message: `В периоде остались открытые отвлечения: ${openCaptures.length}.`,
      evidence: openCaptures.map((capture) => ({ id: capture.id, created_at: capture.created_at, text: capture.text })),
    });
  }

  const contextualEventDays = new Set([
    ...dayEvents.map((event) => event.day),
    ...workItemEvents.filter((event) => event.kind === "note_added" && event.text).map((event) => event.day),
  ]);
  const daysWithoutContext = days
    .filter((day) => day.tracked_seconds >= 60 * 60 && !contextualEventDays.has(day.date))
    .map((day) => day.date);
  if (daysWithoutContext.length > 0) {
    warnings.push({
      code: "low_context_event_density",
      severity: "review",
      message: `В ${daysWithoutContext.length} активных днях с часом или более трекинга нет смысловых событий.`,
      evidence: daysWithoutContext,
    });
  }

  const unknownZones = timeline.filter((session) => !KNOWN_ACTIVITY_ZONES.has(session.activity_zone));
  if (unknownZones.length > 0 || !schema.hasActivityZone) {
    warnings.push({
      code: "activity_zone_coverage",
      severity: "warning",
      message: !schema.hasActivityZone
        ? "База не хранит снимок Activity Zone; все старые блоки считаются зоной «Работа»."
        : `Есть фокус-блоки с неизвестной зоной: ${unknownZones.length}.`,
      evidence: unknownZones.map((session) => ({ id: session.id, activity_zone: session.activity_zone })),
    });
  }

  const disputedZoneItems = byWorkItem.filter((item) => {
    const materialZones = item.zones.filter((zone) => zone.active_seconds >= 5 * 60);
    if (materialZones.length < 2) return false;
    const dominant = materialZones[0]?.active_seconds ?? 0;
    return dominant / item.active_seconds < 0.9;
  });
  if (disputedZoneItems.length > 0) {
    warnings.push({
      code: "questionable_activity_zones",
      severity: "review",
      message: `Несколько дел заметно распределены между разными зонами: ${disputedZoneItems.length}. Проверь, это реальная смена режима или ошибка разметки.`,
      evidence: disputedZoneItems.map((item) => ({ title: item.title, zones: item.zones })),
    });
  } else if (timeline.length >= 8 && byActivityZone.length === 1) {
    warnings.push({
      code: "single_zone_dominance",
      severity: "review",
      message: "Весь период размечен одной Activity Zone. Проверь, не скрыты ли координация, восстановление или личное время.",
      evidence: byActivityZone,
    });
  }

  const broadItems = byWorkItem.filter(
    (item) => item.days >= 3 && item.entrances >= 5 && (item.average_block_seconds < 45 * 60 || item.zones.length > 1)
  );
  if (broadItems.length > 0) {
    warnings.push({
      code: "possibly_overbroad_work_items",
      severity: "review",
      message: `Есть дела, которые могут быть слишком широкими для содержательного обзора: ${broadItems.length}.`,
      evidence: broadItems.map((item) => ({
        title: item.title,
        days: item.days,
        entrances: item.entrances,
        active_seconds: item.active_seconds,
        average_block_seconds: item.average_block_seconds,
      })),
    });
  }

  if (timeline.length === 0) {
    warnings.push({
      code: "no_focus_data",
      severity: "warning",
      message: "В выбранном периоде нет фокус-блоков.",
      evidence: [],
    });
  }

  warnings.push({
    code: "current_work_item_titles",
    severity: "info",
    message: "Исторические снимки названий дел пока не хранятся; отчёт использует текущие названия Work Items.",
    evidence: [],
  });

  return warnings;
}

function buildObservations({ timeline, byActivityZone, byWorkItem, gaps, captures }) {
  const protectedBlocks = timeline.filter(
    (session) => ["work", "coordination"].includes(session.activity_zone) && session.active_seconds >= 25 * 60
  );
  const fragmentedItems = byWorkItem.filter(
    (item) => item.entrances >= 3 && item.average_block_seconds < 15 * 60
  );
  const classifiedGaps = gaps.reduce((totals, gap) => {
    totals[gap.classification] = (totals[gap.classification] ?? 0) + 1;
    return totals;
  }, {});
  const convertedCaptures = captures.filter((capture) => capture.state === "converted");

  return {
    protected_work_blocks: {
      count: protectedBlocks.length,
      active_seconds: protectedBlocks.reduce((sum, block) => sum + block.active_seconds, 0),
    },
    fragmented_work_items: fragmentedItems.map((item) => ({
      work_item_id: item.work_item_id,
      title: item.title,
      entrances: item.entrances,
      active_seconds: item.active_seconds,
      average_block_seconds: item.average_block_seconds,
    })),
    gap_classifications: classifiedGaps,
    capture_outcomes: {
      total: captures.length,
      converted: convertedCaptures.length,
      resolved: captures.filter((capture) => capture.state === "resolved").length,
      open: captures.filter((capture) => capture.state === "open").length,
    },
    zone_balance: byActivityZone.map((zone) => ({
      zone: zone.zone,
      active_seconds: zone.active_seconds,
      share: timeline.length > 0
        ? zone.active_seconds / timeline.reduce((sum, session) => sum + session.active_seconds, 0)
        : 0,
    })),
  };
}

function buildFocusTuning({ byWorkItem, gaps, captures, observations }) {
  const candidates = byWorkItem
    .filter((item) => {
      const fragmented = item.entrances >= 3 && item.average_block_seconds < 15 * 60;
      const recurringRoutine = item.days >= 4 && item.entrances / item.days <= 1.5;
      const repeatedlyReactive = item.days >= 3 && item.entrances / item.days >= 2 && item.context_event_count === 0;
      const hasContinuationEvidence = item.entrances >= 2 || item.context_event_count > 0;
      const mostlyExecution = item.working_seconds > 0 && item.executive_work_seconds / item.working_seconds >= 0.6;
      return item.executive_work_seconds >= 15 * 60 && hasContinuationEvidence && mostlyExecution && !fragmented && !recurringRoutine && !repeatedlyReactive;
    })
    .map((item) => {
      const kind = item.average_block_seconds >= 25 * 60 ? "protect_or_finish" : "review_next_commitment";
      const score = item.executive_work_seconds + item.context_event_count * 30 * 60 + item.days * 5 * 60 + item.entrances * 2 * 60;
      return {
        work_item_id: item.work_item_id,
        title: item.title,
        kind,
        score,
        evidence: {
          working_seconds: item.working_seconds,
          executive_work_seconds: item.executive_work_seconds,
          entrances: item.entrances,
          days: item.days,
          average_block_seconds: item.average_block_seconds,
          last_contact_at: item.last_contact_at,
          context_event_count: item.context_event_count,
        },
        decision_prompt: focusDecisionPrompt(kind),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const processSignals = [];
  const unmanaged = gaps.filter((gap) => gap.classification === "unmanaged");
  if (unmanaged.length > 0) {
    processSignals.push({
      kind: "restore_manageability",
      message: `В периоде отмечена потеря управляемости в ${unmanaged.length} крупных разрывах. Выбери один конкретный способ удешевить возврат.`,
    });
  }
  if (observations.fragmented_work_items.length > 0) {
    processSignals.push({
      kind: "reduce_fragmentation",
      message: `Есть дробные дела: ${observations.fragmented_work_items.length}. Проверь, что из этого было необходимой реакцией, а что можно объединить, ограничить или убрать.`,
    });
  }
  const openCaptures = captures.filter((capture) => capture.state === "open").length;
  if (openCaptures > 0) {
    processSignals.push({
      kind: "resolve_open_captures",
      message: `До следующего периода разберись с открытыми отвлечениями: ${openCaptures}.`,
    });
  }

  return {
    candidates,
    process_signals: processSignals,
    questions: [
      "Какой из кандидатов действительно меняет важное состояние мира и заслуживает защищённого окна?",
      "Какую повторяющуюся активность следует завершить, делегировать, ограничить или признать необходимой реактивной работой?",
      "Какой один разрыв или паттерн восстановления стоит инженерно удешевить в следующем периоде?",
    ],
  };
}

function buildProfileAnalysis({ profile, byWorkItem, workItemEvents, dayEvents, focusTuning, filters, captures, refs }) {
  const topFlow = byWorkItem.slice(0, 5).map((item) => ({
    work_item_id: item.work_item_id,
    subject: item.title,
    executive_work_seconds: item.executive_work_seconds,
    working_seconds: item.working_seconds,
    entrances: item.entrances,
    days: item.days,
    context_event_count: item.context_event_count,
  }));
  const contextEvents = workItemEvents
    .filter((event) => event.kind === "note_added" && event.text)
    .slice(0, 12)
    .map((event) => ({
      ts: event.ts,
      work_item_id: event.work_item_id,
      subject: event.work_item_title ?? event.work_item_id,
      text: event.text,
    }));

  if (profile === "weekly-review") {
    return {
      kind: "next_period_tuning",
      headline: "Выбор следующего фокуса и уменьшение оперативного WIP.",
      evidence_candidates: focusTuning.candidates.map((candidate) => ({
        work_item_id: candidate.work_item_id,
        subject: candidate.title,
        evidence: `${formatDuration(candidate.evidence.executive_work_seconds)} исполнения, ${candidate.evidence.entrances} входов, ${candidate.evidence.days} дней`,
      })),
      facts: focusTuning.process_signals.map((signal) => signal.message),
      limitations: [],
    };
  }
  if (profile === "sprint-review") {
    return {
      kind: "intent_vs_actual_flow",
      headline: "Фактический поток спринта виден; исходное намерение нужно подтвердить в обзоре.",
      evidence_candidates: topFlow.map((item) => ({
        work_item_id: item.work_item_id,
        subject: item.subject,
        evidence: `${formatDuration(item.working_seconds)} рабочей занятости, ${item.entrances} входов за ${item.days} дней`,
      })),
      facts: ["planned_intent_stored: false", `context_events: ${contextEvents.length}`],
      limitations: ["Без сохранённого плана Timeskein не объявляет работу запланированной или незапланированной автоматически."],
    };
  }
  if (profile === "track-retrospective") {
    const trackTitle = filters.selectedTrack?.path.map((node) => node.title).join(" / ") ?? "выбранный Track";
    const openTails = [
      ...byWorkItem
        .filter((item) => item.state !== "done")
        .map((item) => ({
          kind: "work_item",
          id: item.work_item_id,
          subject: item.title,
          state: item.state ?? "unknown",
          evidence: `${formatDuration(item.active_seconds)}, ${item.entrances} входов, последнее касание ${formatLocalDateTime(item.last_contact_at)}`,
        })),
      ...captures
        .filter((capture) => capture.state === "open")
        .map((capture) => ({
          kind: "capture",
          id: capture.id,
          subject: capture.text,
          state: "open",
          evidence: `зафиксировано ${formatLocalDateTime(capture.created_at)}`,
        })),
    ];
    return {
      kind: "track_evidence",
      headline: `Фактическая история направления «${trackTitle}» собрана по сохранённой классификации.`,
      evidence_candidates: topFlow
        .filter((item) => item.context_event_count > 0 || item.executive_work_seconds >= 15 * 60)
        .map((item) => ({
          work_item_id: item.work_item_id,
          subject: item.subject,
          evidence: `${formatDuration(item.executive_work_seconds)} исполнения, ${item.context_event_count} смысловых событий`,
        })),
      facts: contextEvents.map((event) => `${event.ts}: ${event.subject} — ${event.text}`),
      refs_count: refs.length,
      open_tails: openTails,
      limitations: ["Старые входы без исторического снимка явно помечаются как восстановленные по текущему Work Item."],
    };
  }

  return {
    kind: "performance_evidence",
    headline: "Кандидаты проверяемой фактуры собраны без автоматической оценки влияния.",
    evidence_candidates: topFlow.map((item) => ({
      work_item_id: item.work_item_id,
      subject: item.subject,
      evidence: `${formatDuration(item.working_seconds)} занятости, ${item.context_event_count} смысловых событий, ${item.days} дней`,
    })),
    facts: [
      ...contextEvents.map((event) => `${event.ts}: ${event.subject} — ${event.text}`),
      ...dayEvents.slice(0, 8).map((event) => `${event.ts}: ${event.text}`),
    ],
    limitations: ["Влияние и качество результата подтверждает пользователь; длительность служит только указателем, где искать фактуру."],
  };
}

function buildEvidenceStory({ workItemEvents, profileAnalysis, reflectionContext }) {
  const entries = workItemEvents
    .filter((event) => event.kind === "note_added" && event.text && event.evidence)
    .map((event) => ({
      id: event.id,
      ts: event.ts,
      work_item_id: event.work_item_id,
      work_item_title: event.work_item_title ?? event.work_item_id,
      focus_session_id: event.focus_session_id,
      kind: event.evidence.kind,
      text: event.text,
      refs: event.evidence.refs,
      confirmed: event.evidence.refs.length > 0,
      semantic: event.semantic,
      provenance: {
        evidence: event.evidence.provenance,
        classification: event.semantic?.provenance ?? "unclassified",
      },
    }));
  const byKind = (kind) => entries.filter((entry) => entry.kind === kind);
  const sessions = [
    ...(reflectionContext.selected_period ?? []),
    ...(reflectionContext.previous_period ? [reflectionContext.previous_period] : []),
  ];
  const followups = sessions.flatMap((session) => session.decision_followups ?? []);
  const priorDecisions = sessions.flatMap((session) => session.decisions ?? []);
  const decisionFollowups = priorDecisions.map((decision) => {
    const explicit = [...followups]
      .filter((followup) => followup.prior_decision_id === decision.id)
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    const laterEvidence = entries.filter((entry) => {
      if (new Date(entry.ts).getTime() <= new Date(decision.created_at).getTime()) return false;
      if (decision.work_item_id) return entry.work_item_id === decision.work_item_id;
      return Boolean(decision.track_id);
    });
    return {
      prior_decision_id: decision.id,
      subject: decision.subject,
      decision: decision.decision,
      decided_at: decision.created_at,
      track_id: decision.track_id ?? null,
      status: explicit?.status ?? (laterEvidence.length === 0 ? "no_evidence" : "needs_review"),
      note: explicit?.note ?? null,
      evidence_event_id: explicit?.evidence_event_id ?? null,
      candidate_evidence_event_ids: laterEvidence.map((entry) => entry.id),
      provenance: explicit ? "explicit_followup" : "report_candidate",
    };
  });

  return {
    entries,
    changes: byKind("result"),
    evidence: entries.filter((entry) => entry.refs.length > 0),
    decisions: byKind("decision"),
    blockers_and_tails: [
      ...byKind("blocker").map((entry) => ({ ...entry, source: "typed_evidence" })),
      ...(profileAnalysis.open_tails ?? []).map((tail) => ({ ...tail, source: "current_tail" })),
    ],
    next_actions: byKind("next_step"),
    observations: byKind("observation"),
    decision_followups: decisionFollowups,
    legacy_notes: workItemEvents.filter((event) => event.kind === "note_added" && event.text && !event.evidence).map((event) => ({
      id: event.id,
      ts: event.ts,
      work_item_id: event.work_item_id,
      work_item_title: event.work_item_title ?? event.work_item_id,
      text: event.text,
      provenance: "legacy_note",
    })),
    interpretation_rule: "Tracked duration is effort evidence only. A result is confirmed in this report only when the typed result entry has at least one captured Ref snapshot.",
  };
}

function focusDecisionPrompt(kind) {
  if (kind === "protect_or_finish") {
    return "Решить: защитить следующий блок, довести до результата или сознательно завершить трек.";
  }
  if (kind === "reduce_fragmentation_or_drop") {
    return "Решить: объединить в один блок, ограничить реактивность, делегировать или убрать.";
  }
  return "Решить: продолжить, завершить, делегировать или сознательно не брать дальше.";
}

function renderPeriodMarkdown(report) {
  const lines = [];
  const from = parseLocalDate(report.request.from, "from");
  const to = parseLocalDate(report.request.to, "to");
  const inclusiveEnd = new Date(to);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  const periodLabel = `${formatHumanDate(from)} — ${formatHumanDate(inclusiveEnd)}`;

  lines.push(
    `# Периодический отчёт Timeskein — ${periodLabel}`,
    "",
    `Профиль: ${report.profile.title} (${report.request.profile})`,
    `Диапазон: ${report.request.from} включительно — ${report.request.to} исключительно`,
    `Часовой пояс: ${report.request.timezone}`,
    `Сформирован: ${formatLocalDateTime(report.generated_at)}`,
    `Срез: ${formatReportFilters(report.request.filters)}`,
    "",
    "## Задача обзора",
    "",
    report.profile.purpose,
    "",
    `Фокус отчёта: ${report.profile.output_emphasis}`,
    "",
    "### Вопросы профиля",
    "",
    ...report.profile.questions.map((question) => `- ${question}`),
    "",
    "### Границы интерпретации",
    "",
    ...report.profile.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Краткий итог",
    "",
    `- Учтено: ${formatDuration(report.summary.tracked_seconds)} за ${report.summary.days_with_activity} активных дней из ${report.summary.calendar_days}.`,
    `- Рабочая занятость: ${formatDuration(report.summary.working_occupancy_seconds)}; исполнение: ${formatDuration(report.summary.executive_work_seconds)}; вне работы: ${formatDuration(report.summary.non_work_seconds)}.`,
    `- Входов: ${report.summary.entrances}; крупных разрывов: ${report.summary.significant_gaps}; без объяснения: ${report.summary.unexplained_gaps}.`,
    `- Смысловой контекст: ${report.summary.day_events} событий дня, ${report.summary.contextual_work_item_events} заметок дел, ${report.summary.captures} отвлечений.`,
    `- Связанных refs: ${report.summary.refs}.`,
    "",
    "## Покрытие классификации",
    "",
    `- В исходном периоде: ${report.classification.source_entrances} входов, ${formatDuration(report.classification.source_tracked_seconds)}.`,
    `- В выбранном срезе: ${report.classification.included_entrances} входов, ${formatDuration(report.classification.included_tracked_seconds)}.`,
    `- В выбранном срезе: исторический снимок — ${report.classification.captured_included_entrances}; восстановлено по текущему Work Item — ${report.classification.inferred_current_included_entrances}; Unclassified — ${report.classification.unclassified_included_entrances}.`,
    `- Во всём исходном периоде: исторический снимок — ${report.classification.captured_entrances}; без снимка — ${report.classification.inferred_current_entrances}; Unclassified — ${report.classification.unclassified_source_entrances} входов, ${formatDuration(report.classification.unclassified_source_seconds)}.`,
    "",
    "## Предупреждения качества",
    ""
  );
  const materialWarnings = report.warnings.filter((warning) => warning.severity !== "info");
  if (materialWarnings.length === 0) {
    lines.push("- Существенных предупреждений нет.");
  } else {
    for (const warning of materialWarnings) {
      lines.push(`- **${warningSeverityLabel(warning.severity)}:** ${warning.message}`);
    }
  }
  const infoWarnings = report.warnings.filter((warning) => warning.severity === "info");
  for (const warning of infoWarnings) lines.push(`- Ограничение: ${warning.message}`);

  appendProfileAnalysisMarkdown(lines, report.profile_analysis);
  if (report.evidence_story) appendEvidenceStoryMarkdown(lines, report.evidence_story);

  lines.push(
    "",
    "## Факты периода",
    "",
    "### По дням",
    "",
    "| День | Учтено | Рабочая занятость | Исполнение | Вне работы | Входов | Событий |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const day of report.totals.by_day) {
    lines.push(
      `| ${day.date} | ${formatDuration(day.tracked_seconds)} | ${formatDuration(day.working_occupancy_seconds)} | ${formatDuration(day.executive_work_seconds)} | ${formatDuration(day.non_work_seconds)} | ${day.entrances} | ${day.day_events + day.work_item_events} |`
    );
  }

  lines.push(
    "",
    "### По зонам активности",
    "",
    "| Зона | Длительность | Доля | Входов | Дней |",
    "| --- | ---: | ---: | ---: | ---: |"
  );
  for (const zone of report.totals.by_activity_zone) {
    const share = report.summary.tracked_seconds > 0 ? zone.active_seconds / report.summary.tracked_seconds : 0;
    lines.push(
      `| ${activityZoneLabel(zone.zone)} | ${formatDuration(zone.active_seconds)} | ${formatPercent(share)} | ${zone.entrances} | ${zone.days} |`
    );
  }

  lines.push(
    "",
    "### По делам",
    "",
    "| Дело | Классификация | Учтено | Исполнение | Входов | Дней | Средний блок | Зоны |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |"
  );
  for (const item of report.totals.by_work_item) {
    lines.push(
      `| ${escapeMarkdownTable(item.title)} | ${escapeMarkdownTable(formatSemanticSlices(item.semantic_slices))} | ${formatDuration(item.active_seconds)} | ${formatDuration(item.executive_work_seconds)} | ${item.entrances} | ${item.days} | ${formatDuration(item.average_block_seconds)} | ${escapeMarkdownTable(formatItemZones(item.zones))} |`
    );
  }

  lines.push("", "## Наблюдения для проверки", "");
  lines.push(
    `- Защищённых рабочих блоков от 25 минут: ${report.observations.protected_work_blocks.count}, суммарно ${formatDuration(report.observations.protected_work_blocks.active_seconds)}.`
  );
  if (report.observations.fragmented_work_items.length > 0) {
    lines.push("- Кандидаты на реактивную суету или слишком мелкое дробление:");
    for (const item of report.observations.fragmented_work_items) {
      lines.push(
        `  - ${escapeMarkdownList(item.title)}: ${item.entrances} входов, ${formatDuration(item.active_seconds)} всего, средний блок ${formatDuration(item.average_block_seconds)}.`
      );
    }
  } else {
    lines.push("- Явных структурных кандидатов на мелкое дробление по этому порогу нет.");
  }
  const gapFacts = Object.entries(report.observations.gap_classifications)
    .map(([classification, count]) => `${gapClassificationLabel(classification)}: ${count}`)
    .join(", ");
  lines.push(`- Классификация крупных разрывов: ${gapFacts || "крупных разрывов нет"}.`);
  lines.push(
    `- Отвлечения: превращено в дела ${report.observations.capture_outcomes.converted}, закрыто ${report.observations.capture_outcomes.resolved}, осталось открыто ${report.observations.capture_outcomes.open}.`
  );

  appendSavedReflectionsMarkdown(lines, report.decisions);

  lines.push("", "## Решения текущего обзора", "", "### Кандидаты на 1–3 точки фокуса", "");
  lines.push("Кандидаты требуют решения человека: отчёт видит вложенное усилие и структуру входов, но пока не знает, завершён ли результат и насколько он ценен.", "");
  if (report.focus_tuning.candidates.length === 0) {
    lines.push("- По имеющимся данным кандидаты не выделены: сначала проверь полноту трекинга и контекст событий.");
  } else {
    report.focus_tuning.candidates.forEach((candidate, index) => {
      lines.push(
        `${index + 1}. **${escapeMarkdownList(candidate.title)}** — ${formatDuration(candidate.evidence.executive_work_seconds)} исполнения, ${candidate.evidence.entrances} ${pluralRu(candidate.evidence.entrances, "вход", "входа", "входов")} в ${candidate.evidence.days} ${pluralRu(candidate.evidence.days, "дне", "днях", "днях")}, средний блок ${formatDuration(candidate.evidence.average_block_seconds)}. ${candidate.decision_prompt}`
      );
    });
  }
  if (report.focus_tuning.process_signals.length > 0) {
    lines.push("", "### Настройки рабочего контура", "");
    for (const signal of report.focus_tuning.process_signals) lines.push(`- ${signal.message}`);
  }
  lines.push("", "### Вопросы профиля для решения", "");
  for (const question of report.focus_tuning.questions) lines.push(`- ${question}`);
  lines.push("", "### Допустимые решения", "");
  for (const item of report.decisions.supported_types) {
    lines.push(`- **${item.title}** (${item.id}) — ${item.meaning}`);
  }

  appendGapsMarkdown(lines, report.gaps);
  appendCapturesMarkdown(lines, report.captures);
  appendRefsMarkdown(lines, report.refs);
  appendDayEventsMarkdown(lines, report.events.day);
  appendWorkItemEventsMarkdown(lines, report.events.work_item);
  appendTimelineMarkdown(lines, report.timeline);

  lines.push(
    "",
    "## Происхождение и ограничения",
    "",
    "- Источник: локальная SQLite-база Timeskein, прочитана без записи.",
    `- Классификация: ${report.request.classification_mode}.`,
    `- ${report.provenance.title_classification_note}`,
    "- Наблюдения и кандидаты выше основаны на структуре времени и событий. Они требуют человеческой проверки; длительность сама по себе не равна ценности.",
    ""
  );

  return lines.join("\n");
}

function appendProfileAnalysisMarkdown(lines, analysis) {
  lines.push("", "## Профильный срез", "", analysis.headline, "");
  if (analysis.evidence_candidates.length > 0) {
    lines.push("### Кандидаты фактуры", "");
    for (const candidate of analysis.evidence_candidates) {
      lines.push(`- **${escapeMarkdownList(candidate.subject)}** — ${escapeMarkdownList(candidate.evidence)}`);
    }
  }
  if (analysis.facts.length > 0) {
    lines.push("", "### Факты для проверки", "");
    for (const fact of analysis.facts) lines.push(`- ${escapeMarkdownList(fact)}`);
  }
  if (analysis.limitations.length > 0) {
    lines.push("", "### Ограничения среза", "");
    for (const limitation of analysis.limitations) lines.push(`- ${escapeMarkdownList(limitation)}`);
  }
  if ((analysis.open_tails ?? []).length > 0) {
    lines.push("", "### Оставшиеся хвосты", "");
    for (const tail of analysis.open_tails) {
      lines.push(`- **${escapeMarkdownList(tail.subject)}** (${tail.state}) — ${escapeMarkdownList(tail.evidence)}`);
    }
  }
}

function appendEvidenceStoryMarkdown(lines, story) {
  lines.push("", "## Что изменилось", "");
  if (story.changes.length === 0) {
    lines.push("- Подтверждённых изменений не записано. Затраченное время не считается результатом.");
  } else {
    for (const entry of story.changes) {
      lines.push(`- ${formatEvidenceEntryMarkdown(entry)}${entry.confirmed ? " — подтверждено Ref snapshot" : " — подтверждающего Ref нет"}`);
    }
  }

  lines.push("", "## Доказательства", "");
  if (story.evidence.length === 0) {
    lines.push("- Исторических Ref snapshots в выбранном Track-срезе нет. Текущие связи Work Item показаны ниже отдельно.");
  } else {
    for (const entry of story.evidence) {
      lines.push(`- ${formatEvidenceEntryMarkdown(entry)}`);
      for (const ref of entry.refs) {
        lines.push(`  - [captured] ${escapeMarkdownList(ref.kind)}: ${escapeMarkdownList(ref.value)}`);
      }
    }
  }

  lines.push("", "## Решения", "");
  if (story.decisions.length === 0) lines.push("- Типизированных решений за период нет.");
  for (const entry of story.decisions) lines.push(`- ${formatEvidenceEntryMarkdown(entry)}`);

  lines.push("", "## Блокеры и хвосты", "");
  if (story.blockers_and_tails.length === 0) lines.push("- Явных блокеров и открытых хвостов нет.");
  for (const item of story.blockers_and_tails) {
    if (item.source === "typed_evidence") {
      lines.push(`- ${formatEvidenceEntryMarkdown(item)}`);
    } else {
      lines.push(`- [текущее состояние] **${escapeMarkdownList(item.subject)}** (${item.state}) — ${escapeMarkdownList(item.evidence)}`);
    }
  }

  lines.push("", "## Что произошло после прошлых решений", "");
  if (story.decision_followups.length === 0) {
    lines.push("- Предыдущих решений в области этого обзора нет.");
  } else {
    for (const followup of story.decision_followups) {
      const evidence = followup.evidence_event_id
        ? `; evidence event ${followup.evidence_event_id}`
        : followup.candidate_evidence_event_ids.length > 0
          ? `; ждут проверки события: ${followup.candidate_evidence_event_ids.join(", ")}`
          : "; последующей evidence-записи нет";
      lines.push(`- **${escapeMarkdownList(followup.subject)}** — ${decisionFollowupStatusLabel(followup.status)} (${followup.provenance})${followup.note ? `: ${escapeMarkdownList(followup.note)}` : ""}${evidence}`);
    }
  }

  lines.push("", "## Следующие действия", "");
  if (story.next_actions.length === 0) lines.push("- Типизированных следующих шагов не записано.");
  for (const entry of story.next_actions) lines.push(`- ${formatEvidenceEntryMarkdown(entry)}`);
  lines.push("", `Правило интерпретации: ${story.interpretation_rule}`);
  if (story.legacy_notes.length > 0) {
    lines.push(`Legacy-заметки без evidence schema: ${story.legacy_notes.length}. Они остаются в разделе событий дел и не считаются исторически подтверждёнными результатами.`);
  }
}

function formatEvidenceEntryMarkdown(entry) {
  return `${formatLocalDateTime(entry.ts)} · **${escapeMarkdownList(entry.work_item_title)}** · ${evidenceKindLabel(entry.kind)}: ${escapeMarkdownList(entry.text)}`;
}

function evidenceKindLabel(kind) {
  return {
    result: "результат",
    decision: "решение",
    blocker: "блокер",
    next_step: "следующий шаг",
    observation: "наблюдение",
  }[kind] ?? kind;
}

function decisionFollowupStatusLabel(status) {
  return {
    fulfilled: "выполнено",
    progressed: "продвинуто",
    cancelled: "отменено",
    parked: "припарковано",
    contradicted: "противоречит новым данным",
    no_evidence: "пока нет evidence",
    needs_review: "требует проверки",
  }[status] ?? status;
}

function appendSavedReflectionsMarkdown(lines, decisions) {
  lines.push("", "## Сохранённые решения", "");
  if (decisions.selected_period.length === 0) {
    lines.push("- Для этого периода и профиля решения ещё не сохранены.");
  } else {
    for (const session of decisions.selected_period) {
      lines.push(
        `### Обзор от ${formatLocalDateTime(session.created_at)}`,
        "",
        session.summary,
        ""
      );
      for (const decision of session.decisions) {
        lines.push(`- **${decisionTypeLabel(decision.decision)}:** ${escapeMarkdownList(decision.subject)}${formatDecisionTrackScope(decision)}${decision.note ? ` — ${escapeMarkdownList(decision.note)}` : ""}`);
      }
      for (const followup of session.decision_followups ?? []) {
        lines.push(`- Проверка решения **${escapeMarkdownList(followup.subject)}:** ${decisionFollowupStatusLabel(followup.status)}${followup.note ? ` — ${escapeMarkdownList(followup.note)}` : ""}${followup.evidence_event_id ? ` [evidence event: ${followup.evidence_event_id}]` : ""}`);
      }
      for (const finding of session.findings) lines.push(`- Вывод: ${escapeMarkdownList(finding)}`);
      lines.push("");
    }
  }
  if (decisions.previous_period) {
    const previous = decisions.previous_period;
    lines.push(
      "### Последний предыдущий обзор",
      "",
      `${previous.period.from} — ${previous.period.to}: ${previous.summary}`,
      ""
    );
    for (const decision of previous.decisions) {
      lines.push(`- **${decisionTypeLabel(decision.decision)}:** ${escapeMarkdownList(decision.subject)}${formatDecisionTrackScope(decision)}${decision.note ? ` — ${escapeMarkdownList(decision.note)}` : ""}`);
    }
  }
}

function formatDecisionTrackScope(decision) {
  if (!decision.track_id) return "";
  const path = (decision.track_path ?? []).map((node) => node.title).join(" / ");
  return ` [Track: ${escapeMarkdownList(path || decision.track_id)}]`;
}

function buildReflectionTemplate(report) {
  const trackDecision = report.request.filters.track
    ? [{
      track_id: report.request.filters.track.id,
      subject: report.request.filters.track.path.map((node) => node.title).join(" / "),
      decision: "",
      note: "",
    }]
    : [];
  const workItemDecisions = report.focus_tuning.candidates.map((candidate) => ({
    work_item_id: candidate.work_item_id,
    subject: candidate.title,
    decision: "",
    note: "",
  }));
  return {
    schema_version: 2,
    period: { from: report.request.from, to: report.request.to },
    profile: report.request.profile,
    filters: report.request.filters,
    summary: "",
    findings: [],
    decisions: [...trackDecision, ...workItemDecisions].slice(0, 3),
    decision_followups: (report.evidence_story?.decision_followups ?? [])
      .filter((followup) => followup.provenance !== "explicit_followup")
      .map((followup) => ({
        prior_decision_id: followup.prior_decision_id,
        subject: followup.subject,
        status: "",
        note: "",
        evidence_event_id: null,
        candidate_evidence_event_ids: followup.candidate_evidence_event_ids,
      })),
  };
}

function appendGapsMarkdown(lines, gaps) {
  lines.push("", "## Разрывы и восстановление", "");
  if (gaps.length === 0) {
    lines.push("- Крупных разрывов нет.");
    return;
  }
  lines.push("| День | Интервал | Длительность | Класс | Объяснение |", "| --- | --- | ---: | --- | --- |");
  for (const gap of gaps) {
    lines.push(
      `| ${gap.day} | ${formatClock(gap.from)}-${formatClock(gap.to)}${gap.open ? " (открыт)" : ""} | ${formatDuration(gap.seconds)} | ${gapClassificationLabel(gap.classification)} | ${escapeMarkdownTable(gap.explanation ?? "нет")} |`
    );
  }
}

function appendCapturesMarkdown(lines, captures) {
  lines.push("", "## Отвлечения", "");
  if (captures.length === 0) {
    lines.push("- В выбранном периоде нет действий с Capture Inbox.");
    return;
  }
  lines.push("| Время | Статус | Во время | Отвлечение | Результат |", "| --- | --- | --- | --- | --- |");
  for (const capture of captures) {
    const outcome = capture.state === "converted"
      ? `дело: ${capture.converted_work_item_title ?? capture.work_item_id ?? "неизвестно"}`
      : capture.state === "resolved" ? "закрыто" : "открыто";
    lines.push(
      `| ${formatLocalDateTime(capture.created_at)} | ${captureStateLabel(capture.state)} | ${escapeMarkdownTable(capture.during_title ?? "день")} | ${escapeMarkdownTable(capture.text)} | ${escapeMarkdownTable(outcome)} |`
    );
  }
}

function appendRefsMarkdown(lines, refs) {
  lines.push("", "## Связанные refs", "");
  if (refs.length === 0) {
    lines.push("- Для Work Items выбранного среза refs не найдены.");
    return;
  }
  lines.push(
    "| Дело | Тип | Ref | Роль | Происхождение |",
    "| --- | --- | --- | --- | --- |"
  );
  for (const ref of refs) {
    lines.push(
      `| ${escapeMarkdownTable(ref.work_item_title)} | ${escapeMarkdownTable(ref.kind)} | ${escapeMarkdownTable(ref.value)} | ${ref.is_primary ? "основной" : "дополнительный"} | текущая связь Work Item |`
    );
  }
}

function appendDayEventsMarkdown(lines, events) {
  lines.push("", "## События дня", "");
  if (events.length === 0) {
    lines.push("- Событий дня нет.");
    return;
  }
  lines.push("| Время | Зона | Во время | Событие |", "| --- | --- | --- | --- |");
  for (const event of events) {
    lines.push(
      `| ${formatLocalDateTime(event.ts)} | ${activityZoneLabel(event.activity_zone)} | ${escapeMarkdownTable(event.during_title ?? "день")} | ${escapeMarkdownTable(event.text)} |`
    );
  }
}

function appendWorkItemEventsMarkdown(lines, events) {
  lines.push("", "## События дел", "");
  if (events.length === 0) {
    lines.push("- Событий дел нет.");
    return;
  }
  lines.push("| Время | Дело | Тип | Содержание | Evidence | Происхождение |", "| --- | --- | --- | --- | --- | --- |");
  for (const event of events) {
    const refs = event.evidence?.refs.map((ref) => `${ref.kind}: ${ref.value}`).join("; ") ?? "";
    lines.push(
      `| ${formatLocalDateTime(event.ts)} | ${escapeMarkdownTable(event.work_item_title ?? event.work_item_id)} | ${event.evidence ? evidenceKindLabel(event.evidence.kind) : workItemEventKindLabel(event.kind)} | ${escapeMarkdownTable(event.text ?? "") } | ${escapeMarkdownTable(refs)} | ${event.evidence ? "captured evidence" : "legacy/current event"} |`
    );
  }
}

function appendTimelineMarkdown(lines, timeline) {
  lines.push("", "## Хронология фокус-блоков", "");
  if (timeline.length === 0) {
    lines.push("- Фокус-блоков нет.");
    return;
  }
  lines.push(
    "| Начало | Длительность | Зона | Track / Labels | Дело | Заметка |",
    "| --- | ---: | --- | --- | --- | --- |"
  );
  for (const session of timeline) {
    lines.push(
      `| ${formatLocalDateTime(session.started_at)} | ${formatDuration(session.active_seconds)} | ${activityZoneLabel(session.activity_zone)} | ${escapeMarkdownTable(formatSemantic(session.semantic))} | ${escapeMarkdownTable(session.title)} | ${escapeMarkdownTable(session.note ?? "")} |`
    );
  }
}

function splitSessionByLocalDay(session) {
  const result = [];
  let cursor = new Date(session.started_at);
  const stop = new Date(session.stopped_at);
  while (cursor.getTime() < stop.getTime()) {
    const next = nextLocalDay(startOfLocalDay(cursor));
    const segmentStop = new Date(Math.min(next.getTime(), stop.getTime()));
    result.push({
      date: formatLocalDate(cursor),
      seconds: Math.max(Math.floor((segmentStop.getTime() - cursor.getTime()) / 1000), 0),
    });
    cursor = segmentStop;
  }
  return result;
}

function enumerateLocalDays(from, to) {
  const result = [];
  const cursor = new Date(from);
  while (cursor.getTime() < to.getTime()) {
    result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function parseLocalDate(value, option) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error(`Некорректное значение ${option}, ожидается YYYY-MM-DD: ${value ?? ""}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Некорректная календарная дата ${option}: ${value}`);
  }
  return date;
}

function parseIsoDate(value, option) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`Некорректное значение ${option}, ожидается ISO-дата: ${value}`);
  }
  return date;
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function nextLocalDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function formatLocalDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatHumanDate(date) {
  return new Intl.DateTimeFormat("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatLocalDateTime(value) {
  const date = new Date(value);
  return `${formatLocalDate(date)} ${formatClock(date)}`;
}

function formatClock(value) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(Math.floor(totalSeconds ?? 0), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function pluralRu(value, one, few, many) {
  const absolute = Math.abs(value) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatItemZones(zones) {
  return zones.map((zone) => `${activityZoneLabel(zone.zone)} ${formatDuration(zone.active_seconds)}`).join(", ");
}

function formatSemantic(semantic) {
  const track = semantic?.track_path?.map((node) => node.title).join(" / ") || "Unclassified";
  const labels = (semantic?.labels ?? []).map((label) => `#${label.title}`).join(" ");
  const provenance = semantic?.provenance === "inferred-current" ? " [восстановлено]" : "";
  return `${track}${labels ? `; ${labels}` : ""}${provenance}`;
}

function formatSemanticSlices(slices) {
  if (!slices || slices.length === 0) return "Unclassified";
  return slices
    .map((slice) => `${formatSemantic(slice)} (${formatDuration(slice.active_seconds)})`)
    .join("; ");
}

function formatReportFilters(filters) {
  const parts = [];
  if (filters.track) {
    const path = filters.track.path.map((node) => node.title).join(" / ");
    parts.push(`Track: ${path}${filters.track.include_children ? " + дочерние" : ""}`);
  }
  if ((filters.labels ?? []).length > 0) parts.push(`Labels: ${filters.labels.map((label) => label.title).join(", ")}`);
  if ((filters.activity_zones ?? []).length > 0) parts.push(`Зоны: ${filters.activity_zones.map(activityZoneLabel).join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "весь период без смысловых фильтров";
}

function activityZoneLabel(zone) {
  const labels = {
    work: "Работа",
    coordination: "Координация",
    recovery: "Восстановление",
    idle: "Простой",
    personal: "Личное",
  };
  return labels[zone] ?? (zone ? `Неизвестно (${zone})` : "Не указана");
}

function gapClassificationLabel(classification) {
  const labels = {
    recovery: "восстановление",
    unmanaged: "потеря управляемости",
    idle: "простой",
    explained: "объяснён",
    unexplained: "не объяснён",
  };
  return labels[classification] ?? classification;
}

function captureStateLabel(state) {
  return { open: "открыто", resolved: "закрыто", converted: "превращено" }[state] ?? state;
}

function workItemEventKindLabel(kind) {
  return {
    created: "создано",
    updated: "обновлено",
    note_changed: "изменено описание",
    note_added: "мысль/событие",
    touched: "касание",
    state_changed: "изменён статус",
    pinned: "закреплено",
    unpinned: "откреплено",
    deleted: "удалено",
  }[kind] ?? kind;
}

function warningSeverityLabel(severity) {
  return severity === "warning" ? "Недостаточно данных" : "Проверить";
}

function decisionTypeLabel(id) {
  return DECISION_TYPES.find((item) => item.id === id)?.title ?? id;
}

function zoneSeconds(zones, zone) {
  return zones.find((item) => item.zone === zone)?.active_seconds ?? 0;
}

function localMinutes(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function extractClockRanges(text) {
  const result = [];
  const pattern = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    result.push({ from: Number(match[1]) * 60 + Number(match[2]), to: Number(match[3]) * 60 + Number(match[4]) });
  }
  return result;
}

function isGapExplanationText(text) {
  return /\bopen\s+gap\b|\bgap\b|разрыв|перерыв|буфер|recovery|восстановлен/i.test(text ?? "");
}

function classifyGapExplanation(event) {
  const text = String(event.text ?? "").toLocaleLowerCase("ru-RU");
  if (text.includes("потеря управляемости") || text.includes("не удалось восстановить управляемость")) return "unmanaged";
  if (event.activity_zone === "recovery" || text.includes("восстанов") || text.includes("recovery")) return "recovery";
  if (event.activity_zone === "idle" || text.includes("простой") || text.includes("обед") || text.includes("ужин") || text.includes("быт")) return "idle";
  return "explained";
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function escapeMarkdownList(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseJsonPayload(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function tableExists(path, tableName) {
  const rows = await sqliteJson(
    path,
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function columnExists(path, tableName, columnName) {
  if (!(await tableExists(path, tableName))) return false;
  const rows = await sqliteJson(path, `PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return rows.some((row) => row.name === columnName);
}

async function sqliteJson(path, query) {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-cmd", ".timeout 5000", "-json", path, query], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
