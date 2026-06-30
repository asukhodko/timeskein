"""
Common filtering and sorting logic for opskarta v3 renderers.

This module provides shared functionality used by all renderers:
- apply_view_filter: Filter nodes based on ViewFilter criteria
- sort_nodes: Sort nodes by a specified field
- get_descendants: Get all descendants of a node
- escape_mermaid_string: Escape text for Mermaid labels
- sanitize_mermaid_text: Clean text for Mermaid titles/labels

Requirements covered:
- 4.7: View filtering with where clause (kind, status, has_schedule, parent)
- 4.8: View sorting with order_by
- 4.9: Renderer uses calendar from Schedule for date calculations (not View)
"""

from typing import Optional

from specs.v3.tools.models import MergedPlan, ViewFilter


def escape_mermaid_string(text: str) -> str:
    """
    Escape text for Mermaid flowchart/gantt labels inside ["..."].
    
    Mermaid flowchart does NOT reliably support backslash-escaped quotes
    across renderers. Use Mermaid entity codes instead:
      - #  -> #35;  (so it doesn't start an entity by accident)
      - "  -> #quot;
    
    Args:
        text: Original text to escape
        
    Returns:
        Escaped text safe for Mermaid labels
    """
    return text.replace("#", "#35;").replace('"', "#quot;")


def sanitize_mermaid_text(text: str) -> str:
    """
    Clean text for Mermaid titles and labels.
    
    Removes or replaces characters that can cause issues in Mermaid:
      - : (colons) - can break Mermaid syntax
      - ： (full-width colons) - same issue

    Args:
        text: Original text to sanitize

    Returns:
        Sanitized text safe for Mermaid
    """
    cleaned = text.replace(":", " ").replace("：", " ")
    return " ".join(cleaned.split())


def get_descendants(plan: MergedPlan, parent_id: str) -> set[str]:
    """
    Get all descendants of a node (children, grandchildren, etc.).
    
    This function performs a breadth-first search to find all nodes
    that are descendants of the specified parent node.
    
    Args:
        plan: MergedPlan containing nodes
        parent_id: ID of the parent node
        
    Returns:
        Set of descendant node IDs (not including parent itself)
        
    Requirements:
        - 4.7: View filtering with where.parent
    """
    descendants = set()
    
    # Build parent -> children mapping
    children_map: dict[str, list[str]] = {}
    for node_id, node in plan.nodes.items():
        if node.parent:
            if node.parent not in children_map:
                children_map[node.parent] = []
            children_map[node.parent].append(node_id)
    
    # BFS to find all descendants
    queue = children_map.get(parent_id, []).copy()
    while queue:
        node_id = queue.pop(0)
        if node_id not in descendants:
            descendants.add(node_id)
            queue.extend(children_map.get(node_id, []))
    
    return descendants


def apply_view_filter(
    plan: MergedPlan,
    node_ids: list[str],
    view_filter: Optional[ViewFilter]
) -> list[str]:
    """
    Apply view filter to a list of node IDs.
    
    Filters nodes based on the ViewFilter criteria. All criteria are
    combined with AND logic - a node must match all specified criteria
    to be included in the result.
    
    Filter criteria:
    - kind: node.kind must be in the list
    - status: node.status must be in the list
    - has_schedule: node must be in/not in schedule.nodes
    - parent: node must be a descendant of the specified parent
    - x_ops_attention_class: node.x.ops.attention_class must be in the list
    
    Args:
        plan: MergedPlan containing nodes and schedule
        node_ids: List of node IDs to filter
        view_filter: Optional ViewFilter with filter criteria
        
    Returns:
        Filtered list of node IDs (preserves original order)
        
    Requirements:
        - 4.7: View filtering with where clause
    """
    if view_filter is None:
        return node_ids
    
    result = []
    
    # Build set of scheduled node IDs for has_schedule filter
    scheduled_ids = set()
    if plan.schedule:
        scheduled_ids = set(plan.schedule.nodes.keys())
    
    # Build set of descendants for parent filter
    descendants = None
    if view_filter.parent:
        descendants = get_descendants(plan, view_filter.parent)
    
    for node_id in node_ids:
        node = plan.nodes.get(node_id)
        if node is None:
            continue
        
        # Filter by kind
        if view_filter.kind is not None:
            if node.kind not in view_filter.kind:
                continue
        
        # Filter by status
        if view_filter.status is not None:
            if node.status not in view_filter.status:
                continue
        
        # Filter by has_schedule
        if view_filter.has_schedule is not None:
            is_scheduled = node_id in scheduled_ids
            if view_filter.has_schedule != is_scheduled:
                continue
        
        # Filter by parent (descendants)
        if descendants is not None:
            if node_id not in descendants:
                continue

        # Filter by node.x.ops.attention_class
        if view_filter.x_ops_attention_class is not None:
            node_attention_class = (((node.x or {}).get("ops") or {}).get("attention_class"))
            if node_attention_class not in view_filter.x_ops_attention_class:
                continue

        result.append(node_id)
    
    return result


def sort_nodes(
    plan: MergedPlan,
    node_ids: list[str],
    order_by: Optional[str]
) -> list[str]:
    """
    Sort nodes by the specified field.
    
    Supported fields:
    - title: Sort alphabetically by node title
    - status: Sort alphabetically by status
    - kind: Sort alphabetically by kind
    - effort: Sort numerically by effort (or effort_effective if computed)
    - effort_effective: Sort numerically by effort_effective
    - Any other field: Attempts to get attribute dynamically
    
    Args:
        plan: MergedPlan containing nodes
        node_ids: List of node IDs to sort
        order_by: Field name to sort by (e.g., "title", "status", "kind", "effort")
        
    Returns:
        Sorted list of node IDs
        
    Requirements:
        - 4.8: View sorting with order_by
    """
    if order_by is None:
        return node_ids
    
    def get_sort_key(node_id: str):
        node = plan.nodes.get(node_id)
        if node is None:
            return ""
        
        # Get the field value
        if order_by == "title":
            return node.title or ""
        elif order_by == "status":
            return node.status or ""
        elif order_by == "kind":
            return node.kind or ""
        elif order_by == "effort":
            # Sort by effort_effective if available, otherwise effort
            effort = node.effort_effective if node.effort_effective is not None else node.effort
            return effort if effort is not None else 0
        elif order_by == "effort_effective":
            return node.effort_effective if node.effort_effective is not None else 0
        else:
            # Try to get attribute dynamically
            return getattr(node, order_by, "") or ""
    
    return sorted(node_ids, key=get_sort_key)
