from __future__ import annotations

from datetime import date
from typing import Optional

from specs.v3.tools.models import MergedPlan
from specs.v3.tools.render.executive import (
    BlockSnapshot,
    ExecConfigError,
    _block_mgmt,
    _build_snapshot,
    _current_main_block_id,
    _exec_cfg,
    _exec_views,
)

HEALTH_BADGES = {
    "green": "🟢",
    "yellow": "🟡",
    "red": "🔴",
    "neutral": "⚪",
}

REPORT_LABELS = {
    "ru": {
        "dependency_prefix": "Зависимость: ",
        "track_header": "| Трек | Состояние | Ближайшая веха | Что сейчас происходит | Что должно сдвинуться к следующему синку |",
        "signals_header": "| Трек | Сигнал | Почему не green / в чём зависимость | К какой вехе это относится |",
        "date_holders_title": "### Держатели дат",
        "strategic_title": "### Стратегические треки",
        "committed": "Обещанная дата",
        "forecast": "Текущий прогноз",
        "deviation": "Отклонение",
        "nearest_goal": "Ближайшая цель",
        "success_by_next_sync": "Что считаем успехом к следующему синку",
        "current_stage": "Текущий этап",
        "control_point": "Ближайшая контрольная точка",
        "next_step": "Ближайший главный шаг",
        "all_done": "Все основные этапы завершены",
        "days": "дней",
        "date_format": "%d.%m.%Y",
        "no_signals": "Сейчас в основных треках нет явных yellow/red сигналов или отдельно зафиксированных зависимостей.",
        "unknown_section": "Неизвестная секция executive-report",
    },
    "en": {
        "dependency_prefix": "Dependency: ",
        "track_header": "| Track | State | Nearest gate | Current signal | Next sync goal |",
        "signals_header": "| Track | Signal | Why not green / dependency | Related gate |",
        "date_holders_title": "### Date-holders",
        "strategic_title": "### Strategic tracks",
        "committed": "Committed date",
        "forecast": "Current forecast",
        "deviation": "Deviation",
        "nearest_goal": "Nearest goal",
        "success_by_next_sync": "Success by next sync",
        "current_stage": "Current stage",
        "control_point": "Nearest control point",
        "next_step": "Next main step",
        "all_done": "All main stages are done",
        "days": "days",
        "date_format": "%Y-%m-%d",
        "no_signals": "There are no explicit yellow/red signals or dependencies in the selected tracks.",
        "unknown_section": "Unknown executive-report section",
    },
}


def _labels(lang: str) -> dict[str, str]:
    if lang not in REPORT_LABELS:
        raise ExecConfigError(f"Unsupported executive-report language: {lang}")
    return REPORT_LABELS[lang]


def _compact_text(value: object) -> str:
    return " ".join(str(value).splitlines())


def _table_cell(value: object) -> str:
    return _compact_text(value).replace("|", "\\|")


def _parse_iso_date(value: str | None) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _format_date(value: str | None, labels: dict[str, str]) -> str:
    parsed = _parse_iso_date(value)
    if parsed is None:
        return value or "—"
    return parsed.strftime(labels["date_format"])


def _view_snapshots(plan: MergedPlan, view_id: str) -> tuple[list[str], dict[str, BlockSnapshot]]:
    view = _exec_views(plan).get(view_id)
    if not isinstance(view, dict):
        raise ExecConfigError(f"Executive view '{view_id}' не найден")
    block_ids = view.get("blocks")
    if not isinstance(block_ids, list) or not all(isinstance(v, str) for v in block_ids):
        raise ExecConfigError(f"Executive view '{view_id}' должен содержать blocks: list[string]")
    cache: dict[str, BlockSnapshot] = {}
    snapshots = {block_id: _build_snapshot(plan, block_id, cache) for block_id in block_ids}
    return block_ids, snapshots


def _gate_text(plan: MergedPlan, snapshot: BlockSnapshot, labels: dict[str, str]) -> str:
    if not snapshot.target_gate:
        return "—"
    gate = plan.nodes.get(snapshot.target_gate)
    gate_title = _compact_text(gate.title if gate and gate.title else snapshot.target_gate)
    return f"{_format_date(snapshot.gate_date_text, labels)} — {gate_title}"


def _signal_label(health: str, blocker_note: str) -> str:
    if health in HEALTH_BADGES:
        return HEALTH_BADGES[health]
    if blocker_note:
        return "🔗"
    return health or "—"


def _health_badge(health: str) -> str:
    return HEALTH_BADGES.get(health, health or "—")


def _signal_detail(mgmt: dict[str, str], labels: dict[str, str]) -> str:
    parts: list[str] = []
    if mgmt.get("health_note"):
        parts.append(mgmt["health_note"])
    if mgmt.get("blocker_note"):
        parts.append(f"{labels['dependency_prefix']}{mgmt['blocker_note']}")
    return " ".join(parts) or "—"


def _track_rows(
    plan: MergedPlan,
    block_ids: list[str],
    snapshots: dict[str, BlockSnapshot],
    blocks: dict[str, object],
    labels: dict[str, str],
) -> list[str]:
    rows: list[str] = []
    for block_id in block_ids:
        block = blocks.get(block_id, {})
        mgmt = _block_mgmt(block if isinstance(block, dict) else {})
        snapshot = snapshots[block_id]
        rows.append(
            "| {title} | {health} | {gate} | {sync} | {goal} |".format(
                title=_table_cell(snapshot.title),
                health=_health_badge(mgmt.get("health") or ""),
                gate=_table_cell(_gate_text(plan, snapshot, labels)),
                sync=_table_cell(mgmt.get("sync_note") or "—"),
                goal=_table_cell(mgmt.get("next_sync_goal") or "—"),
            )
        )
    return rows


def _track_table(
    plan: MergedPlan,
    block_ids: list[str],
    snapshots: dict[str, BlockSnapshot],
    blocks: dict[str, object],
    labels: dict[str, str],
) -> str:
    lines = [
        labels["track_header"],
        "|---|---|---|---|---|",
        *_track_rows(plan, block_ids, snapshots, blocks, labels),
    ]
    return "\n".join(lines)


def _signal_rows(
    plan: MergedPlan,
    block_ids: list[str],
    snapshots: dict[str, BlockSnapshot],
    blocks: dict[str, object],
    labels: dict[str, str],
) -> list[str]:
    rows: list[str] = []
    for block_id in block_ids:
        block = blocks.get(block_id, {})
        mgmt = _block_mgmt(block if isinstance(block, dict) else {})
        health = mgmt.get("health", "")
        blocker_note = mgmt.get("blocker_note", "")
        if health in {"green", "neutral"} and not blocker_note:
            continue
        snapshot = snapshots[block_id]
        rows.append(
            "| {title} | {signal} | {detail} | {gate} |".format(
                title=_table_cell(snapshot.title),
                signal=_signal_label(health, blocker_note),
                detail=_table_cell(_signal_detail(mgmt, labels)),
                gate=_table_cell(_gate_text(plan, snapshot, labels)),
            )
        )
    return rows


def render_executive_report(
    plan: MergedPlan,
    section: str,
    *,
    view_id: str | None = None,
    lang: str = "ru",
) -> str:
    exec_cfg = _exec_cfg(plan)
    program = exec_cfg.get("program") if isinstance(exec_cfg.get("program"), dict) else {}
    labels = _labels(lang)

    if section == "status":
        status_view_id = view_id or "exec-top"
        top_ids, top_snapshots = _view_snapshots(plan, status_view_id)
        top_view = _exec_views(plan).get(status_view_id) if isinstance(_exec_views(plan), dict) else {}
        color_mode = str(top_view.get("color_mode") or "status") if isinstance(top_view, dict) else "status"
        blocks = exec_cfg.get("blocks", {}) if isinstance(exec_cfg.get("blocks"), dict) else {}
        current_block_id = _current_main_block_id(top_ids, top_snapshots, blocks, color_mode=color_mode)
        committed_date = program.get("committed_date") if isinstance(program.get("committed_date"), str) else None

        prod_gate_date = None
        if "prod" in top_snapshots:
            prod_gate_date = top_snapshots["prod"].gate_date_text
        else:
            for block_id in reversed(top_ids):
                snapshot = top_snapshots[block_id]
                if snapshot.kind == "risk_sidecar":
                    continue
                if snapshot.target_gate:
                    prod_gate_date = snapshot.gate_date_text
                    break

        committed = _parse_iso_date(committed_date)
        forecast = _parse_iso_date(prod_gate_date)
        if committed and forecast:
            delta_days = (forecast - committed).days
            deviation = f"{delta_days:+d} {labels['days']}"
        else:
            deviation = "—"

        if current_block_id:
            current_snapshot = top_snapshots[current_block_id]
            current_title = _compact_text(current_snapshot.title)
            control_point = _gate_text(plan, current_snapshot, labels)
            current_block_cfg = exec_cfg.get("blocks", {}).get(current_block_id, {})
            current_mgmt = _block_mgmt(current_block_cfg if isinstance(current_block_cfg, dict) else {})
            next_goal = current_mgmt.get("next_sync_goal") or "—"
        else:
            current_title = labels["all_done"]
            control_point = "—"
            next_goal = "—"

        nearest_goal = program.get("nearest_goal") if isinstance(program.get("nearest_goal"), str) else None
        success_by_next_sync = (
            program.get("success_by_next_sync")
            if isinstance(program.get("success_by_next_sync"), str)
            else None
        )

        lines = [
            f"- {labels['committed']}: `{_format_date(committed_date, labels)}`",
            f"- {labels['forecast']}: `{_format_date(prod_gate_date, labels)}`",
            f"- {labels['deviation']}: `{deviation}`",
        ]
        if nearest_goal:
            lines.append(f"- {labels['nearest_goal']}: {nearest_goal}")
        if success_by_next_sync:
            lines.append(f"- {labels['success_by_next_sync']}: {success_by_next_sync}")
        lines.extend(
            [
                f"- {labels['current_stage']}: `{current_title}`",
                f"- {labels['control_point']}: `{control_point}`",
                f"- {labels['next_step']}: {next_goal}",
            ]
        )
        return "\n".join(lines)

    if section == "tracks":
        blocks = exec_cfg.get("blocks", {})
        tracks_view_id = view_id or "exec-active-tracks"
        block_ids, snapshots = _view_snapshots(plan, tracks_view_id)
        lines = [labels["date_holders_title"], "", _track_table(plan, block_ids, snapshots, blocks, labels)]

        strategic_view = _exec_views(plan).get("exec-strategic-tracks") if view_id is None else None
        if isinstance(strategic_view, dict):
            strategic_ids, strategic_snapshots = _view_snapshots(plan, "exec-strategic-tracks")
            if strategic_ids:
                lines.extend(
                    [
                        "",
                        labels["strategic_title"],
                        "",
                        _track_table(plan, strategic_ids, strategic_snapshots, blocks, labels),
                    ]
                )
        return "\n".join(lines)

    if section == "signals":
        blocks = exec_cfg.get("blocks", {})
        tracks_view_id = view_id or "exec-active-tracks"
        block_ids, snapshots = _view_snapshots(plan, tracks_view_id)
        all_ids = list(block_ids)
        all_snapshots = dict(snapshots)

        strategic_view = _exec_views(plan).get("exec-strategic-tracks") if view_id is None else None
        if isinstance(strategic_view, dict):
            strategic_ids, strategic_snapshots = _view_snapshots(plan, "exec-strategic-tracks")
            for block_id in strategic_ids:
                if block_id not in all_snapshots:
                    all_ids.append(block_id)
                    all_snapshots[block_id] = strategic_snapshots[block_id]

        rows = _signal_rows(plan, all_ids, all_snapshots, blocks, labels)
        if not rows:
            return labels["no_signals"]
        lines = [
            labels["signals_header"],
            "|---|---|---|---|",
            *rows,
        ]
        return "\n".join(lines)

    raise ExecConfigError(f"{labels['unknown_section']}: {section}")
