"""
Tree renderer for opskarta v3 plans.

This module generates hierarchical text-based tree representations
from MergedPlan objects. It displays nodes organized by parent-child
relationships with optional view filtering and sorting.

Key features:
- Hierarchical tree structure using Unicode box-drawing characters
- Shows node status and effort if available
- Applies view filtering (where) if view_id is provided
- Applies view sorting (order_by) if view_id is provided

Requirements covered:
- 5.6: render_tree(plan: Merged_Plan, view_id: Optional[string]) -> string
- 5.9: Apply filtering and sorting from view if view_id is provided

Example output:
    ├── Phase 1 [in_progress] (10 sp)
    │   ├── Task 1.1 [done]
    │   └── Task 1.2 [in_progress]
    └── Phase 2
        └── Task 2.1
"""

from typing import Optional

from specs.v3.tools.models import MergedPlan, Node, View, ViewFilter
from specs.v3.tools.render.common import (
    apply_view_filter,
    get_descendants,
    sort_nodes,
)


# Re-export for backward compatibility with existing imports
# (list.py and deps.py import from tree.py)
def _get_descendants(plan: MergedPlan, parent_id: str) -> set[str]:
    """
    Get all descendants of a node (children, grandchildren, etc.).
    
    This is a wrapper for backward compatibility. Use get_descendants from common.py.
    
    Args:
        plan: MergedPlan containing nodes
        parent_id: ID of the parent node
        
    Returns:
        Set of descendant node IDs (not including parent itself)
    """
    return get_descendants(plan, parent_id)


def _get_children(plan: MergedPlan, parent_id: Optional[str]) -> list[str]:
    """
    Get direct children of a node.
    
    Args:
        plan: MergedPlan containing nodes
        parent_id: ID of the parent node, or None for root nodes
        
    Returns:
        List of child node IDs
    """
    children = []
    for node_id, node in plan.nodes.items():
        if node.parent == parent_id:
            children.append(node_id)
    return children


def _sort_nodes(
    plan: MergedPlan,
    node_ids: list[str],
    order_by: Optional[str]
) -> list[str]:
    """
    Sort nodes by the specified field.
    
    This is a wrapper for backward compatibility. Use sort_nodes from common.py.
    
    Args:
        plan: MergedPlan containing nodes
        node_ids: List of node IDs to sort
        order_by: Field name to sort by (e.g., "title", "status", "kind", "effort")
        
    Returns:
        Sorted list of node IDs
    """
    return sort_nodes(plan, node_ids, order_by)


def _format_node_line(
    plan: MergedPlan,
    node_id: str,
    prefix: str,
    is_last: bool
) -> str:
    """
    Format a single node line with tree characters.
    
    Args:
        plan: MergedPlan containing nodes and meta
        node_id: ID of the node to format
        prefix: Prefix string for indentation
        is_last: Whether this is the last child in its parent
        
    Returns:
        Formatted line string
    """
    node = plan.nodes.get(node_id)
    if node is None:
        return ""
    
    # Choose tree connector
    connector = "└── " if is_last else "├── "
    
    # Build the line
    parts = [prefix, connector, node.title]
    
    # Add status if present
    if node.status:
        parts.append(f" [{node.status}]")
    
    # Add effort if present
    effort = node.effort_effective if node.effort_effective is not None else node.effort
    if effort is not None:
        # Get effort unit from meta
        unit = ""
        if plan.meta and plan.meta.effort_unit:
            unit = f" {plan.meta.effort_unit}"
        parts.append(f" ({effort}{unit})")

    # Add progress if present
    progress = node.progress_rollup
    if progress is not None:
        pct = round(progress * 100)
        coverage = node.progress_coverage
        if coverage is not None and coverage < 1.0:
            cov_pct = round(coverage * 100)
            parts.append(f" {{{pct}% cov:{cov_pct}%}}")
        else:
            parts.append(f" {{{pct}%}}")
    elif plan.execution and node_id in plan.execution.nodes:
        en = plan.execution.nodes[node_id]
        if en.progress is not None:
            pct = round(en.progress * 100)
            parts.append(f" {{{pct}%}}")

    return "".join(parts)


def _render_subtree(
    plan: MergedPlan,
    node_id: str,
    prefix: str,
    is_last: bool,
    filtered_ids: set[str],
    order_by: Optional[str],
    lines: list[str]
) -> None:
    """
    Recursively render a subtree.
    
    Args:
        plan: MergedPlan containing nodes
        node_id: ID of the current node
        prefix: Prefix string for indentation
        is_last: Whether this is the last child in its parent
        filtered_ids: Set of node IDs that pass the filter
        order_by: Optional field name for sorting children
        lines: Output lines list to append to
    """
    # Only render if node passes filter
    if node_id not in filtered_ids:
        return
    
    # Format and add this node's line
    line = _format_node_line(plan, node_id, prefix, is_last)
    if line:
        lines.append(line)
    
    # Get children that pass the filter
    all_children = _get_children(plan, node_id)
    children = [c for c in all_children if c in filtered_ids]
    
    # Sort children if order_by is specified
    children = _sort_nodes(plan, children, order_by)
    
    # Calculate new prefix for children
    if is_last:
        child_prefix = prefix + "    "
    else:
        child_prefix = prefix + "│   "
    
    # Render children
    for i, child_id in enumerate(children):
        child_is_last = (i == len(children) - 1)
        _render_subtree(
            plan, child_id, child_prefix, child_is_last,
            filtered_ids, order_by, lines
        )


def render_tree(plan: MergedPlan, view_id: Optional[str] = None) -> str:
    """
    Generate a hierarchical tree representation from a MergedPlan.
    
    This function creates a text-based tree showing nodes organized
    by their parent-child relationships. If a view_id is provided,
    the view's filter and sorting settings are applied.
    
    Args:
        plan: MergedPlan with nodes
        view_id: Optional ID of the view to use for filtering and sorting
        
    Returns:
        Tree representation as a string
        
    Raises:
        ValueError: If view_id is provided but view doesn't exist
        
    Requirements:
        - 5.6: render_tree(plan: Merged_Plan, view_id: Optional[string]) -> string
        - 5.9: Apply filtering and sorting from view if view_id is provided
    
    Example output:
        ├── Phase 1 [in_progress] (10 sp)
        │   ├── Task 1.1 [done]
        │   └── Task 1.2 [in_progress]
        └── Phase 2
            └── Task 2.1
    """
    lines: list[str] = []
    
    # Get view if specified
    view: Optional[View] = None
    if view_id:
        view = plan.views.get(view_id)
        if view is None:
            raise ValueError(f"View '{view_id}' not found")
    
    # Get all node IDs
    all_node_ids = list(plan.nodes.keys())
    
    # Apply view filter if present
    if view and view.where:
        filtered_ids = set(apply_view_filter(plan, all_node_ids, view.where))
    else:
        filtered_ids = set(all_node_ids)
    
    # If no nodes pass filter, return empty string
    if not filtered_ids:
        return ""
    
    # Get order_by from view
    order_by = view.order_by if view else None
    
    # Find root nodes (nodes without parent, or whose parent is not in filtered set)
    root_ids = []
    for node_id in filtered_ids:
        node = plan.nodes.get(node_id)
        if node is None:
            continue
        
        # A node is a root if:
        # 1. It has no parent, OR
        # 2. Its parent is not in the filtered set
        if node.parent is None or node.parent not in filtered_ids:
            root_ids.append(node_id)
    
    # Sort root nodes
    root_ids = _sort_nodes(plan, root_ids, order_by)
    
    # Render each root and its subtree
    for i, root_id in enumerate(root_ids):
        is_last = (i == len(root_ids) - 1)
        _render_subtree(
            plan, root_id, "", is_last,
            filtered_ids, order_by, lines
        )
    
    return "\n".join(lines)
