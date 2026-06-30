"""
Command-line interface for opskarta v3.

This module provides CLI commands for validating and rendering
opskarta v3 plan files.

Commands:
- validate: Validate one or more plan files
- render: Render plans in various formats (gantt, tree, list, deps, executive)
- update-markdown: Refresh generated blocks in Markdown files

Usage examples:
    # Validate one or more plan files
    python -m specs.v3.tools.cli validate plan.yaml
    python -m specs.v3.tools.cli validate main.yaml nodes.yaml schedule.yaml

    # Render with different formats
    python -m specs.v3.tools.cli render gantt plan.yaml --view gantt --style plain
    python -m specs.v3.tools.cli render tree plan.yaml --view backlog
    python -m specs.v3.tools.cli render list plan.yaml --view tasks_only
    python -m specs.v3.tools.cli render deps plan.yaml
    python -m specs.v3.tools.cli render executive plan.yaml exec.yaml --view exec-top
    python -m specs.v3.tools.cli render executive-report plan.yaml exec.yaml --section status --lang en

Requirements covered:
- 5.11: CLI SHALL accept list of files as command line arguments
- 5.12: WHEN CLI receives multiple files THEN CLI SHALL pass them to Loader as Plan_Set
"""

import argparse
import sys
from typing import Optional, Sequence

from specs.v3.tools.loader import load_plan_set, LoadError, MergeConflictError
from specs.v3.tools.validator import validate as validate_plan, format_error
from specs.v3.tools.scheduler import compute_schedule
from specs.v3.tools.effort import compute_effort_metrics
from specs.v3.tools.execution import compute_execution_metrics
from specs.v3.tools.render import (
    render_deps,
    render_executive,
    render_executive_report,
    render_gantt,
    render_list,
    render_tree,
)


def create_parser() -> argparse.ArgumentParser:
    """
    Create the argument parser for the CLI.
    
    Returns:
        Configured ArgumentParser instance
    """
    parser = argparse.ArgumentParser(
        prog="opskarta",
        description="opskarta v3 - Plan validation and rendering tool",
    )
    
    subparsers = parser.add_subparsers(
        dest="command",
        title="commands",
        description="Available commands",
        required=True,
    )
    
    # Validate command
    validate_parser = subparsers.add_parser(
        "validate",
        help="Validate one or more plan files",
        description="Load and validate plan files, reporting any errors found.",
    )
    validate_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to validate",
    )
    validate_parser.add_argument(
        "--strict",
        action="store_true",
        default=False,
        help="Promote certain warnings to errors",
    )

    markdown_parser = subparsers.add_parser(
        "update-markdown",
        help="Refresh generated Mermaid/Markdown blocks in Markdown files",
        description=(
            "Find '<!-- Перегенерить: ... -->' blocks, run their validate/render "
            "commands, and replace the following Mermaid or GENERATED block."
        ),
    )
    markdown_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="Markdown file(s) to update",
    )
    
    # Render command with subcommands
    render_parser = subparsers.add_parser(
        "render",
        help="Render plan in various formats",
        description="Render plan files in different output formats.",
    )
    
    render_subparsers = render_parser.add_subparsers(
        dest="format",
        title="formats",
        description="Available render formats",
        required=True,
    )
    
    # Gantt subcommand
    gantt_parser = render_subparsers.add_parser(
        "gantt",
        help="Render as Mermaid Gantt diagram",
        description="Generate a Mermaid Gantt diagram from the plan.",
    )
    gantt_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to render",
    )
    gantt_parser.add_argument(
        "--view",
        metavar="VIEW_ID",
        required=True,
        help="View ID to use for filtering and formatting (required for gantt)",
    )
    gantt_parser.add_argument(
        "--style",
        choices=["plain", "status"],
        default="plain",
        help="Gantt rendering style: plain (default) or status",
    )
    
    # Tree subcommand
    tree_parser = render_subparsers.add_parser(
        "tree",
        help="Render as hierarchical tree",
        description="Generate a hierarchical tree view of the plan.",
    )
    tree_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to render",
    )
    tree_parser.add_argument(
        "--view",
        metavar="VIEW_ID",
        help="View ID to use for filtering and sorting",
    )
    
    # List subcommand
    list_parser = render_subparsers.add_parser(
        "list",
        help="Render as flat list",
        description="Generate a flat list view of the plan.",
    )
    list_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to render",
    )
    list_parser.add_argument(
        "--view",
        metavar="VIEW_ID",
        help="View ID to use for filtering and sorting",
    )
    
    # Deps subcommand
    deps_parser = render_subparsers.add_parser(
        "deps",
        help="Render as dependency graph",
        description="Generate a Mermaid flowchart showing dependencies.",
    )
    deps_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to render",
    )
    deps_parser.add_argument(
        "--view",
        metavar="VIEW_ID",
        help="View ID to use for filtering",
    )
    deps_parser.add_argument(
        "--mode",
        choices=["simple", "hierarchical"],
        default="simple",
        help="Dependency render mode (default: simple)",
    )
    deps_parser.add_argument(
        "--direction",
        choices=["LR", "TB", "BT", "RL"],
        default="LR",
        help="Flowchart direction (default: LR)",
    )
    deps_parser.add_argument(
        "--wrap-column",
        type=int,
        default=0,
        help="Wrap label at this column in hierarchical mode (0 = no wrap)",
    )
    deps_parser.add_argument(
        "--track",
        action="append",
        default=[],
        help="Limit hierarchical graph to one or more track node IDs (repeatable)",
    )

    # Executive subcommand
    executive_parser = render_subparsers.add_parser(
        "executive",
        help="Render as executive flowchart",
        description="Generate a Mermaid flowchart for top-level executive blocks.",
    )
    executive_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to render",
    )
    executive_parser.add_argument(
        "--view",
        metavar="VIEW_ID",
        required=True,
        help="Executive view ID from x.exec.views",
    )
    executive_parser.add_argument(
        "--direction",
        choices=["LR", "TB", "BT", "RL"],
        help="Override flowchart direction from view config",
    )
    executive_parser.add_argument(
        "--hide-progress",
        action="store_true",
        default=False,
        help="Hide progress labels inside executive blocks",
    )

    executive_report_parser = render_subparsers.add_parser(
        "executive-report",
        help="Render executive markdown section",
        description="Generate markdown sections for the executive document.",
    )
    executive_report_parser.add_argument(
        "files",
        nargs="+",
        metavar="FILE",
        help="YAML plan file(s) to render",
    )
    executive_report_parser.add_argument(
        "--section",
        required=True,
        choices=["status", "tracks", "signals"],
        help="Executive markdown section to render",
    )
    executive_report_parser.add_argument(
        "--view",
        metavar="VIEW_ID",
        help=(
            "Executive view ID to use for the report section. Defaults to "
            "exec-top for status and exec-active-tracks for tracks/signals."
        ),
    )
    executive_report_parser.add_argument(
        "--lang",
        choices=["ru", "en"],
        default="ru",
        help="Output language for built-in report labels (default: ru)",
    )
    
    return parser


def cmd_validate(files: list[str], strict: bool = False) -> int:
    """
    Execute the validate command.

    Loads and validates the specified plan files, printing any
    validation errors found.

    Args:
        files: List of YAML file paths to validate
        strict: If True, promote certain warnings to errors

    Returns:
        Exit code: 0 if valid, 1 if errors found

    Requirements:
        - 5.11: Accept list of files as arguments
        - 5.12: Pass multiple files to Loader as Plan_Set
    """
    try:
        # Load and merge plan files
        plan = load_plan_set(files)

        # Validate the merged plan
        result = validate_plan(plan, strict=strict)
        
        if result.is_valid:
            print("OK")
            
            # Print warnings if any
            for warning in result.warnings:
                print(format_error(warning), file=sys.stderr)
            
            return 0
        else:
            # Print errors
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            
            # Print warnings
            for warning in result.warnings:
                print(format_error(warning), file=sys.stderr)
            
            return 1
            
    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1


def cmd_update_markdown(files: list[str]) -> int:
    """Execute the update-markdown command."""
    from pathlib import Path

    from specs.v3.tools.markdown import update_markdown_files

    try:
        updated = update_markdown_files([Path(file).resolve() for file in files])
        print(f"Updated generated blocks: {updated}")
        return 0
    except (OSError, RuntimeError, ValueError) as e:
        print(f"[error] [markdown] {e}", file=sys.stderr)
        return 1


def cmd_render_gantt(files: list[str], view_id: str, style: str) -> int:
    """
    Execute the render gantt command.
    
    Loads plan files, computes schedule, and renders as Mermaid Gantt.
    
    Args:
        files: List of YAML file paths
        view_id: Required view ID for filtering/formatting
        style: Gantt style (plain/status)
        
    Returns:
        Exit code: 0 on success, 1 on error
    """
    try:
        # Load and merge plan files
        plan = load_plan_set(files)
        
        # Validate first
        result = validate_plan(plan)
        if not result.is_valid:
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            return 1
        
        # Compute effort metrics
        compute_effort_metrics(plan)

        # Compute execution metrics
        compute_execution_metrics(plan)

        # Compute schedule
        compute_schedule(plan)

        # Render gantt
        output = render_gantt(plan, view_id=view_id, style=style)
        print(output)
        
        return 0
        
    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[error] [render] {e}", file=sys.stderr)
        return 1


def cmd_render_tree(files: list[str], view_id: Optional[str]) -> int:
    """
    Execute the render tree command.
    
    Loads plan files and renders as hierarchical tree.
    
    Args:
        files: List of YAML file paths
        view_id: Optional view ID for filtering/sorting
        
    Returns:
        Exit code: 0 on success, 1 on error
    """
    try:
        # Load and merge plan files
        plan = load_plan_set(files)
        
        # Validate first
        result = validate_plan(plan)
        if not result.is_valid:
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            return 1
        
        # Compute effort metrics
        compute_effort_metrics(plan)

        # Compute execution metrics
        compute_execution_metrics(plan)

        # Render tree
        output = render_tree(plan, view_id)
        print(output)
        
        return 0
        
    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[error] [render] {e}", file=sys.stderr)
        return 1


def cmd_render_list(files: list[str], view_id: Optional[str]) -> int:
    """
    Execute the render list command.
    
    Loads plan files and renders as flat list.
    
    Args:
        files: List of YAML file paths
        view_id: Optional view ID for filtering/sorting
        
    Returns:
        Exit code: 0 on success, 1 on error
    """
    try:
        # Load and merge plan files
        plan = load_plan_set(files)
        
        # Validate first
        result = validate_plan(plan)
        if not result.is_valid:
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            return 1
        
        # Compute effort metrics
        compute_effort_metrics(plan)

        # Compute execution metrics
        compute_execution_metrics(plan)

        # Render list
        output = render_list(plan, view_id)
        print(output)
        
        return 0
        
    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[error] [render] {e}", file=sys.stderr)
        return 1


def cmd_render_deps(
    files: list[str],
    view_id: Optional[str],
    mode: str,
    direction: str,
    wrap_column: int,
    tracks: list[str],
) -> int:
    """
    Execute the render deps command.
    
    Loads plan files and renders as dependency graph.
    
    Args:
        files: List of YAML file paths
        view_id: Optional view ID for filtering
        mode: Render mode (simple/hierarchical)
        direction: Graph direction (LR/TB/BT/RL)
        wrap_column: Label wrap width for hierarchical mode
        tracks: Track node IDs for hierarchical mode
        
    Returns:
        Exit code: 0 on success, 1 on error
    """
    try:
        # Load and merge plan files
        plan = load_plan_set(files)
        
        # Validate first
        result = validate_plan(plan)
        if not result.is_valid:
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            return 1
        
        # Compute effort metrics
        compute_effort_metrics(plan)

        # Compute execution metrics
        compute_execution_metrics(plan)

        # Render deps
        output = render_deps(
            plan,
            view_id=view_id,
            mode=mode,
            direction=direction,
            wrap_column=wrap_column,
            tracks=tracks,
        )
        print(output)
        
        return 0
        
    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[error] [render] {e}", file=sys.stderr)
        return 1


def cmd_render_executive(
    files: list[str],
    view_id: str,
    direction: Optional[str],
    hide_progress: bool,
) -> int:
    """
    Execute the render executive command.

    Loads plan files, computes metrics, and renders as Mermaid flowchart.
    """
    try:
        plan = load_plan_set(files)

        result = validate_plan(plan)
        if not result.is_valid:
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            return 1

        compute_effort_metrics(plan)
        compute_execution_metrics(plan)
        compute_schedule(plan)

        output = render_executive(
            plan,
            view_id=view_id,
            direction=direction,
            show_progress=False if hide_progress else None,
        )
        print(output)
        return 0

    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[error] [render] {e}", file=sys.stderr)
        return 1


def cmd_render_executive_report(
    files: list[str],
    section: str,
    view_id: Optional[str] = None,
    lang: str = "ru",
) -> int:
    """
    Execute the render executive-report command.

    Loads plan files, computes metrics, and renders markdown for one section
    of the executive document.
    """
    try:
        plan = load_plan_set(files)

        result = validate_plan(plan)
        if not result.is_valid:
            for error in result.errors:
                print(format_error(error), file=sys.stderr)
            return 1

        compute_effort_metrics(plan)
        compute_execution_metrics(plan)
        compute_schedule(plan)

        output = render_executive_report(plan, section=section, view_id=view_id, lang=lang)
        print(output)
        return 0

    except LoadError as e:
        print(f"[error] [loading] {e}", file=sys.stderr)
        return 1
    except MergeConflictError as e:
        print(f"[error] [merge] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[error] [render] {e}", file=sys.stderr)
        return 1


def main(argv: Optional[Sequence[str]] = None) -> int:
    """
    Main entry point for the CLI.
    
    Args:
        argv: Command line arguments (defaults to sys.argv[1:])
        
    Returns:
        Exit code
    """
    parser = create_parser()
    args = parser.parse_args(argv)
    
    if args.command == "validate":
        return cmd_validate(args.files, strict=args.strict)

    elif args.command == "update-markdown":
        return cmd_update_markdown(args.files)
    
    elif args.command == "render":
        if args.format == "gantt":
            return cmd_render_gantt(args.files, args.view, args.style)
        elif args.format == "tree":
            return cmd_render_tree(args.files, args.view)
        elif args.format == "list":
            return cmd_render_list(args.files, args.view)
        elif args.format == "deps":
            return cmd_render_deps(
                args.files,
                args.view,
                args.mode,
                args.direction,
                args.wrap_column,
                args.track,
            )
        elif args.format == "executive":
            return cmd_render_executive(
                args.files,
                args.view,
                args.direction,
                args.hide_progress,
            )
        elif args.format == "executive-report":
            return cmd_render_executive_report(args.files, args.section, args.view, args.lang)
    
    # Should not reach here due to required subparsers
    return 1


if __name__ == "__main__":
    sys.exit(main())
