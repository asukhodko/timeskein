#!/usr/bin/env python3
"""Update generated Mermaid and Markdown sections in Markdown files."""

from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml


COMMENT_RE = re.compile(r"<!--\nПерегенерить:\n(?P<body>.*?)-->", re.S)
MERMAID_RE = re.compile(r"```mermaid\n.*?\n```", re.S)
GENERATED_RE = re.compile(r"<!-- GENERATED:START -->(?P<body>.*?)<!-- GENERATED:END -->", re.S)


@dataclass
class RenderBlock:
    replace_start: int
    replace_end: int
    target_kind: str
    validate_commands: list[str]
    render_command: str
    caption_start: int | None = None
    caption_end: int | None = None
    caption: str | None = None


def _strip_shell_tail(command: str) -> str:
    return command.split("|", 1)[0].strip()


def _parse_block(comment_match: re.Match[str], text: str) -> RenderBlock:
    body = comment_match.group("body")
    commands = [line.strip() for line in body.splitlines() if line.strip()]
    validate_commands = [
        _strip_shell_tail(command)
        for command in commands
        if " specs.v3.tools.cli validate " in f" {command} "
    ]
    render_commands = [
        _strip_shell_tail(command)
        for command in commands
        if " specs.v3.tools.cli render " in f" {command} "
    ]
    if not render_commands:
        raise ValueError("В блоке 'Перегенерить' не найдена команда render")
    if len(render_commands) > 1:
        raise ValueError("В блоке 'Перегенерить' найдено больше одной команды render")

    target_start = comment_match.end()
    whitespace_match = re.match(r"\s*", text[target_start:])
    if whitespace_match:
        target_start += whitespace_match.end()

    generated_match = GENERATED_RE.match(text, target_start)
    mermaid_match = MERMAID_RE.match(text, target_start)

    candidates: list[tuple[str, int, re.Match[str]]] = []
    if generated_match:
        candidates.append(("generated", generated_match.start(), generated_match))
    if mermaid_match:
        candidates.append(("mermaid", mermaid_match.start(), mermaid_match))
    if not candidates:
        raise ValueError(
            "После блока 'Перегенерить' должен сразу идти fenced mermaid-блок "
            "или GENERATED-блок"
        )

    target_kind, _, target_match = min(candidates, key=lambda item: item[1])
    if target_kind == "generated":
        replace_start = target_match.start("body")
        replace_end = target_match.end("body")
    else:
        replace_start = target_match.start()
        replace_end = target_match.end()

    return RenderBlock(
        replace_start=replace_start,
        replace_end=replace_end,
        target_kind=target_kind,
        validate_commands=validate_commands,
        render_command=render_commands[0],
    )


def _run_command(command: str, cwd: Path) -> str:
    argv = shlex.split(command)
    result = subprocess.run(argv, cwd=str(cwd), text=True, capture_output=True, check=False)
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise RuntimeError(f"Команда завершилась с кодом {result.returncode}: {command}")
    return result.stdout


def _exec_view_caption(command: str, cwd: Path) -> str | None:
    argv = shlex.split(command)
    try:
        render_idx = argv.index("render")
    except ValueError:
        return None
    if len(argv) <= render_idx + 2 or argv[render_idx + 1] != "executive":
        return None

    view_id = None
    for idx, arg in enumerate(argv):
        if arg == "--view" and idx + 1 < len(argv):
            view_id = argv[idx + 1]
            break
    if not view_id:
        return None

    for arg in argv[render_idx + 2:]:
        if arg.startswith("-"):
            break
        path = (cwd / arg).resolve()
        if not path.exists() or path.suffix not in {".yaml", ".yml"}:
            continue
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        exec_cfg = ((doc.get("x") or {}).get("exec") or {})
        view = (exec_cfg.get("views") or {}).get(view_id)
        if isinstance(view, dict) and isinstance(view.get("caption"), str):
            caption = view["caption"].strip()
            return caption or None
    return None


def _caption_range_after(text: str, start: int) -> tuple[int, int] | None:
    match = re.match(r"\n\n(?P<body>.*?)(?=\n\n|\Z)", text[start:], re.S)
    if not match:
        return None
    body = match.group("body")
    stripped = body.lstrip()
    if not stripped or stripped.startswith(("<!--", "##", "```")):
        return None
    body_start = start + match.start("body")
    body_end = start + match.end("body")
    return body_start, body_end


def update_markdown_files(markdown_files: list[Path]) -> int:
    parsed_docs: list[tuple[Path, str, list[RenderBlock]]] = []
    validate_commands: list[tuple[Path, str]] = []
    seen_validate: set[tuple[Path, str]] = set()

    for md_path in markdown_files:
        text = md_path.read_text(encoding="utf-8")
        comment_matches = list(COMMENT_RE.finditer(text))
        if not comment_matches:
            raise RuntimeError(f"В файле {md_path} не найдено ни одного блока '<!-- Перегенерить: ... -->'")
        blocks = [_parse_block(match, text) for match in comment_matches]
        for block in blocks:
            caption = _exec_view_caption(block.render_command, md_path.parent)
            if caption and block.target_kind == "mermaid":
                block.caption = caption
                caption_range = _caption_range_after(text, block.replace_end)
                if caption_range:
                    block.caption_start, block.caption_end = caption_range
                else:
                    block.caption_start = block.replace_end
                    block.caption_end = block.replace_end
        parsed_docs.append((md_path, text, blocks))
        cwd = md_path.parent
        for block in blocks:
            for command in block.validate_commands:
                key = (cwd, command)
                if key not in seen_validate:
                    seen_validate.add(key)
                    validate_commands.append(key)

    for cwd, command in validate_commands:
        print(f"[validate] {command}")
        _run_command(command, cwd)

    updated_blocks = 0
    for md_path, text, blocks in parsed_docs:
        cwd = md_path.parent
        replacements: list[tuple[int, int, str]] = []
        for block in blocks:
            print(f"[render] {block.render_command}")
            rendered = _run_command(block.render_command, cwd).rstrip()
            if block.target_kind == "generated":
                replacement = f"\n{rendered}\n" if rendered else "\n"
            else:
                replacement = f"```mermaid\n{rendered}\n```"
            replacements.append((block.replace_start, block.replace_end, replacement))
            if block.caption is not None and block.caption_start is not None and block.caption_end is not None:
                if block.caption_start == block.caption_end:
                    caption_replacement = f"\n\n{block.caption}"
                else:
                    caption_replacement = block.caption
                replacements.append((block.caption_start, block.caption_end, caption_replacement))

        updated = text
        for start, end, replacement in reversed(replacements):
            updated = updated[:start] + replacement + updated[end:]
        if updated != text:
            md_path.write_text(updated, encoding="utf-8")
        updated_blocks += len(blocks)

    return updated_blocks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Перегенерировать Mermaid-диаграммы по блокам 'Перегенерить' в одном или нескольких Markdown-файлах."
    )
    parser.add_argument(
        "markdown_files",
        nargs="+",
        help="Пути до Markdown-файлов с Mermaid-блоками",
    )
    args = parser.parse_args(argv)

    markdown_files = [Path(path).resolve() for path in args.markdown_files]
    updated = update_markdown_files(markdown_files)
    print(f"Updated Mermaid blocks: {updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
