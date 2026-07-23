#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const [palette, memory, focus, workspace, hooks] = await Promise.all([
  readFile(resolve(repoRoot, "apps/desktop/src/components/Palette.tsx"), "utf8"),
  readFile(resolve(repoRoot, "apps/desktop/src/components/WorkingMemoryPanel.tsx"), "utf8"),
  readFile(resolve(repoRoot, "apps/desktop/src/components/FocusPanel.tsx"), "utf8"),
  readFile(resolve(repoRoot, "apps/desktop/src/components/OperationalWorkspacePanel.tsx"), "utf8"),
  readFile(resolve(repoRoot, "apps/desktop/src/hooks/useWorkingMemory.ts"), "utf8"),
]);

assert(palette.includes("<WorkingMemoryPanel"), "working-memory surface is not mounted");
assert(palette.includes("focusSession={currentFocus}"), "active focus is not passed into working memory");
assert(palette.includes("onOpenWorkingMemory={openWorkingMemory}"), "working memory is not reachable from the focus surface");
assert(palette.includes("handleFocusItem(workingMemoryItem, stageId, 'working_memory')"), "re-entry cannot start the Working Memory Work Item");
assert(palette.includes("stage_id: stageId"), "re-entry start does not preserve the chosen stage");

for (const text of [
  "Рабочая память",
  "Точка возвращения",
  "Последнее изменение",
  "Следующий шаг",
  "Добавить в память",
  "Хронология",
  "Этапы",
  "Context Pack",
  "Объединить дубль с этим делом",
  "Объединить без потери истории",
  "Начать отсюда",
]) {
  assert(memory.includes(text), `working-memory UI is missing: ${text}`);
}

assert(memory.includes("rows={7}"), "long-form editor is not large enough to be a calm writing surface");
assert(memory.includes("min-h-40 resize-y"), "long-form editor cannot be resized");
assert(memory.includes("whitespace-pre-wrap break-words"), "long-form memory can overlap or lose line breaks");
assert(memory.includes("entry.revisions.map"), "revision history is not visible");
assert(memory.includes("Удалить с историей"), "deletion does not explain historical preservation");
assert(memory.includes("Внешний текст сохраняется как данные"), "untrusted text boundary is not visible");
assert(memory.includes("work-item-reentry"), "Work Item Context Pack profile is missing");
assert(memory.includes("track-reentry"), "Track Context Pack profile is missing");
assert(memory.includes("copyContext('markdown')"), "Markdown Context Pack export is missing");
assert(memory.includes("copyContext('json')"), "JSON Context Pack export is missing");
assert(memory.includes("kind: 'context_pack_exported'"), "Context Pack export telemetry is missing");
assert(memory.includes("const [asOf, setAsOf] = useState"), "Context Pack snapshot time is not explicit state");
assert((memory.match(/refreshContext\(\)/g) ?? []).length >= 5, "Context Pack can remain stale after memory changes");
assert(memory.includes("onClick={refreshContext}"), "Context Pack has no explicit refresh action");
assert(memory.includes("max-h-[94vh]"), "working-memory modal has no stable viewport height");
assert(memory.includes("w-[min(74rem,96vw)]"), "working-memory modal has no responsive width bound");
assert(memory.includes("lg:grid-cols"), "working-memory surface has no reduced-width layout");
assert(memory.includes("min-w-0"), "working-memory columns are not protected from overflow");

for (const field of ["result", "state_change", "next_action"]) {
  assert(focus.includes(`${field}:`), `focus stop payload is missing ${field}`);
}
assert(focus.includes("сделал → изменилось → дальше"), "cheap causal trace control is missing");
assert(focus.includes("Следующий физический шаг"), "focus stop cannot preserve the next physical action");
assert(focus.includes("session.work_context?.stage_title"), "active focus does not show its stage snapshot");
assert(focus.includes("session.work_context?.daily_outcome"), "active focus does not show its daily outcome snapshot");
assert(focus.includes("Открыть рабочую память активного дела"), "active focus does not expose working memory");
assert(focus.includes("Открыть рабочую память выбранного дела"), "selected Work Item does not expose working memory");

assert(workspace.includes("DailyOutcomeFields"), "day contract has no per-direction daily outcome");
assert(workspace.includes("overflow_subjects: draft.overflow"), "day contract does not persist WIP overflow");
assert(workspace.includes("Переполнение · обязательства сверх WIP"), "WIP overflow is not visible in the editor");
assert(workspace.includes("useCreateWorkItem"), "day-contract editor cannot create a Work Item");
assert(workspace.includes("Создать дело «"), "search text cannot become a Work Item in the day contract");
assert(workspace.includes("created.reused") || workspace.includes("created.id"), "created or reused Work Item is not selected");

for (const mutation of [
  "useCreateWorkingMemory",
  "useUpdateWorkingMemory",
  "useDeleteWorkingMemory",
  "useCreateWorkItemStage",
  "useUpdateWorkItemStage",
  "useMergeWorkItems",
  "useContextPack",
]) {
  assert(hooks.includes(`export function ${mutation}`), `working-memory hook is missing: ${mutation}`);
}

console.log(JSON.stringify({ ok: true, surface: "working-memory-bridge" }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
