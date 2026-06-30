"""
Execution metrics computation for opskarta v3.

This module computes progress_rollup and progress_coverage
for all nodes in a plan using a bottom-up tree traversal,
weighted by effort_effective.

Key concepts:
- progress_rollup: weighted average of child progress by effort_effective
- progress_coverage: fraction of total effort_effective covered by progress data

Requires effort_metrics to be computed first.
"""

from collections import defaultdict

from specs.v3.tools.models import MergedPlan


def compute_execution_metrics(plan: MergedPlan) -> None:
    """
    Compute progress_rollup and progress_coverage for all nodes.

    Algorithm:
    1. For leaf nodes with execution data: use execution.progress directly
    2. For parent nodes: weighted rollup by effort_effective
       progress_rollup = sum(effort_effective_i * progress_i) / sum(covered effort_effective_i)
       progress_coverage = sum(effort_effective with data) / sum(all effort_effective)
    3. Bottom-up traversal (post-order)

    Requires compute_effort_metrics() to have been called first.

    Args:
        plan: MergedPlan with nodes and execution data. Nodes are
              modified in-place with progress_rollup and progress_coverage.
    """
    if plan.execution is None or not plan.nodes:
        return

    # Build parent-child tree
    children: dict[str, list[str]] = defaultdict(list)
    for node_id, node in plan.nodes.items():
        if node.parent and node.parent in plan.nodes:
            children[node.parent].append(node_id)

    visited: set[str] = set()

    def compute(node_id: str) -> None:
        """Recursively compute execution metrics (post-order traversal)."""
        if node_id in visited:
            return

        visited.add(node_id)
        node = plan.nodes[node_id]
        child_ids = children.get(node_id, [])

        if not child_ids:
            # Leaf node — use execution data directly
            en = plan.execution.nodes.get(node_id)
            if en and en.progress is not None:
                node.progress_rollup = en.progress
                node.progress_coverage = 1.0
            else:
                node.progress_rollup = None
                node.progress_coverage = None
            return

        # Parent node — aggregate from children.
        # Per spec: only children with progress_rollup participate.
        # covered_effort counts the full effort of such children (not
        # scaled by child_coverage) so that the ratio stays in [0, 1].
        weighted_sum = 0.0
        total_effort = 0.0
        covered_effort = 0.0

        for child_id in child_ids:
            compute(child_id)
            child_node = plan.nodes[child_id]
            effort = child_node.effort_effective
            if effort is None or effort <= 0:
                continue

            total_effort += effort
            if child_node.progress_rollup is not None:
                covered_effort += effort
                weighted_sum += effort * child_node.progress_rollup

        if total_effort > 0 and covered_effort > 0:
            node.progress_rollup = weighted_sum / covered_effort
            node.progress_coverage = covered_effort / total_effort
        else:
            node.progress_rollup = None
            node.progress_coverage = None

    # Find root nodes
    root_ids = [
        node_id for node_id, node in plan.nodes.items()
        if not node.parent or node.parent not in plan.nodes
    ]

    for root_id in root_ids:
        compute(root_id)

    # Handle orphans
    for node_id in plan.nodes:
        if node_id not in visited:
            compute(node_id)
