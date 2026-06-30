"""
List renderer for opskarta v3 plans.

This module generates flat text-based list representations
from MergedPlan objects. It displays nodes as a simple list
with optional view filtering and sorting.

Key features:
- Flat list format (no hierarchy)
- Shows node status and effort if available
- Applies view filtering (where) if view_id is provided
- Applies view sorting (order_by) if view_id is provided

Requirements covered:
- 5.7: render_list(plan: Merged_Plan, view_id: Optional[string]) -> string
- 5.9: Apply filtering and sorting from view if view_id is provided

Example output:
    - Task 1 [done] (5 sp)
    - Task 2 [in_progress] (3 sp)
    - Task 3 (8 sp)
"""

from typing import Optional

from specs.v3.tools.models import MergedPlan, Node, View, ViewFilter
from specs.v3.tools.render.common import apply_view_filter, sort_nodes


def _format_list_item(
    plan: MergedPlan,
    node_id: str,
) -> str:
    """
    Format a single node as a list item.
    
    Args:
        plan: MergedPlan containing nodes and meta
        node_id: ID of the node to format
        
    Returns:
        Formatted list item string
    """
    node = plan.nodes.get(node_id)
    if node is None:
        return ""
    
    # Build the line
    parts = ["- ", node.title]
    
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


def render_list(plan: MergedPlan, view_id: Optional[str] = None) -> str:
    """
    Generate a flat list representation from a MergedPlan.
    
    This function creates a text-based list showing all nodes
    as simple list items. If a view_id is provided, the view's
    filter and sorting settings are applied.
    
    Args:
        plan: MergedPlan with nodes
        view_id: Optional ID of the view to use for filtering and sorting
        
    Returns:
        List representation as a string
        
    Raises:
        ValueError: If view_id is provided but view doesn't exist
        
    Requirements:
        - 5.7: render_list(plan: Merged_Plan, view_id: Optional[string]) -> string
        - 5.9: Apply filtering and sorting from view if view_id is provided
    
    Example output:
        - Task 1 [done] (5 sp)
        - Task 2 [in_progress] (3 sp)
        - Task 3 (8 sp)
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
        filtered_ids = apply_view_filter(plan, all_node_ids, view.where)
    else:
        filtered_ids = all_node_ids
    
    # If no nodes pass filter, return empty string
    if not filtered_ids:
        return ""
    
    # Get order_by from view
    order_by = view.order_by if view else None
    
    # Sort nodes
    sorted_ids = sort_nodes(plan, filtered_ids, order_by)
    
    # Format each node as a list item
    for node_id in sorted_ids:
        line = _format_list_item(plan, node_id)
        if line:
            lines.append(line)
    
    return "\n".join(lines)
