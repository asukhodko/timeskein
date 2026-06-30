"""
Dependency graph renderer for opskarta v3 plans.

Supports two modes:
- simple: flat dependency graph (default)
- hierarchical: parent hierarchy + dependency edges with status styling
"""

from collections import defaultdict
from typing import Iterable, Optional, Sequence

from specs.v3.tools.models import MergedPlan, View
from specs.v3.tools.render.common import (
    apply_view_filter,
    escape_mermaid_string,
    sanitize_mermaid_text,
)


DEFAULT_STATUS_COLORS = {
    "not_started": "#9ca3af",
    "planned": "#aad2e6",
    "in_progress": "#0ea5e9",
    "done": "#22c55e",
    "blocked": "#fecaca",
}

STATUS_TO_EMOJI = {
    "done": "✅",
    "in_progress": "🔄",
    "blocked": "⛔",
}


def _sanitize_node_id(node_id: str) -> str:
    result = []
    for char in node_id:
        if char.isalnum() or char == "_":
            result.append(char)
        else:
            result.append("_")
    return "".join(result)


def _sanitize_class_token(value: str) -> str:
    token = _sanitize_node_id(value)
    if not token:
        token = "x"
    if token[0].isdigit():
        token = f"_{token}"
    return token


def _build_status_class_map(status_ids: Iterable[str]) -> dict[str, str]:
    """
    Build deterministic Mermaid-safe class names for arbitrary status IDs.

    Handles symbols in status IDs (for example: "in-progress") and
    guarantees uniqueness on sanitize collisions.
    """
    class_map: dict[str, str] = {}
    used: set[str] = set()

    for status_id in sorted(status_ids):
        base = f"class_status_{_sanitize_class_token(status_id)}"
        class_name = base
        suffix = 2
        while class_name in used:
            class_name = f"{base}_{suffix}"
            suffix += 1
        used.add(class_name)
        class_map[status_id] = class_name

    return class_map


def _escape_mermaid_label(text: str) -> str:
    return escape_mermaid_string(sanitize_mermaid_text(text))


def _wrap_text(text: str, width: int) -> str:
    if width <= 0:
        return text
    words = text.split()
    if not words:
        return text

    lines = []
    current = words[0]
    for word in words[1:]:
        if len(current) + 1 + len(word) <= width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return "<br/>".join(lines)


def _build_children_map(plan: MergedPlan) -> dict[str, list[str]]:
    children_map: dict[str, list[str]] = defaultdict(list)
    for node_id, node in plan.nodes.items():
        if node.parent:
            children_map[node.parent].append(node_id)
    return children_map


def _status_colors(plan: MergedPlan) -> dict[str, str]:
    if not plan.statuses:
        return dict(DEFAULT_STATUS_COLORS)

    result: dict[str, str] = {}
    for status_id, status in plan.statuses.items():
        if status.color:
            result[status_id] = status.color
        else:
            result[status_id] = DEFAULT_STATUS_COLORS.get(status_id, "#e5e7eb")
    return result


def _make_node_label(plan: MergedPlan, node_id: str, wrap_column: int) -> str:
    node = plan.nodes[node_id]
    status = (node.status or "").strip()

    title = sanitize_mermaid_text(node.title)
    emoji = STATUS_TO_EMOJI.get(status)
    if emoji:
        title = f"{emoji} {title}"

    if wrap_column > 0:
        title = _wrap_text(title, wrap_column)

    parts = [title]
    if node.issue and node.issue != node_id:
        parts.append(node.issue)

    return escape_mermaid_string("<br/>".join(parts))


def _resolve_view(plan: MergedPlan, view_id: Optional[str]) -> Optional[View]:
    view: Optional[View] = None
    if view_id:
        view = plan.views.get(view_id)
        if view is None:
            raise ValueError(f"View '{view_id}' not found")
    return view


def _filtered_node_ids(plan: MergedPlan, view: Optional[View]) -> list[str]:
    all_node_ids = list(plan.nodes.keys())
    if view and view.where:
        return apply_view_filter(plan, all_node_ids, view.where)
    return all_node_ids


def _collect_track_scope(plan: MergedPlan, tracks: Sequence[str]) -> set[str]:
    children_map = _build_children_map(plan)
    scoped: set[str] = set()

    for track in tracks:
        if track not in plan.nodes:
            raise ValueError(f"Track '{track}' not found")

        # Include track + ancestors.
        current = track
        seen: set[str] = set()
        while current and current not in seen:
            seen.add(current)
            scoped.add(current)
            parent = plan.nodes[current].parent
            if not parent or parent not in plan.nodes:
                break
            current = parent

        # Include descendants.
        stack = [track]
        while stack:
            node_id = stack.pop()
            for child in children_map.get(node_id, []):
                if child not in scoped:
                    scoped.add(child)
                    stack.append(child)

    return scoped


def _render_deps_simple(
    plan: MergedPlan,
    view: Optional[View],
    direction: str,
) -> str:
    filtered_ids = set(_filtered_node_ids(plan, view))
    if not filtered_ids:
        return f"flowchart {direction}"

    lines: list[str] = [f"flowchart {direction}"]
    edges: list[tuple[str, str]] = []

    for node_id in sorted(filtered_ids):
        node = plan.nodes.get(node_id)
        if node is None:
            continue

        safe_id = _sanitize_node_id(node_id)
        safe_label = _escape_mermaid_label(node.title)
        lines.append(f'    {safe_id}["{safe_label}"]')

        if node.deps:
            for dep in node.deps:
                if dep.id in filtered_ids:
                    edges.append((dep, node_id))

    for dep, node_id in edges:
        src = _sanitize_node_id(dep.id)
        dst = _sanitize_node_id(node_id)
        label_parts = []
        if dep.type == "ss":
            label_parts.append("ss")
        if dep.lag != "0d":
            label_parts.append(f"+{dep.lag}")
        label = " ".join(label_parts)

        if dep.hard:
            if label:
                lines.append(f"    {src} -->|{label}| {dst}")
            else:
                lines.append(f"    {src} --> {dst}")
        else:
            if label:
                lines.append(f"    {src} -.->|{label}| {dst}")
            else:
                lines.append(f"    {src} -.-> {dst}")

    return "\n".join(lines)


def _render_deps_hierarchical(
    plan: MergedPlan,
    view: Optional[View],
    direction: str,
    wrap_column: int,
    tracks: Sequence[str],
) -> str:
    visible_ids = set(_filtered_node_ids(plan, view))

    if tracks:
        track_scope = _collect_track_scope(plan, tracks)
        visible_ids &= track_scope

    if not visible_ids:
        return f"flowchart {direction}"

    children_map = _build_children_map(plan)
    status_colors = _status_colors(plan)
    status_class_map = _build_status_class_map(status_colors.keys())

    lines: list[str] = [f"flowchart {direction}", ""]

    for status_id in sorted(status_colors):
        color = status_colors[status_id]
        class_name = status_class_map[status_id]
        lines.append(f"  classDef {class_name} fill:{color},stroke:#4b5563,color:#000;")
    lines.append("")

    declared: set[str] = set()

    def emit_node(node_id: str, indent: str) -> None:
        if node_id in declared:
            return
        node = plan.nodes[node_id]
        label = _make_node_label(plan, node_id, wrap_column)
        status = (node.status or "").strip()
        safe_id = _sanitize_node_id(node_id)
        if status and status in status_colors:
            class_name = status_class_map[status]
            lines.append(f'{indent}{safe_id}["{label}"]:::{class_name}')
        else:
            lines.append(f'{indent}{safe_id}["{label}"]')
        declared.add(node_id)

    def emit_children(parent_id: str, indent: str) -> None:
        children = [cid for cid in children_map.get(parent_id, []) if cid in visible_ids]
        children.sort(key=lambda cid: sanitize_mermaid_text(plan.nodes[cid].title))

        for child_id in children:
            grand_children = [gc for gc in children_map.get(child_id, []) if gc in visible_ids]
            if grand_children:
                sg_id = f"sg_{_sanitize_node_id(child_id)}"
                sg_title = _escape_mermaid_label(plan.nodes[child_id].title)
                lines.append(f'{indent}subgraph {sg_id}["{sg_title}"]')
                emit_node(child_id, indent + "  ")
                emit_children(child_id, indent + "  ")
                lines.append(f"{indent}end")
            else:
                emit_node(child_id, indent)

    roots = []
    for node_id in sorted(visible_ids):
        parent = plan.nodes[node_id].parent
        if not parent or parent not in visible_ids:
            roots.append(node_id)

    roots.sort(key=lambda nid: sanitize_mermaid_text(plan.nodes[nid].title))

    for root_id in roots:
        emit_node(root_id, "  ")
    lines.append("")

    for root_id in roots:
        emit_children(root_id, "  ")
    lines.append("")

    # Ensure orphan nodes in visibility set are present.
    for node_id in sorted(visible_ids):
        emit_node(node_id, "  ")

    lines.append("")
    lines.append("  %% Structure: parent (decomposition) - dashed arrows")
    for node_id in sorted(visible_ids):
        parent = plan.nodes[node_id].parent
        if parent and parent in visible_ids:
            lines.append(f"  {_sanitize_node_id(parent)} -.-> {_sanitize_node_id(node_id)}")

    lines.append("")
    lines.append("  %% Dependencies: deps - solid/dashed arrows")
    for node_id in sorted(visible_ids):
        node = plan.nodes[node_id]
        for dep in node.deps or []:
            if dep.id in visible_ids:
                src = _sanitize_node_id(dep.id)
                dst = _sanitize_node_id(node_id)
                label_parts = []
                if dep.type == "ss":
                    label_parts.append("ss")
                if dep.lag != "0d":
                    label_parts.append(f"+{dep.lag}")
                label = " ".join(label_parts)

                if dep.hard:
                    if label:
                        lines.append(f"  {src} -->|{label}| {dst}")
                    else:
                        lines.append(f"  {src} --> {dst}")
                else:
                    if label:
                        lines.append(f"  {src} -.->|{label}| {dst}")
                    else:
                        lines.append(f"  {src} -.-> {dst}")

    return "\n".join(lines)


def render_deps(
    plan: MergedPlan,
    view_id: Optional[str] = None,
    mode: str = "simple",
    direction: str = "LR",
    wrap_column: int = 0,
    tracks: Optional[Sequence[str]] = None,
) -> str:
    """
    Generate Mermaid dependency graph.

    Args:
        plan: Merged plan.
        view_id: Optional view id for filtering.
        mode: Rendering mode, one of "simple" or "hierarchical".
        direction: Mermaid flow direction (LR/TB/BT/RL).
        wrap_column: Wrap column for hierarchical labels.
        tracks: Optional list of track node IDs for hierarchical scoping.
    """
    if direction not in {"LR", "TB", "BT", "RL"}:
        raise ValueError(f"Unsupported direction '{direction}', expected LR/TB/BT/RL")

    view = _resolve_view(plan, view_id)
    tracks = tracks or []

    if mode == "simple":
        if tracks:
            raise ValueError("--track is supported only in hierarchical mode")
        return _render_deps_simple(plan, view, direction)

    if mode == "hierarchical":
        return _render_deps_hierarchical(plan, view, direction, wrap_column, tracks)

    raise ValueError(f"Unsupported mode '{mode}', expected 'simple' or 'hierarchical'")
