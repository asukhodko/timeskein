from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

from specs.v3.tools.models import MergedPlan
from specs.v3.tools.render.common import escape_mermaid_string, get_descendants, sanitize_mermaid_text
from specs.v3.tools.scheduler import parse_duration

DEFAULT_STATUS_COLORS = {
    "not_started": "#9ca3af",
    "planned": "#aad2e6",
    "in_progress": "#0ea5e9",
    "done": "#22c55e",
    "blocked": "#fecaca",
}
LEAF_KINDS = {"task", "bug"}
DEFAULT_PROGRESS_BY_STATUS = {
    "done": 1.0,
    "in_progress": 0.5,
    "planned": 0.0,
    "not_started": 0.0,
    "blocked": 0.0,
}
DEFAULT_MGMT_HEALTH_COLORS = {
    "green": "#86efac",
    "yellow": "#fde68a",
    "red": "#fca5a5",
    "neutral": "#d1d5db",
}
VALID_MGMT_HEALTH = set(DEFAULT_MGMT_HEALTH_COLORS.keys())
DEFAULT_NEUTRAL_COLOR = "#d1d5db"


@dataclass
class BlockSnapshot:
    block_id: str
    title: str
    target_gate: Optional[str]
    gate_date_text: str
    progress: Optional[float]
    is_approximate: bool
    state: str
    kind: str


class ExecConfigError(ValueError):
    pass


def _block_mgmt(block: dict[str, Any]) -> dict[str, str]:
    mgmt = block.get("mgmt")
    if not isinstance(mgmt, dict):
        return {}
    result: dict[str, str] = {}
    for key in ["health", "health_note", "sync_note", "next_sync_goal", "blocker_note", "owner"]:
        value = mgmt.get(key)
        if isinstance(value, str):
            result[key] = value.strip()
    return result


def _has_mgmt_signal(mgmt: dict[str, str]) -> bool:
    return any(mgmt.get(key) for key in ["health_note", "sync_note", "next_sync_goal", "blocker_note"])


def _current_main_block_id(
    block_ids: list[str],
    snapshots: dict[str, BlockSnapshot],
    blocks: Optional[dict[str, dict[str, Any]]] = None,
    *,
    color_mode: str = "status",
) -> Optional[str]:
    fallback: Optional[str] = None
    for block_id in block_ids:
        snapshot = snapshots[block_id]
        if snapshot.kind == "risk_sidecar":
            continue
        if snapshot.state != "done":
            if fallback is None:
                fallback = block_id
            if color_mode != "mgmt_hybrid" or not blocks:
                return block_id
            block = blocks.get(block_id) or {}
            mgmt = _block_mgmt(block if isinstance(block, dict) else {})
            if mgmt.get("health") in {"yellow", "red"}:
                return block_id
    return fallback


def _sanitize_id(value: str) -> str:
    result = []
    for char in value:
        if char.isalnum() or char == "_":
            result.append(char)
        else:
            result.append("_")
    token = "".join(result) or "x"
    if token[0].isdigit():
        token = f"_{token}"
    return token


def _exec_cfg(plan: MergedPlan) -> dict[str, Any]:
    cfg = (plan.x or {}).get("exec")
    if not isinstance(cfg, dict):
        raise ExecConfigError("В плане не найден корректный x.exec")
    return cfg


def _exec_blocks(plan: MergedPlan) -> dict[str, dict[str, Any]]:
    cfg = _exec_cfg(plan)
    blocks = cfg.get("blocks")
    if not isinstance(blocks, dict):
        raise ExecConfigError("x.exec.blocks должен быть объектом")
    return blocks


def _exec_views(plan: MergedPlan) -> dict[str, dict[str, Any]]:
    cfg = _exec_cfg(plan)
    views = cfg.get("views")
    if not isinstance(views, dict):
        raise ExecConfigError("x.exec.views должен быть объектом")
    return views


def _defaults(plan: MergedPlan) -> tuple[dict[str, float], str]:
    cfg = _exec_cfg(plan)
    defaults = cfg.get("defaults") or {}
    status_progress = dict(DEFAULT_PROGRESS_BY_STATUS)
    custom = defaults.get("status_progress")
    if isinstance(custom, dict):
        for status, value in custom.items():
            if isinstance(status, str) and isinstance(value, (int, float)):
                status_progress[status] = float(value)
    weight_strategy = str(defaults.get("weight_strategy") or "effort_effective")
    return status_progress, weight_strategy


def _node_gate_date(plan: MergedPlan, node_id: str) -> str:
    if plan.schedule is None:
        return "без даты"
    sn = plan.schedule.nodes.get(node_id)
    if sn is None:
        return "без даты"
    start = sn.computed_start or sn.start
    finish = sn.computed_finish or sn.finish
    if start and finish and start != finish:
        return f"{start}..{finish}"
    return finish or start or "без даты"


def _leaf_ids(plan: MergedPlan, scope_nodes: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []

    def add_leaf(candidate_id: str) -> None:
        if candidate_id in seen:
            return
        node = plan.nodes.get(candidate_id)
        if node is None:
            return
        if node.kind not in LEAF_KINDS:
            return
        if any(other.parent == candidate_id for other in plan.nodes.values()):
            return
        seen.add(candidate_id)
        result.append(candidate_id)

    for node_id in scope_nodes:
        if node_id not in plan.nodes:
            continue
        add_leaf(node_id)
        for descendant_id in get_descendants(plan, node_id):
            add_leaf(descendant_id)
    return result


def _leaf_progress(plan: MergedPlan, node_id: str, progress_by_status: dict[str, float]) -> tuple[float, bool]:
    if plan.execution and node_id in plan.execution.nodes:
        en = plan.execution.nodes[node_id]
        if en.progress is not None:
            return float(en.progress), False
    status = (plan.nodes[node_id].status or "not_started").strip()
    return float(progress_by_status.get(status, 0.0)), True


def _leaf_weight(plan: MergedPlan, node_id: str, weight_strategy: str) -> float:
    node = plan.nodes[node_id]
    if weight_strategy == "effort_effective":
        effort = node.effort_effective if node.effort_effective is not None else node.effort
        if isinstance(effort, (int, float)) and effort > 0:
            return float(effort)

    if plan.schedule is not None:
        sn = plan.schedule.nodes.get(node_id)
        if sn and sn.duration:
            duration_days = parse_duration(sn.duration)
            if duration_days and duration_days > 0:
                return float(duration_days)

    return 1.0


def _status_color(plan: MergedPlan, status_key: str) -> str:
    status = plan.statuses.get(status_key)
    if status and status.color:
        return status.color
    return DEFAULT_STATUS_COLORS.get(status_key, "#9ca3af")


def _round_progress(value: float) -> int:
    return int(round(value * 20) * 5)


def _format_progress(value: Optional[float], approximate: bool) -> str:
    if value is None:
        return "n/a"
    prefix = "~" if approximate else ""
    return f"{prefix}{_round_progress(value)}%"


def _wrap_title_two_lines(title: str) -> str:
    words = title.split()
    if len(words) < 2:
        return title

    best_split = None
    best_delta = None
    for idx in range(1, len(words)):
        left = " ".join(words[:idx])
        right = " ".join(words[idx:])
        delta = abs(len(left) - len(right))
        if best_delta is None or delta < best_delta:
            best_delta = delta
            best_split = (left, right)

    if best_split is None:
        return title
    left, right = best_split
    return f"{left}<br/>{right}"


def _format_label(
    snapshot: BlockSnapshot,
    *,
    show_progress: bool,
    show_gate_date: bool,
    show_owner: bool,
    owner: str | None,
    wrap_title_lines: int,
) -> str:
    parts: list[str] = []
    if show_owner and owner:
        parts.append(sanitize_mermaid_text(f"Ответственный {owner}"))
    title = sanitize_mermaid_text(snapshot.title)
    if wrap_title_lines >= 2:
        title = _wrap_title_two_lines(title)
    parts.append(title)
    if show_progress:
        parts.append(_format_progress(snapshot.progress, snapshot.is_approximate))
    if show_gate_date and snapshot.target_gate:
        gate_label = "окно" if ".." in snapshot.gate_date_text else "веха"
        parts.append(f"{gate_label} {snapshot.gate_date_text}")
    return escape_mermaid_string("<br/>".join(parts))


def _visible_required_edges(
    edges: list[Any],
    visible_block_ids: set[str],
) -> list[tuple[int, str, str]]:
    result: list[tuple[int, str, str]] = []
    for edge_idx, edge in enumerate(edges):
        if not isinstance(edge, dict):
            continue
        src = edge.get("from")
        dst = edge.get("to")
        edge_type = str(edge.get("type") or "required")
        if edge_type != "required":
            continue
        if not isinstance(src, str) or not isinstance(dst, str):
            continue
        if src not in visible_block_ids or dst not in visible_block_ids:
            continue
        result.append((edge_idx, src, dst))
    return result


def _reachable_via_required(
    adjacency: dict[str, list[str]],
    start: str,
    target: str,
) -> bool:
    queue = deque([start])
    visited = {start}

    while queue:
        node_id = queue.popleft()
        for next_id in adjacency.get(node_id, []):
            if next_id == target:
                return True
            if next_id in visited:
                continue
            visited.add(next_id)
            queue.append(next_id)
    return False


def _has_transitive_required_path(
    required_edges: list[tuple[int, str, str]],
    src: str,
    dst: str,
    *,
    excluded_edge_idx: int,
) -> bool:
    adjacency: dict[str, list[str]] = {}
    for edge_idx, edge_src, edge_dst in required_edges:
        if edge_idx == excluded_edge_idx:
            continue
        adjacency.setdefault(edge_src, []).append(edge_dst)

    for mid in adjacency.get(src, []):
        if mid == dst:
            continue
        if _reachable_via_required(adjacency, mid, dst):
            return True
    return False


def _edge_label(edge: dict[str, Any]) -> Optional[str]:
    value = edge.get("label")
    if not isinstance(value, str):
        return None
    cleaned = sanitize_mermaid_text(value)
    return cleaned or None


def _block_class_name(
    plan: MergedPlan,
    block_id: str,
    snapshot: BlockSnapshot,
    *,
    color_mode: str,
    current_block_id: Optional[str],
    respect_mgmt_health_for_done: bool = False,
) -> str:
    if color_mode != "mgmt_hybrid":
        return f"exec_{snapshot.state}"

    if snapshot.state == "done":
        blocks = _exec_blocks(plan)
        block = blocks.get(block_id) or {}
        mgmt = _block_mgmt(block if isinstance(block, dict) else {})
        health = mgmt.get("health")
        if respect_mgmt_health_for_done and health in VALID_MGMT_HEALTH:
            if health == "neutral":
                return "exec_mgmt_neutral"
            return f"exec_mgmt_{health}"
        return "exec_done"

    blocks = _exec_blocks(plan)
    block = blocks.get(block_id) or {}
    mgmt = _block_mgmt(block)
    health = mgmt.get("health", "green")
    if health not in VALID_MGMT_HEALTH:
        health = "green"
    if health == "neutral":
        return "exec_mgmt_neutral"

    is_active = snapshot.state != "not_started" or block_id == current_block_id or _has_mgmt_signal(mgmt)
    if not is_active:
        return "exec_mgmt_neutral"
    if snapshot.state == "blocked":
        return "exec_mgmt_red"
    return f"exec_mgmt_{health}"


def _aggregate_state_from_children(children: list[BlockSnapshot], progress: Optional[float], gate_done: bool) -> str:
    if gate_done or progress == 1.0:
        return "done"
    if any(child.state == "blocked" for child in children):
        return "blocked"
    if progress and progress > 0:
        return "in_progress"
    return "not_started"


def _scope_state(plan: MergedPlan, leaf_ids: list[str], progress: Optional[float], gate_done: bool) -> str:
    if gate_done or progress == 1.0:
        return "done"
    if any((plan.nodes[leaf_id].status or "").strip() == "blocked" for leaf_id in leaf_ids):
        return "blocked"
    if progress and progress > 0:
        return "in_progress"
    return "not_started"


def _build_snapshot(plan: MergedPlan, block_id: str, cache: dict[str, BlockSnapshot]) -> BlockSnapshot:
    if block_id in cache:
        return cache[block_id]

    blocks = _exec_blocks(plan)
    block = blocks.get(block_id)
    if not isinstance(block, dict):
        raise ExecConfigError(f"Executive block '{block_id}' не найден")

    title = str(block.get("title") or block_id)
    target_gate = block.get("target_gate") if isinstance(block.get("target_gate"), str) else None
    gate_date_text = _node_gate_date(plan, target_gate) if target_gate else "без даты"
    kind = str(block.get("kind") or "main")
    gate_done = bool(target_gate and (plan.nodes.get(target_gate) and plan.nodes[target_gate].status == "done"))

    override = block.get("progress_override")
    progress_by_status, weight_strategy = _defaults(plan)

    if isinstance(block.get("source_blocks"), list):
        children = [
            _build_snapshot(plan, child_id, cache)
            for child_id in block["source_blocks"]
            if isinstance(child_id, str)
        ]
        if isinstance(override, (int, float)):
            progress = float(override)
            approximate = False
        elif children:
            progress = sum((child.progress or 0.0) for child in children) / len(children)
            approximate = any(child.is_approximate for child in children)
        else:
            progress = None
            approximate = True
        state = _aggregate_state_from_children(children, progress, gate_done)
    else:
        scope_nodes = [node_id for node_id in (block.get("scope_nodes") or []) if isinstance(node_id, str)]
        leaf_ids = _leaf_ids(plan, scope_nodes)
        if isinstance(override, (int, float)):
            progress = float(override)
            approximate = False
        elif leaf_ids:
            weighted_sum = 0.0
            total_weight = 0.0
            approximate = False
            for leaf_id in leaf_ids:
                leaf_progress, leaf_approx = _leaf_progress(plan, leaf_id, progress_by_status)
                weight = _leaf_weight(plan, leaf_id, weight_strategy)
                weighted_sum += leaf_progress * weight
                total_weight += weight
                approximate = approximate or leaf_approx
            progress = weighted_sum / total_weight if total_weight > 0 else None
        else:
            progress = None
            approximate = True
        state = _scope_state(plan, leaf_ids, progress, gate_done)

    snapshot = BlockSnapshot(
        block_id=block_id,
        title=title,
        target_gate=target_gate,
        gate_date_text=gate_date_text,
        progress=progress,
        is_approximate=approximate,
        state=state,
        kind=kind,
    )
    cache[block_id] = snapshot
    return snapshot


def render_executive(
    plan: MergedPlan,
    view_id: str,
    direction: Optional[str] = None,
    show_progress: Optional[bool] = None,
) -> str:
    views = _exec_views(plan)
    view = views.get(view_id)
    if not isinstance(view, dict):
        raise ExecConfigError(f"Executive view '{view_id}' не найден")

    block_ids = view.get("blocks")
    if not isinstance(block_ids, list) or not all(isinstance(v, str) for v in block_ids):
        raise ExecConfigError(f"Executive view '{view_id}' должен содержать blocks: list[string]")

    graph_direction = str(direction or view.get("direction") or "LR")
    color_mode = str(view.get("color_mode") or "status")
    highlight_current = bool(view.get("highlight_current"))
    resolved_show_progress = show_progress if show_progress is not None else bool(view.get("show_progress", True))
    show_gate_date = bool(view.get("show_gate_date", True))
    show_owner = bool(view.get("show_owner"))
    wrap_title_lines = int(view.get("wrap_title_lines") or 1)
    respect_mgmt_health_for_done = bool(view.get("respect_mgmt_health_for_done"))
    reduce_transitive_required_edges = bool(view.get("reduce_transitive_required_edges", True))
    cache: dict[str, BlockSnapshot] = {}
    snapshots = {block_id: _build_snapshot(plan, block_id, cache) for block_id in block_ids}
    current_block_id = (
        _current_main_block_id(
            block_ids,
            snapshots,
            _exec_blocks(plan),
            color_mode=color_mode,
        )
        if (highlight_current or color_mode == "mgmt_hybrid")
        else None
    )

    lines: list[str] = [f"flowchart {graph_direction}", ""]

    for status_id in ["done", "in_progress", "blocked", "not_started"]:
        color = _status_color(plan, status_id)
        lines.append(
            f"    classDef exec_{status_id} fill:{color},stroke:#4b5563,color:#111827,stroke-width:1px"
        )
    lines.append(
        f"    classDef exec_mgmt_green fill:{DEFAULT_MGMT_HEALTH_COLORS['green']},stroke:#4b5563,color:#111827,stroke-width:1px"
    )
    lines.append(
        f"    classDef exec_mgmt_yellow fill:{DEFAULT_MGMT_HEALTH_COLORS['yellow']},stroke:#4b5563,color:#111827,stroke-width:1px"
    )
    lines.append(
        f"    classDef exec_mgmt_red fill:{DEFAULT_MGMT_HEALTH_COLORS['red']},stroke:#4b5563,color:#111827,stroke-width:1px"
    )
    lines.append(
        f"    classDef exec_mgmt_neutral fill:{DEFAULT_NEUTRAL_COLOR},stroke:#4b5563,color:#111827,stroke-width:1px"
    )
    lines.append("")

    for block_id in block_ids:
        snapshot = snapshots[block_id]
        safe_id = _sanitize_id(block_id)
        block = _exec_blocks(plan).get(block_id) or {}
        mgmt = _block_mgmt(block if isinstance(block, dict) else {})
        label = _format_label(
            snapshot,
            show_progress=resolved_show_progress,
            show_gate_date=show_gate_date,
            show_owner=show_owner,
            owner=mgmt.get("owner"),
            wrap_title_lines=wrap_title_lines,
        )
        class_name = _block_class_name(
            plan,
            block_id,
            snapshot,
            color_mode=color_mode,
            current_block_id=current_block_id,
            respect_mgmt_health_for_done=respect_mgmt_health_for_done,
        )
        lines.append(f'    {safe_id}["{label}"]')
        if highlight_current and block_id == current_block_id:
            lines.append(f"    class {safe_id} {class_name}")
            lines.append(f"    style {safe_id} stroke:#111827,stroke-width:3px")
        else:
            lines.append(f"    class {safe_id} {class_name}")

    view_edges = view.get("edges")
    edges = view_edges if isinstance(view_edges, list) else (_exec_cfg(plan).get("edges") or [])
    reduced_required_edge_indexes: set[int] = set()
    if reduce_transitive_required_edges and edges:
        required_edges = _visible_required_edges(edges, set(snapshots.keys()))
        for edge_idx, src, dst in required_edges:
            if _has_transitive_required_path(required_edges, src, dst, excluded_edge_idx=edge_idx):
                reduced_required_edge_indexes.add(edge_idx)
    if edges:
        lines.append("")
    for edge_idx, edge in enumerate(edges):
        if not isinstance(edge, dict):
            continue
        src = edge.get("from")
        dst = edge.get("to")
        if not isinstance(src, str) or not isinstance(dst, str):
            continue
        if src not in snapshots or dst not in snapshots:
            continue
        edge_type = str(edge.get("type") or "required")
        src_id = _sanitize_id(src)
        dst_id = _sanitize_id(dst)
        edge_label = _edge_label(edge)
        if edge_type == "risk_reduction":
            if edge_label:
                lines.append(f"    {src_id} -. {edge_label} .-> {dst_id}")
            else:
                lines.append(f"    {src_id} -.-> {dst_id}")
        elif edge_type == "context":
            if edge_label:
                lines.append(f"    {src_id} -. {edge_label} .-> {dst_id}")
            else:
                lines.append(f"    {src_id} -.-> {dst_id}")
        else:
            if edge_idx in reduced_required_edge_indexes:
                continue
            lines.append(f"    {src_id} --> {dst_id}")

    return "\n".join(lines)
