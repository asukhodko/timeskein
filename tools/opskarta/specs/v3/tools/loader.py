"""
Loader module for opskarta v3.

This module provides functionality for loading and validating YAML plan fragments.
It implements the first stage of the Plan Set processing pipeline.

Key functions:
- load_fragment(file_path): Load a single YAML file as a Fragment
- merge_fragments(fragments): Merge multiple fragments into a MergedPlan

Requirements covered:
- 1.1: Load each file as Fragment
- 1.2: Accept only allowed top-level blocks
- 1.3: Return error with block name and file for invalid blocks
- 1.4: Conflict detection for duplicate node_id
- 1.5: Conflict detection for duplicate status_id
- 1.6: Meta block merging with conflict detection
- 1.7: Schedule block merging (calendars and nodes)
- 1.8: schedule.default_calendar conflict (only one fragment allowed)
- 1.9: Return MergedPlan with all merged data
- 1.10: Source tracking for each element
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from specs.v3.tools.models import (
    Calendar,
    DepEdge,
    Execution,
    ExecutionNode,
    Meta,
    MergedPlan,
    Node,
    Profile,
    Schedule,
    ScheduleNode,
    Status,
    View,
    VIEW_FIELDS,
    VIEW_FILTER_FIELDS,
    ViewFilter,
)


# Allowed top-level blocks in a Fragment (Requirement 1.2)
ALLOWED_TOP_LEVEL_BLOCKS: frozenset[str] = frozenset({
    "version",
    "meta",
    "statuses",
    "nodes",
    "schedule",
    "execution",
    "views",
    "profiles",
    "x",
})

# Fields forbidden in nodes (moved to schedule.nodes in v3)
FORBIDDEN_NODE_FIELDS: frozenset[str] = frozenset({
    "start",
    "finish",
    "duration",
    "excludes",
    "after",
})

# Allowed keys in dependency edge objects
_ALLOWED_DEP_KEYS: frozenset[str] = frozenset({
    "id", "type", "lag", "hard", "note",
})

# Allowed keys in execution node objects
_ALLOWED_EXECUTION_KEYS: frozenset[str] = frozenset({
    "progress", "actual_start", "actual_finish",
    "updated_at", "confidence", "note",
})

# Allowed keys in schedule node objects
_ALLOWED_SCHEDULE_NODE_KEYS: frozenset[str] = frozenset({
    "start", "finish", "duration", "calendar",
})

class LoadError(Exception):
    """
    Exception raised when loading a fragment fails.
    
    This exception is raised for:
    - File read errors (file not found, permission denied, etc.)
    - YAML parsing errors
    - Invalid top-level blocks in the fragment
    
    Attributes:
        message: Human-readable error description
        file_path: Path to the file that caused the error
        block_name: Name of the invalid block (if applicable)
    """
    
    def __init__(
        self,
        message: str,
        file_path: str | None = None,
        block_name: str | None = None,
    ) -> None:
        self.message = message
        self.file_path = file_path
        self.block_name = block_name
        
        # Build full error message
        parts = []
        if file_path:
            parts.append(f"[{file_path}]")
        parts.append(message)
        if block_name:
            parts.append(f"(block: '{block_name}')")
        
        super().__init__(" ".join(parts))


class MergeConflictError(Exception):
    """
    Exception raised when merging fragments results in a conflict.
    
    This exception is raised for:
    - Duplicate node_id across fragments (Requirement 1.4)
    - Duplicate status_id across fragments (Requirement 1.5)
    - Conflicting meta field values (Requirement 1.6)
    - Duplicate calendar_id or schedule node_id (Requirement 1.7)
    - Multiple fragments with schedule.default_calendar (Requirement 1.8)
    - Duplicate view_id across fragments
    - Duplicate x key across fragments
    
    Attributes:
        message: Human-readable error description
        element_type: Type of conflicting element (node, status, meta, calendar, etc.)
        element_id: ID of the conflicting element
        files: List of files containing the conflict
    """
    
    def __init__(
        self,
        message: str,
        element_type: str | None = None,
        element_id: str | None = None,
        files: list[str] | None = None,
    ) -> None:
        self.message = message
        self.element_type = element_type
        self.element_id = element_id
        self.files = files or []
        
        # Build full error message
        parts = [message]
        if files:
            parts.append(f"(files: {', '.join(files)})")
        
        super().__init__(" ".join(parts))


def load_fragment(file_path: str) -> dict[str, Any]:
    """
    Load a single YAML file as a Fragment.
    
    Reads and parses a YAML file, validates that all top-level blocks
    are allowed, and returns the parsed data with source file information.
    
    Args:
        file_path: Path to the YAML file to load
        
    Returns:
        Dictionary containing:
        - All parsed YAML data
        - '_source': Path to the source file (added by loader)
        
    Raises:
        LoadError: If file cannot be read, YAML is invalid, or
                   fragment contains invalid top-level blocks
    
    Requirements:
        - 1.1: Load file as Fragment
        - 1.2: Accept only allowed blocks (version, meta, statuses, nodes, schedule, views, x)
        - 1.3: Return error with block name and file for invalid blocks
    
    Example:
        >>> fragment = load_fragment("plan.yaml")
        >>> fragment["_source"]
        'plan.yaml'
        >>> fragment.get("version")
        2
    """
    path = Path(file_path)
    
    # Read file content
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise LoadError(
            f"File not found: {file_path}",
            file_path=file_path,
        )
    except PermissionError:
        raise LoadError(
            f"Permission denied: {file_path}",
            file_path=file_path,
        )
    except OSError as e:
        raise LoadError(
            f"Cannot read file: {e}",
            file_path=file_path,
        )
    
    # Parse YAML
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError as e:
        raise LoadError(
            f"Invalid YAML: {e}",
            file_path=file_path,
        )
    
    # Handle empty files
    if data is None:
        data = {}
    
    # Validate that data is a dictionary
    if not isinstance(data, dict):
        raise LoadError(
            f"Fragment must be a YAML mapping, got {type(data).__name__}",
            file_path=file_path,
        )
    
    # Validate top-level blocks (Requirement 1.2, 1.3)
    for block_name in data.keys():
        if block_name not in ALLOWED_TOP_LEVEL_BLOCKS:
            raise LoadError(
                f"Invalid top-level block: '{block_name}'. "
                f"Allowed blocks: {', '.join(sorted(ALLOWED_TOP_LEVEL_BLOCKS))}",
                file_path=file_path,
                block_name=block_name,
            )
    
    # Add source file information
    result = dict(data)
    result["_source"] = file_path
    
    return result


def load_plan_set(files: list[str]) -> MergedPlan:
    """
    Load and merge plan fragments from multiple files.
    
    This is the main entry point for loading a Plan Set. It combines
    load_fragment and merge_fragments into a single convenient function.
    
    Args:
        files: List of paths to YAML files to load
        
    Returns:
        MergedPlan: The merged plan containing all data from all fragments
        
    Raises:
        LoadError: If any file cannot be read or contains invalid YAML/blocks
        MergeConflictError: If there are conflicts between fragments
    
    Requirements:
        - 5.1: Provide function load_plan_set(files: list[string]) -> Merged_Plan
    
    Example:
        >>> plan = load_plan_set(["main.yaml", "nodes.yaml", "schedule.yaml"])
        >>> plan.nodes["task1"].title
        'Task 1'
    """
    # Load all fragments
    fragments = [load_fragment(file_path) for file_path in files]
    
    # Merge and return
    return merge_fragments(fragments)


def merge_fragments(fragments: list[dict[str, Any]]) -> MergedPlan:
    """
    Merge multiple fragments into a single MergedPlan.
    
    Performs deterministic merging of fragments with conflict detection.
    Each element is tracked to its source file for error reporting.
    
    Merge rules:
    1. version: Must be the same in all fragments (or absent)
    2. meta: Merge fields, conflict on different values for same key
    3. statuses: Merge dicts, duplicate key is an error
    4. nodes: Merge dicts, duplicate key is an error
    5. schedule.calendars: Merge dicts, duplicate key is an error
    6. schedule.nodes: Merge dicts, duplicate key is an error
    7. schedule.default_calendar: Must be in only one fragment
    8. views: Merge dicts, duplicate key is an error
    9. x: Merge dicts, duplicate key is an error
    
    Args:
        fragments: List of fragment dicts (from load_fragment)
        
    Returns:
        MergedPlan with all merged data and sources tracking
        
    Raises:
        MergeConflictError: When any merge conflict is detected
    
    Requirements:
        - 1.4: Conflict detection for duplicate node_id
        - 1.5: Conflict detection for duplicate status_id
        - 1.6: Meta block merging with conflict detection
        - 1.7: Schedule block merging (calendars and nodes)
        - 1.8: schedule.default_calendar conflict
        - 1.9: Return MergedPlan with all merged data
        - 1.10: Source tracking for each element
    
    Example:
        >>> f1 = load_fragment("main.yaml")
        >>> f2 = load_fragment("nodes.yaml")
        >>> plan = merge_fragments([f1, f2])
        >>> plan.sources["node:task1"]
        'nodes.yaml'
    """
    result = MergedPlan()
    sources: dict[str, str] = {}
    
    # Track version and default_calendar sources
    version_source: str | None = None
    default_calendar_source: str | None = None
    
    # Track meta field sources for conflict detection
    meta_sources: dict[str, str] = {}
    
    for fragment in fragments:
        source = fragment.get("_source", "<unknown>")
        
        # 1. Merge version
        if "version" in fragment:
            frag_version = fragment["version"]
            if version_source is not None and result.version != frag_version:
                raise MergeConflictError(
                    f"Version mismatch: {result.version} vs {frag_version}",
                    element_type="version",
                    files=[version_source, source],
                )
            result.version = frag_version
            version_source = source
        
        # 2. Merge meta (Requirement 1.6)
        if "meta" in fragment and fragment["meta"] is not None:
            frag_meta = fragment["meta"]
            if not isinstance(frag_meta, dict):
                raise LoadError(
                    f"'meta' must be an object, got {type(frag_meta).__name__}",
                    file_path=source,
                    block_name="meta",
                )
            for key, value in frag_meta.items():
                existing_value = getattr(result.meta, key, None)
                if key in meta_sources and existing_value != value:
                    raise MergeConflictError(
                        f"Meta field '{key}' conflict: '{existing_value}' vs '{value}'",
                        element_type="meta",
                        element_id=key,
                        files=[meta_sources[key], source],
                    )
                setattr(result.meta, key, value)
                meta_sources[key] = source
                sources[f"meta:{key}"] = source
        
        # 3. Merge statuses (Requirement 1.5)
        if "statuses" in fragment and fragment["statuses"] is not None:
            if not isinstance(fragment["statuses"], dict):
                raise LoadError(
                    f"'statuses' must be an object, got {type(fragment['statuses']).__name__}",
                    file_path=source, block_name="statuses",
                )
            for status_id, status_data in fragment["statuses"].items():
                if status_id in result.statuses:
                    raise MergeConflictError(
                        f"Duplicate status_id '{status_id}'",
                        element_type="status",
                        element_id=status_id,
                        files=[sources[f"status:{status_id}"], source],
                    )
                result.statuses[status_id] = Status(
                    label=status_data.get("label", ""),
                    color=status_data.get("color"),
                )
                sources[f"status:{status_id}"] = source
        
        # 4. Merge nodes (Requirement 1.4)
        if "nodes" in fragment and fragment["nodes"] is not None:
            if not isinstance(fragment["nodes"], dict):
                raise LoadError(
                    f"'nodes' must be an object, got {type(fragment['nodes']).__name__}",
                    file_path=source, block_name="nodes",
                )
            for node_id, node_data in fragment["nodes"].items():
                if not isinstance(node_data, dict):
                    raise LoadError(
                        f"Node '{node_id}' must be an object, "
                        f"got {type(node_data).__name__}",
                        file_path=source,
                        block_name=f"nodes.{node_id}",
                    )
                if node_id in result.nodes:
                    raise MergeConflictError(
                        f"Duplicate node_id '{node_id}'",
                        element_type="node",
                        element_id=node_id,
                        files=[sources[f"node:{node_id}"], source],
                    )

                # Check for forbidden fields (Requirement 2.4)
                for forbidden_field in FORBIDDEN_NODE_FIELDS:
                    if forbidden_field in node_data:
                        if forbidden_field == "after":
                            raise LoadError(
                                f"Node '{node_id}' contains removed field 'after'. "
                                f"Use 'deps' instead: deps: [{{id: X, type: fs}}]",
                                file_path=source,
                                block_name=f"nodes.{node_id}.after",
                            )
                        raise LoadError(
                            f"Node '{node_id}' contains forbidden field '{forbidden_field}'. "
                            f"In v3, '{forbidden_field}' should be in schedule.nodes, not in nodes.",
                            file_path=source,
                            block_name=f"nodes.{node_id}.{forbidden_field}",
                        )

                # Parse deps field
                deps = None
                raw_deps = node_data.get("deps")
                if raw_deps is not None:
                    deps = _parse_deps(raw_deps, node_id, source)

                node_effort = node_data.get("effort")
                node_milestone = node_data.get("milestone", False)

                if node_effort is not None and (isinstance(node_effort, bool) or not isinstance(node_effort, (int, float))):
                    raise LoadError(
                        f"Node '{node_id}' effort must be a number, "
                        f"got {type(node_effort).__name__}",
                        file_path=source,
                        block_name=f"nodes.{node_id}.effort",
                    )
                if not isinstance(node_milestone, bool):
                    raise LoadError(
                        f"Node '{node_id}' milestone must be a boolean, "
                        f"got {type(node_milestone).__name__}",
                        file_path=source,
                        block_name=f"nodes.{node_id}.milestone",
                    )

                result.nodes[node_id] = Node(
                    title=node_data.get("title", ""),
                    kind=node_data.get("kind"),
                    status=node_data.get("status"),
                    parent=node_data.get("parent"),
                    deps=deps,
                    milestone=node_milestone,
                    issue=node_data.get("issue"),
                    notes=node_data.get("notes"),
                    effort=node_effort,
                    x=node_data.get("x"),
                )
                sources[f"node:{node_id}"] = source
        
        # 5-7. Merge schedule (Requirements 1.7, 1.8)
        if "schedule" in fragment and fragment["schedule"] is not None:
            frag_schedule = fragment["schedule"]
            if not isinstance(frag_schedule, dict):
                raise LoadError(
                    f"'schedule' must be an object, got {type(frag_schedule).__name__}",
                    file_path=source, block_name="schedule",
                )

            # Initialize schedule if not exists
            if result.schedule is None:
                result.schedule = Schedule()
            
            # 5. Merge calendars (Requirement 1.7)
            if "calendars" in frag_schedule and frag_schedule["calendars"] is not None:
                if not isinstance(frag_schedule["calendars"], dict):
                    raise LoadError(
                        f"'schedule.calendars' must be an object, "
                        f"got {type(frag_schedule['calendars']).__name__}",
                        file_path=source,
                        block_name="schedule.calendars",
                    )
                for cal_id, cal_data in frag_schedule["calendars"].items():
                    if cal_id in result.schedule.calendars:
                        raise MergeConflictError(
                            f"Duplicate calendar_id '{cal_id}'",
                            element_type="calendar",
                            element_id=cal_id,
                            files=[sources[f"calendar:{cal_id}"], source],
                        )
                    excludes = cal_data.get("excludes", [])
                    if not isinstance(excludes, list):
                        raise LoadError(
                            f"Calendar '{cal_id}' excludes must be a list, "
                            f"got {type(excludes).__name__}",
                            file_path=source,
                            block_name=f"schedule.calendars.{cal_id}.excludes",
                        )
                    for j, exc in enumerate(excludes):
                        if not isinstance(exc, str):
                            raise LoadError(
                                f"Calendar '{cal_id}' excludes[{j}] must be a string, "
                                f"got {type(exc).__name__}",
                                file_path=source,
                                block_name=f"schedule.calendars.{cal_id}.excludes[{j}]",
                            )
                    result.schedule.calendars[cal_id] = Calendar(
                        excludes=excludes,
                    )
                    sources[f"calendar:{cal_id}"] = source
            
            # 6. Merge schedule.nodes (Requirement 1.7)
            if "nodes" in frag_schedule and frag_schedule["nodes"] is not None:
                if not isinstance(frag_schedule["nodes"], dict):
                    raise LoadError(
                        f"'schedule.nodes' must be an object, "
                        f"got {type(frag_schedule['nodes']).__name__}",
                        file_path=source,
                        block_name="schedule.nodes",
                    )
                for sn_id, sn_data in frag_schedule["nodes"].items():
                    if sn_id in result.schedule.nodes:
                        raise MergeConflictError(
                            f"Duplicate schedule node_id '{sn_id}'",
                            element_type="schedule_node",
                            element_id=sn_id,
                            files=[sources[f"schedule_node:{sn_id}"], source],
                        )
                    # Check for misplaced/unknown keys in schedule node
                    if not isinstance(sn_data, dict):
                        raise LoadError(
                            f"Schedule node '{sn_id}' must be an object, "
                            f"got {type(sn_data).__name__}",
                            file_path=source,
                            block_name=f"schedule.nodes.{sn_id}",
                        )
                    unknown_keys = set(sn_data.keys()) - _ALLOWED_SCHEDULE_NODE_KEYS
                    if unknown_keys:
                        raise LoadError(
                            f"Schedule node '{sn_id}' contains unknown keys: "
                            f"{sorted(unknown_keys)}. "
                            f"Only {sorted(_ALLOWED_SCHEDULE_NODE_KEYS)} are allowed. "
                            f"(Did you mean to put '{', '.join(sorted(unknown_keys))}' "
                            f"under nodes.{sn_id} instead?)",
                            file_path=source,
                            block_name=f"schedule.nodes.{sn_id}",
                        )

                    sn_start = sn_data.get("start")
                    sn_finish = sn_data.get("finish")
                    sn_duration = sn_data.get("duration")
                    sn_calendar = sn_data.get("calendar")
                    for fname, fval in [("start", sn_start), ("finish", sn_finish),
                                        ("duration", sn_duration), ("calendar", sn_calendar)]:
                        if fval is not None and not isinstance(fval, str):
                            raise LoadError(
                                f"Schedule node '{sn_id}' {fname} must be a string, "
                                f"got {type(fval).__name__}",
                                file_path=source,
                                block_name=f"schedule.nodes.{sn_id}.{fname}",
                            )
                    result.schedule.nodes[sn_id] = ScheduleNode(
                        start=sn_start,
                        finish=sn_finish,
                        duration=sn_duration,
                        calendar=sn_calendar,
                    )
                    sources[f"schedule_node:{sn_id}"] = source
            
            # 7. Check default_calendar (Requirement 1.8)
            if "default_calendar" in frag_schedule and frag_schedule["default_calendar"] is not None:
                if default_calendar_source is not None:
                    raise MergeConflictError(
                        f"Multiple fragments define schedule.default_calendar",
                        element_type="default_calendar",
                        files=[default_calendar_source, source],
                    )
                result.schedule.default_calendar = frag_schedule["default_calendar"]
                default_calendar_source = source
                sources["schedule:default_calendar"] = source
        
        # 8. Merge views
        if "views" in fragment and fragment["views"] is not None:
            if not isinstance(fragment["views"], dict):
                raise LoadError(
                    f"'views' must be an object, got {type(fragment['views']).__name__}",
                    file_path=source, block_name="views",
                )
            for view_id, view_data in fragment["views"].items():
                if view_id in result.views:
                    raise MergeConflictError(
                        f"Duplicate view_id '{view_id}'",
                        element_type="view",
                        element_id=view_id,
                        files=[sources[f"view:{view_id}"], source],
                    )
                if not isinstance(view_data, dict):
                    raise LoadError(
                        f"View '{view_id}' must be an object, got {type(view_data).__name__}",
                        file_path=source,
                        block_name=f"views.{view_id}",
                    )

                unknown_view_keys = set(view_data) - VIEW_FIELDS
                if unknown_view_keys:
                    unknown = ", ".join(sorted(unknown_view_keys))
                    allowed = ", ".join(sorted(VIEW_FIELDS))
                    raise LoadError(
                        f"View '{view_id}' has unsupported key(s): {unknown}. "
                        f"Allowed keys: {allowed}",
                        file_path=source,
                        block_name=f"views.{view_id}",
                    )
                
                # Parse where filter if present
                where_filter = None
                if "where" in view_data and view_data["where"] is not None:
                    where_data = view_data["where"]
                    if not isinstance(where_data, dict):
                        raise LoadError(
                            f"View '{view_id}' where must be an object, "
                            f"got {type(where_data).__name__}",
                            file_path=source,
                            block_name=f"views.{view_id}.where",
                        )
                    unknown_where_keys = set(where_data) - VIEW_FILTER_FIELDS
                    if unknown_where_keys:
                        unknown = ", ".join(sorted(unknown_where_keys))
                        allowed = ", ".join(sorted(VIEW_FILTER_FIELDS))
                        raise LoadError(
                            f"View '{view_id}' where has unsupported key(s): {unknown}. "
                            f"Allowed keys: {allowed}",
                            file_path=source,
                            block_name=f"views.{view_id}.where",
                        )
                    if where_data:
                        where_filter = ViewFilter(
                            kind=where_data.get("kind"),
                            status=where_data.get("status"),
                            has_schedule=where_data.get("has_schedule"),
                            parent=where_data.get("parent"),
                            x_ops_attention_class=where_data.get("x_ops_attention_class"),
                        )
                
                result.views[view_id] = View(
                    title=view_data.get("title"),
                    where=where_filter,
                    order_by=view_data.get("order_by"),
                    group_by=view_data.get("group_by"),
                    lanes=view_data.get("lanes"),
                    date_format=view_data.get("date_format"),
                    axis_format=view_data.get("axis_format"),
                    tick_interval=view_data.get("tick_interval"),
                    window_start=view_data.get("window_start"),
                    window_finish=view_data.get("window_finish"),
                )
                sources[f"view:{view_id}"] = source
        
        # 9. Merge x (extensions)
        if "x" in fragment and fragment["x"] is not None:
            if not isinstance(fragment["x"], dict):
                raise LoadError(
                    f"'x' must be an object, got {type(fragment['x']).__name__}",
                    file_path=source, block_name="x",
                )
            for x_key, x_value in fragment["x"].items():
                if x_key in result.x:
                    raise MergeConflictError(
                        f"Duplicate extension key '{x_key}'",
                        element_type="x",
                        element_id=x_key,
                        files=[sources[f"x:{x_key}"], source],
                    )
                result.x[x_key] = x_value
                sources[f"x:{x_key}"] = source

        # 10. Merge execution
        if "execution" in fragment and fragment["execution"] is not None:
            frag_execution = fragment["execution"]
            if not isinstance(frag_execution, dict):
                raise LoadError(
                    f"'execution' must be an object, got {type(frag_execution).__name__}",
                    file_path=source,
                    block_name="execution",
                )

            if result.execution is None:
                result.execution = Execution()

            if "nodes" in frag_execution and frag_execution["nodes"] is not None:
                if not isinstance(frag_execution["nodes"], dict):
                    raise LoadError(
                        f"'execution.nodes' must be an object, "
                        f"got {type(frag_execution['nodes']).__name__}",
                        file_path=source,
                        block_name="execution.nodes",
                    )
                for en_id, en_data in frag_execution["nodes"].items():
                    if en_id in result.execution.nodes:
                        raise MergeConflictError(
                            f"Duplicate execution node_id '{en_id}'",
                            element_type="execution_node",
                            element_id=en_id,
                            files=[sources[f"execution_node:{en_id}"], source],
                        )
                    result.execution.nodes[en_id] = _parse_execution_node(en_data, en_id, source)
                    sources[f"execution_node:{en_id}"] = source

        # 11. Merge profiles
        if "profiles" in fragment and fragment["profiles"] is not None:
            frag_profiles = fragment["profiles"]
            if not isinstance(frag_profiles, list):
                raise LoadError(
                    f"'profiles' must be a list, got {type(frag_profiles).__name__}",
                    file_path=source,
                    block_name="profiles",
                )
            for profile_data in frag_profiles:
                profile = _parse_profile(profile_data, source)
                # Check for duplicate profile id
                for existing in result.profiles:
                    if existing.id == profile.id:
                        raise MergeConflictError(
                            f"Duplicate profile id '{profile.id}'",
                            element_type="profile",
                            element_id=profile.id,
                            files=[sources[f"profile:{existing.id}"], source],
                        )
                result.profiles.append(profile)
                sources[f"profile:{profile.id}"] = source

    # Store sources in result (Requirement 1.10)
    result.sources = sources

    return result


def _parse_deps(
    raw_deps: list,
    node_id: str,
    source: str,
) -> list[DepEdge]:
    """Parse raw deps list into DepEdge objects."""
    if not isinstance(raw_deps, list):
        raise LoadError(
            f"Node '{node_id}' has invalid deps: expected list, got {type(raw_deps).__name__}",
            file_path=source,
            block_name=f"nodes.{node_id}.deps",
        )

    deps = []
    for i, dep_data in enumerate(raw_deps):
        if isinstance(dep_data, str):
            # Shorthand: just a node_id → defaults to fs, 0d, hard
            deps.append(DepEdge(id=dep_data))
        elif isinstance(dep_data, dict):
            if "id" not in dep_data:
                raise LoadError(
                    f"Node '{node_id}' deps[{i}] is missing required field 'id'",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}]",
                )
            unknown_dep_keys = set(dep_data.keys()) - _ALLOWED_DEP_KEYS
            if unknown_dep_keys:
                raise LoadError(
                    f"Node '{node_id}' deps[{i}] contains unknown keys: "
                    f"{sorted(unknown_dep_keys)}",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}]",
                )

            dep_id = dep_data["id"]
            dep_type = dep_data.get("type", "fs")
            dep_lag = dep_data.get("lag", "0d")
            dep_hard = dep_data.get("hard", True)
            dep_note = dep_data.get("note")

            # Validate field types
            if not isinstance(dep_id, str):
                raise LoadError(
                    f"Node '{node_id}' deps[{i}].id must be a string, "
                    f"got {type(dep_id).__name__}",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}].id",
                )
            if not isinstance(dep_type, str):
                raise LoadError(
                    f"Node '{node_id}' deps[{i}].type must be a string, "
                    f"got {type(dep_type).__name__}",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}].type",
                )
            if not isinstance(dep_lag, str):
                raise LoadError(
                    f"Node '{node_id}' deps[{i}].lag must be a string, "
                    f"got {type(dep_lag).__name__}",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}].lag",
                )
            if not isinstance(dep_hard, bool):
                raise LoadError(
                    f"Node '{node_id}' deps[{i}].hard must be a boolean, "
                    f"got {type(dep_hard).__name__}",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}].hard",
                )
            if dep_note is not None and not isinstance(dep_note, str):
                raise LoadError(
                    f"Node '{node_id}' deps[{i}].note must be a string, "
                    f"got {type(dep_note).__name__}",
                    file_path=source,
                    block_name=f"nodes.{node_id}.deps[{i}].note",
                )

            deps.append(DepEdge(
                id=dep_id,
                type=dep_type,
                lag=dep_lag,
                hard=dep_hard,
                note=dep_note,
            ))
        else:
            raise LoadError(
                f"Node '{node_id}' deps[{i}] must be a string or object, "
                f"got {type(dep_data).__name__}",
                file_path=source,
                block_name=f"nodes.{node_id}.deps[{i}]",
            )
    return deps


def _parse_execution_node(data: dict, node_id: str = "", source: str = "") -> ExecutionNode:
    """Parse raw dict into ExecutionNode."""
    if not isinstance(data, dict):
        raise LoadError(
            f"Execution node '{node_id}' must be an object, got {type(data).__name__}",
            file_path=source,
            block_name=f"execution.nodes.{node_id}",
        )
    unknown_en_keys = set(data.keys()) - _ALLOWED_EXECUTION_KEYS
    if unknown_en_keys:
        raise LoadError(
            f"Execution node '{node_id}' contains unknown keys: "
            f"{sorted(unknown_en_keys)}",
            file_path=source,
            block_name=f"execution.nodes.{node_id}",
        )

    progress = data.get("progress")
    actual_start = data.get("actual_start")
    actual_finish = data.get("actual_finish")
    updated_at = data.get("updated_at")
    confidence = data.get("confidence")
    note = data.get("note")
    base = f"execution.nodes.{node_id}"

    if progress is not None and (isinstance(progress, bool) or not isinstance(progress, (int, float))):
        raise LoadError(
            f"Execution node '{node_id}' progress must be a number, got {type(progress).__name__}",
            file_path=source, block_name=f"{base}.progress",
        )
    if confidence is not None and (isinstance(confidence, bool) or not isinstance(confidence, (int, float))):
        raise LoadError(
            f"Execution node '{node_id}' confidence must be a number, got {type(confidence).__name__}",
            file_path=source, block_name=f"{base}.confidence",
        )
    for fname, fval in [("actual_start", actual_start), ("actual_finish", actual_finish),
                         ("updated_at", updated_at), ("note", note)]:
        if fval is not None and not isinstance(fval, str):
            raise LoadError(
                f"Execution node '{node_id}' {fname} must be a string, got {type(fval).__name__}",
                file_path=source, block_name=f"{base}.{fname}",
            )

    return ExecutionNode(
        progress=progress,
        actual_start=actual_start,
        actual_finish=actual_finish,
        updated_at=updated_at,
        confidence=confidence,
        note=note,
    )


def _parse_profile(data: dict, source: str) -> Profile:
    """Parse raw dict into Profile."""
    if not isinstance(data, dict):
        raise LoadError(
            f"Profile entry must be an object, got {type(data).__name__}",
            file_path=source,
            block_name="profiles",
        )
    for required in ("id", "version", "namespace"):
        if required not in data:
            raise LoadError(
                f"Profile entry is missing required field '{required}'",
                file_path=source,
                block_name="profiles",
            )
    # Validate field types
    pid = data["id"]
    version = data["version"]
    namespace = data["namespace"]
    if not isinstance(pid, str):
        raise LoadError(
            f"Profile id must be a string, got {type(pid).__name__}",
            file_path=source,
            block_name="profiles",
        )
    if isinstance(version, bool) or not isinstance(version, int):
        raise LoadError(
            f"Profile '{pid}' version must be an integer, got {type(version).__name__}",
            file_path=source,
            block_name=f"profiles.{pid}.version",
        )
    if not isinstance(namespace, str):
        raise LoadError(
            f"Profile '{pid}' namespace must be a string, got {type(namespace).__name__}",
            file_path=source,
            block_name=f"profiles.{pid}.namespace",
        )
    return Profile(
        id=pid,
        version=version,
        namespace=namespace,
    )
