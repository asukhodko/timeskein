#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const [palette, workspace, focusPanel] = await Promise.all([
  readFile(resolve(repoRoot, "apps/desktop/src/components/Palette.tsx"), "utf8"),
  readFile(resolve(repoRoot, "apps/desktop/src/components/OperationalWorkspacePanel.tsx"), "utf8"),
  readFile(resolve(repoRoot, "apps/desktop/src/components/FocusPanel.tsx"), "utf8"),
]);

assert(palette.includes("<OperationalWorkspacePanel />"), "primary workspace is not mounted");
assert(!palette.includes("<OperationalRealityPanel />"), "old independent Operational Reality surface remains mounted");
assert(palette.includes("inventoryExpanded ? selectedItem : undefined"), "hidden inventory still controls the primary focus panel");
assert(palette.includes("function readInventoryExpanded"), "inventory secondary-surface state is not persisted");
assert(!focusPanel.includes("<DispatchRitualPanel"), "shadow text dispatch backlog remains in the primary path");
assert(workspace.includes("firstActionButtonLabel"), "first-action control is not context-aware");
assert(!workspace.includes("onClick={() => startFirstAction(true)}"), "duplicate reentry action remains visible beside the primary start action");

for (const text of [
  "Собрать договор дня",
  "Изменить договор",
  "Пересмотреть после перерыва",
  "Начать первое действие",
  "Вернуться по договору",
  "История договора",
  "lg:grid-cols",
  "min-w-0",
  "break-words",
]) {
  assert(workspace.includes(text), `workspace UI is missing: ${text}`);
}

console.log(JSON.stringify({ ok: true, surface: "operational-workspace" }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
