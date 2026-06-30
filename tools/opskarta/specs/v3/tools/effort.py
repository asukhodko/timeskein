"""
Effort metrics computation for opskarta v3.

This module computes effort_rollup, effort_effective, and effort_gap
for all nodes in a plan using a bottom-up tree traversal.

Key concepts:
- effort_rollup: Sum of effort_effective of all direct children
- effort_effective: effort if set, otherwise effort_rollup
- effort_gap: max(0, effort - effort_rollup) - shows incomplete decomposition

Requirements covered:
- 2.6: effort_rollup = sum of effort_effective of direct children
- 2.7: effort_gap = max(0, effort - effort_rollup) when node has effort and children
- 2.8: For leaf nodes, effort_effective = effort
- 2.9: For nodes with children, effort_effective = effort if set, else effort_rollup
"""

from collections import defaultdict
from typing import Optional

from specs.v3.tools.models import MergedPlan


def compute_effort_metrics(plan: MergedPlan) -> None:
    """
    Compute effort_rollup, effort_effective, effort_gap for all nodes.
    
    Algorithm:
    1. Build parent-child tree from nodes
    2. Traverse tree bottom-up (post-order)
    3. For each node, compute metrics based on children
    
    Semantics:
    - effort_rollup = sum of effort_effective of all direct children
    - effort_effective = effort if set, otherwise effort_rollup
    - effort_gap = max(0, effort - rollup) - shows incomplete decomposition
    
    Args:
        plan: MergedPlan with nodes to process. Nodes are modified in-place
              with computed effort_rollup, effort_effective, effort_gap values.
    
    Requirements:
        - 2.6: effort_rollup = sum of effort_effective of direct children
        - 2.7: effort_gap = max(0, effort - effort_rollup)
        - 2.8: For leaf nodes, effort_effective = effort
        - 2.9: For nodes with children, effort_effective = effort if set, else effort_rollup
    """
    if not plan.nodes:
        return
    
    # Build parent-child tree
    children: dict[str, list[str]] = defaultdict(list)
    for node_id, node in plan.nodes.items():
        if node.parent:
            children[node.parent].append(node_id)
    
    # Track visited nodes to handle each node exactly once
    visited: set[str] = set()
    
    def compute(node_id: str) -> Optional[float]:
        """
        Recursively compute effort metrics for a node and its descendants.
        
        Returns the effort_effective value for the node.
        """
        if node_id in visited:
            # Already computed (can happen with complex hierarchies)
            return plan.nodes[node_id].effort_effective
        
        visited.add(node_id)
        node = plan.nodes[node_id]
        child_ids = children[node_id]
        
        if not child_ids:
            # Leaf node (Requirement 2.8)
            # effort_effective = effort
            node.effort_effective = node.effort
            node.effort_rollup = None
            node.effort_gap = None
            return node.effort
        
        # Node with children
        # First, compute effort_effective for all children
        child_efforts: list[float] = []
        for child_id in child_ids:
            child_effective = compute(child_id)
            if child_effective is not None:
                child_efforts.append(child_effective)
        
        # Requirement 2.6: effort_rollup = sum of effort_effective of direct children
        rollup = sum(child_efforts) if child_efforts else 0.0
        node.effort_rollup = rollup
        
        # Requirement 2.9: effort_effective = effort if set, else effort_rollup
        if node.effort is not None:
            node.effort_effective = node.effort
            # Requirement 2.7: effort_gap = max(0, effort - effort_rollup)
            node.effort_gap = max(0.0, node.effort - rollup)
        else:
            node.effort_effective = rollup
            node.effort_gap = None
        
        return node.effort_effective
    
    # Find root nodes (nodes without parent or with non-existent parent)
    root_ids = [
        node_id for node_id, node in plan.nodes.items()
        if not node.parent or node.parent not in plan.nodes
    ]
    
    # Compute metrics starting from each root
    for root_id in root_ids:
        compute(root_id)
    
    # Handle any orphaned nodes not reachable from roots
    # (shouldn't happen in valid plans, but handle gracefully)
    for node_id in plan.nodes:
        if node_id not in visited:
            compute(node_id)
