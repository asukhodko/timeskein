"""
Gantt renderer for opskarta v3 plans.

This module generates Mermaid Gantt diagrams from MergedPlan objects
and keeps legacy-friendly visual semantics for status styling.

Behavior highlights:
- Uses schedule (computed_start/computed_finish) as date source
- Applies view.where filter when view_id is provided
- Supports date/axis/tick format settings from view
- For views with lanes, renders only explicitly listed lane nodes
  (no implicit "Other" section)
- Supports style modes:
  - plain: neutral output (default)
  - status: Mermaid init + status tags/emoji
"""

import json
import re
from datetime import date
from typing import Optional

from specs.v3.tools.models import Calendar, MergedPlan, ScheduleNode, View
from specs.v3.tools.render.common import (
    apply_view_filter,
    get_descendants,
    sanitize_mermaid_text,
)


RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DEFAULT_STATUS_COLORS = {
    "not_started": "#9ca3af",
    "planned": "#aad2e6",
    "in_progress": "#0ea5e9",
    "done": "#22c55e",
    "blocked": "#fecaca",
}

STATUS_TO_TAG = {
    "in_progress": "active",
    "done": "done",
    "blocked": "crit",
}

STATUS_TO_EMOJI = {
    "done": "✅",
    "in_progress": "🔄",
    "blocked": "⛔",
}


# Re-export for backward compatibility with existing test imports

def _get_descendants(plan: MergedPlan, parent_id: str) -> set[str]:
    return get_descendants(plan, parent_id)


def _sanitize_task_id(node_id: str) -> str:
    return node_id.replace(".", "_").replace("-", "_")


def _status_color(plan: MergedPlan, status_key: str) -> str:
    status = plan.statuses.get(status_key)
    if status and status.color:
        return status.color
    return DEFAULT_STATUS_COLORS.get(status_key, "#9ca3af")


def _build_gantt_init_block(plan: MergedPlan) -> str:
    theme_vars = {
        "taskBkgColor": _status_color(plan, "not_started"),
        "taskBorderColor": "#4b5563",
        "taskTextColor": "#000000",
        "taskTextDarkColor": "#000000",
        "taskTextLightColor": "#000000",
        "activeTaskBkgColor": _status_color(plan, "in_progress"),
        "activeTaskBorderColor": _status_color(plan, "in_progress"),
        "doneTaskBkgColor": _status_color(plan, "done"),
        "doneTaskBorderColor": "#16a34a",
        "critBkgColor": _status_color(plan, "blocked"),
        "critBorderColor": _status_color(plan, "blocked"),
        "todayLineColor": "#ef4444",
    }
    cfg = {"theme": "base", "themeVariables": theme_vars}
    return f"%%{{init: {json.dumps(cfg, ensure_ascii=False)} }}%%"


def _task_title_with_status(title: str, status: str, style: str) -> str:
    clean_title = sanitize_mermaid_text(title)
    if style != "status":
        return clean_title
    emoji = STATUS_TO_EMOJI.get(status)
    if emoji:
        return f"{emoji} {clean_title}"
    return clean_title


def _build_task_meta(node_id: str, status: str, milestone: bool, style: str) -> str:
    tags: list[str] = []
    if milestone:
        tags.append("milestone")

    if style == "status":
        status_tag = STATUS_TO_TAG.get(status)
        if status_tag:
            tags.append(status_tag)

    tags.append(_sanitize_task_id(node_id))
    return ", ".join(tags)


def _pick_gantt_calendar(plan: MergedPlan) -> Optional[Calendar]:
    if plan.schedule is None:
        return None

    calendars = plan.schedule.calendars
    if not calendars:
        return None

    default_id = plan.schedule.default_calendar
    if default_id:
        return calendars.get(default_id)

    if len(calendars) == 1:
        return next(iter(calendars.values()))

    return None


def _canonical_excludes_tokens(plan: MergedPlan) -> list[str]:
    calendar = _pick_gantt_calendar(plan)
    if calendar is None:
        return []

    has_weekends = False
    date_tokens: set[str] = set()

    for token in calendar.excludes:
        if token == "weekends":
            has_weekends = True
            continue
        if RE_DATE.match(token):
            date_tokens.add(token)

    result: list[str] = []
    if has_weekends:
        result.append("weekends")
    result.extend(sorted(date_tokens))
    return result


def _append_task_line(
    node_id: str,
    node,
    schedule_node: Optional[ScheduleNode],
    start: str,
    finish: str,
    lines: list[str],
    style: str,
) -> None:
    status = (node.status or "").strip()
    title = _task_title_with_status(node.title, status, style)

    if not start or not finish:
        return

    meta = _build_task_meta(node_id, status, bool(node.milestone), style)

    if node.milestone:
        lines.append(f"    {title}  :{meta},    {start}, 0d")
    elif (
        schedule_node is not None
        and schedule_node.duration
        and schedule_node.computed_start == start
        and schedule_node.computed_finish == finish
    ):
        lines.append(f"    {title}  :{meta},    {start}, {schedule_node.duration}")
    else:
        lines.append(f"    {title}  :{meta},    {start}, {finish}")


def _parse_view_window(view: View) -> tuple[Optional[date], Optional[date]]:
    window_start = date.fromisoformat(view.window_start) if view.window_start else None
    window_finish = date.fromisoformat(view.window_finish) if view.window_finish else None
    return window_start, window_finish


def _clip_task_dates(
    sn: ScheduleNode,
    window_start: Optional[date],
    window_finish: Optional[date],
) -> Optional[tuple[str, str]]:
    start = sn.computed_start
    finish = sn.computed_finish
    if not start or not finish:
        return None

    start_date = date.fromisoformat(start)
    finish_date = date.fromisoformat(finish)

    if window_start and finish_date < window_start:
        return None
    if window_finish and start_date > window_finish:
        return None

    if window_start and start_date < window_start:
        start_date = window_start
    if window_finish and finish_date > window_finish:
        finish_date = window_finish

    if finish_date < start_date:
        return None

    return start_date.isoformat(), finish_date.isoformat()


def _expand_lane_nodes(
    plan: MergedPlan,
    lane_nodes: list[str],
    expand_descendants: Optional[str],
) -> list[str]:
    if expand_descendants != "leaves":
        return lane_nodes

    parent_ids = {node.parent for node in plan.nodes.values() if node.parent}
    ordered_node_ids = list(plan.nodes.keys())
    expanded: list[str] = []
    seen: set[str] = set()

    for node_id in lane_nodes:
        if node_id not in plan.nodes:
            continue

        if node_id not in parent_ids:
            if node_id not in seen:
                expanded.append(node_id)
                seen.add(node_id)
            continue

        descendants = get_descendants(plan, node_id)
        for candidate_id in ordered_node_ids:
            if candidate_id not in descendants:
                continue
            if candidate_id in parent_ids:
                continue
            if candidate_id in seen:
                continue
            expanded.append(candidate_id)
            seen.add(candidate_id)

    return expanded


def render_gantt(plan: MergedPlan, view_id: str, style: str = "plain") -> str:
    lines: list[str] = []

    if style not in {"plain", "status"}:
        raise ValueError(f"Unsupported gantt style '{style}', expected 'plain' or 'status'")

    if not view_id:
        raise ValueError("View id is required for gantt rendering")
    view = plan.views.get(view_id)
    if view is None:
        raise ValueError(f"View '{view_id}' not found")

    if style == "status":
        lines.append(_build_gantt_init_block(plan))
        lines.append("")
    lines.append("gantt")

    title = None
    if view.title:
        title = view.title
    elif plan.meta and plan.meta.title:
        title = plan.meta.title

    if title:
        lines.append(f"    title {sanitize_mermaid_text(title)}")

    date_format = "YYYY-MM-DD"
    if view.date_format:
        date_format = view.date_format
    lines.append(f"    dateFormat {date_format}")

    if view.axis_format:
        lines.append(f"    axisFormat {view.axis_format}")

    # Warning: "tickInterval" is not supported by old versions of Mermaid render:
    if view.tick_interval:
        lines.append(f"    tickInterval {view.tick_interval}")

    exclude_tokens = _canonical_excludes_tokens(plan)
    if exclude_tokens:
        lines.append(f"    excludes {' '.join(exclude_tokens)}")

    lines.append("")

    if plan.schedule is None:
        return "\n".join(lines)

    scheduled_node_ids = list(plan.schedule.nodes.keys())

    if view.where:
        scheduled_node_ids = apply_view_filter(plan, scheduled_node_ids, view.where)

    window_start, window_finish = _parse_view_window(view)
    clipped_dates: dict[str, tuple[str, str]] = {}
    nodes_with_dates = []
    for node_id in scheduled_node_ids:
        sn = plan.schedule.nodes.get(node_id)
        if not sn:
            continue
        clipped = _clip_task_dates(sn, window_start, window_finish)
        if not clipped:
            continue
        clipped_dates[node_id] = clipped
        nodes_with_dates.append(node_id)

    if not nodes_with_dates:
        return "\n".join(lines)

    if view.group_by == "parent":
        _render_grouped_by_parent(plan, nodes_with_dates, clipped_dates, lines, style)
    elif view.lanes:
        _render_with_lanes(plan, nodes_with_dates, clipped_dates, view.lanes, lines, view_id, style)
    else:
        _render_flat(plan, nodes_with_dates, clipped_dates, lines, style)

    return "\n".join(lines)


def _render_flat(
    plan: MergedPlan,
    node_ids: list[str],
    clipped_dates: dict[str, tuple[str, str]],
    lines: list[str],
    style: str,
) -> None:
    for node_id in node_ids:
        node = plan.nodes.get(node_id)
        schedule_node = plan.schedule.nodes.get(node_id) if plan.schedule else None

        if node is None:
            continue

        start, finish = clipped_dates[node_id]
        _append_task_line(node_id, node, schedule_node, start, finish, lines, style)


def _render_grouped_by_parent(
    plan: MergedPlan,
    node_ids: list[str],
    clipped_dates: dict[str, tuple[str, str]],
    lines: list[str],
    style: str,
) -> None:
    parent_groups: dict[Optional[str], list[str]] = {}

    for node_id in node_ids:
        node = plan.nodes.get(node_id)
        if node is None:
            continue

        parent_id = node.parent
        if parent_id not in parent_groups:
            parent_groups[parent_id] = []
        parent_groups[parent_id].append(node_id)

    for parent_id, children in parent_groups.items():
        if parent_id:
            parent_node = plan.nodes.get(parent_id)
            section_title = parent_node.title if parent_node else parent_id
        else:
            section_title = "Tasks"

        lines.append(f"    section {sanitize_mermaid_text(section_title)}")

        for node_id in children:
            node = plan.nodes.get(node_id)
            schedule_node = plan.schedule.nodes.get(node_id) if plan.schedule else None

            if node is None:
                continue

            start, finish = clipped_dates[node_id]
            _append_task_line(node_id, node, schedule_node, start, finish, lines, style)


def _render_with_lanes(
    plan: MergedPlan,
    node_ids: list[str],
    clipped_dates: dict[str, tuple[str, str]],
    lanes: dict,
    lines: list[str],
    view_id: str,
    style: str,
) -> None:
    node_ids_set = set(node_ids)

    for lane_id, lane_config in lanes.items():
        if not isinstance(lane_config, dict):
            raise ValueError(f"View '{view_id}' lane '{lane_id}' must be an object")

        lane_nodes = lane_config.get("nodes")
        if not isinstance(lane_nodes, list):
            raise ValueError(f"View '{view_id}' lane '{lane_id}' must contain nodes: list[string]")

        expand_descendants = lane_config.get("expand_descendants")
        resolved_lane_nodes = _expand_lane_nodes(plan, lane_nodes, expand_descendants)
        lane_title = lane_config.get("title", lane_id)
        visible_lane_nodes = [node_id for node_id in resolved_lane_nodes if node_id in node_ids_set]
        if not visible_lane_nodes:
            continue

        lines.append(f"    section {sanitize_mermaid_text(str(lane_title))}")

        for idx, node_id in enumerate(visible_lane_nodes):
            if not isinstance(node_id, str):
                raise ValueError(
                    f"View '{view_id}' lane '{lane_id}' has invalid nodes[{idx}] type: {type(node_id).__name__}"
                )
            if node_id not in plan.nodes:
                raise ValueError(
                    f"View '{view_id}' lane '{lane_id}' references non-existent node '{node_id}'"
                )

            node = plan.nodes.get(node_id)
            schedule_node = plan.schedule.nodes.get(node_id) if plan.schedule else None

            if node is None:
                continue

            start, finish = clipped_dates[node_id]
            _append_task_line(node_id, node, schedule_node, start, finish, lines, style)
