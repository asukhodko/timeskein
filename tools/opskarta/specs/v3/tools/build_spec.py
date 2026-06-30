#!/usr/bin/env python3
"""
Spec Builder — script for assembling specification parts into a single SPEC.md.

Usage:
    python build_spec.py                    # Generates en/SPEC.md (default)
    python build_spec.py --lang ru          # Generates ru/SPEC.md
    python build_spec.py --lang en --check  # Checks if en/SPEC.md is up-to-date

Algorithm:
    1. Find all *.md files in <lang>/spec/
    2. Sort by numeric prefix
    3. Extract first-level headings for table of contents
    4. Assemble into single file with table of contents
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Tuple, Optional


# Pattern for filename: NN-*.md where NN is numeric prefix
FILENAME_PATTERN = re.compile(r'^(\d+)-.*\.md$')

# Pattern for first-level heading
HEADING_PATTERN = re.compile(r'^#\s+(.+)$', re.MULTILINE)

# Supported languages
SUPPORTED_LANGS = ['en', 'ru']

# Language-specific strings
STRINGS = {
    'en': {
        'toc_title': '## Table of Contents',
        'header_auto': '<!-- This file is auto-generated. Do not edit manually! -->',
        'header_edit': '<!-- To make changes, edit files in spec/ and run: python tools/build_spec.py --lang {language} -->',
        'warning_skip': "Warning: file '{name}' does not match format NN-*.md, skipping",
        'error_duplicate': "Error: duplicate numeric prefix {prefix:02d}:",
        'error_dir_not_found': "Error: directory '{path}' not found",
        'error_no_files': "Error: no specification files found in '{path}'",
        'found_files': "Found {count} specification files:",
        'file_up_to_date': "✓ File '{name}' is up to date",
        'file_outdated': "✗ File '{name}' is outdated",
        'run_to_generate': "Run 'python tools/build_spec.py --lang {language}' to generate",
        'run_to_update': "Run 'python tools/build_spec.py --lang {language}' to update",
        'generated': "✓ Generated file '{path}'",
        'error_no_write': "Error: no write permission for '{path}'",
        'error_write': "Error writing file: {error}",
        'error_file_not_exist': "Error: file '{path}' does not exist",
    },
    'ru': {
        'toc_title': '## Оглавление',
        'header_auto': '<!-- Этот файл сгенерирован автоматически. Не редактируйте вручную! -->',
        'header_edit': '<!-- Для изменений редактируйте файлы в spec/ и запустите: python tools/build_spec.py --lang {language} -->',
        'warning_skip': "Предупреждение: файл '{name}' не соответствует формату NN-*.md, пропускаем",
        'error_duplicate': "Ошибка: дублирующийся числовой префикс {prefix:02d}:",
        'error_dir_not_found': "Ошибка: директория '{path}' не найдена",
        'error_no_files': "Ошибка: в директории '{path}' не найдено файлов спецификации",
        'found_files': "Найдено {count} файлов спецификации:",
        'file_up_to_date': "✓ Файл '{name}' актуален",
        'file_outdated': "✗ Файл '{name}' устарел",
        'run_to_generate': "Запустите 'python tools/build_spec.py --lang {language}' для генерации",
        'run_to_update': "Запустите 'python tools/build_spec.py --lang {language}' для обновления",
        'generated': "✓ Сгенерирован файл '{path}'",
        'error_no_write': "Ошибка: нет прав на запись в '{path}'",
        'error_write': "Ошибка записи файла: {error}",
        'error_file_not_exist': "Ошибка: файл '{path}' не существует",
    }
}


def get_string(lang: str, key: str, **kwargs) -> str:
    """Get localized string with optional formatting."""
    template = STRINGS[lang][key]
    return template.format(**kwargs) if kwargs else template


def get_script_dir() -> Path:
    """Returns directory where script is located."""
    return Path(__file__).parent.resolve()


def get_lang_dir(lang: str) -> Path:
    """Returns path to language directory (e.g., specs/v3/en/)."""
    return get_script_dir().parent / lang


def get_spec_dir(lang: str) -> Path:
    """Returns path to spec/ directory for given language."""
    return get_lang_dir(lang) / 'spec'


def get_output_path(lang: str) -> Path:
    """Returns path to output SPEC.md file."""
    return get_lang_dir(lang) / 'SPEC.md'


def find_spec_files(spec_dir: Path, lang: str) -> List[Tuple[int, Path]]:
    """
    Finds all specification files in spec/ directory.
    
    Returns list of tuples (numeric_prefix, file_path),
    sorted by numeric prefix.
    
    Files with incorrect name format are skipped with warning.
    """
    if not spec_dir.exists():
        return []
    
    files: List[Tuple[int, Path]] = []
    prefixes_seen: dict[int, Path] = {}
    
    for file_path in spec_dir.iterdir():
        if not file_path.is_file():
            continue
            
        match = FILENAME_PATTERN.match(file_path.name)
        if not match:
            print(get_string(lang, 'warning_skip', name=file_path.name),
                  file=sys.stderr)
            continue
        
        prefix = int(match.group(1))
        
        # Check for duplicate numeric prefix
        if prefix in prefixes_seen:
            print(get_string(lang, 'error_duplicate', prefix=prefix),
                  file=sys.stderr)
            print(f"  - {prefixes_seen[prefix].name}", file=sys.stderr)
            print(f"  - {file_path.name}", file=sys.stderr)
            sys.exit(1)
        
        prefixes_seen[prefix] = file_path
        files.append((prefix, file_path))
    
    # Sort by numeric prefix
    files.sort(key=lambda x: x[0])
    return files


def extract_first_heading(content: str) -> Optional[str]:
    """
    Extracts first level-1 heading from Markdown content.
    
    Returns heading text without # symbol or None if not found.
    """
    match = HEADING_PATTERN.search(content)
    if match:
        return match.group(1).strip()
    return None


def generate_anchor(heading: str) -> str:
    """
    Generates anchor for table of contents link.
    
    Converts heading to GitHub Markdown compatible format:
    - Converts to lowercase
    - Replaces spaces with hyphens
    - Removes special characters (except hyphens and underscores)
    """
    # Convert to lowercase
    anchor = heading.lower()
    # Replace spaces with hyphens
    anchor = anchor.replace(' ', '-')
    # Remove special characters, keep letters, digits, hyphens, underscores
    anchor = re.sub(r'[^\w\-]', '', anchor, flags=re.UNICODE)
    # Remove multiple hyphens
    anchor = re.sub(r'-+', '-', anchor)
    # Remove hyphens at start and end
    anchor = anchor.strip('-')
    return anchor


def build_toc(files: List[Tuple[int, Path]], lang: str) -> str:
    """
    Generates Table of Contents based on file headings.
    
    Returns string with Markdown list of section links.
    """
    toc_lines = [get_string(lang, 'toc_title'), ""]
    
    for _, file_path in files:
        content = file_path.read_text(encoding='utf-8')
        heading = extract_first_heading(content)
        
        if heading:
            anchor = generate_anchor(heading)
            toc_lines.append(f"- [{heading}](#{anchor})")
        else:
            # If heading not found, use filename
            name = file_path.stem
            toc_lines.append(f"- [{name}](#{name})")
    
    toc_lines.append("")  # Empty line at end
    return '\n'.join(toc_lines)


def build_spec(files: List[Tuple[int, Path]], lang: str) -> str:
    """
    Assembles complete specification from parts.
    
    Returns string with full SPEC.md content.
    """
    # Document header
    header = [
        get_string(lang, 'header_auto'),
        get_string(lang, 'header_edit', language=lang),
        "",
    ]
    
    # Generate table of contents
    toc = build_toc(files, lang)
    
    # Collect content from all files
    sections = []
    for _, file_path in files:
        content = file_path.read_text(encoding='utf-8').strip()
        sections.append(content)
    
    # Combine everything
    parts = header + [toc] + ['\n\n---\n\n'.join(sections)]
    return '\n'.join(parts)


def main():
    """Main script function."""
    parser = argparse.ArgumentParser(
        description='Build specification from parts into single SPEC.md'
    )
    parser.add_argument(
        '--lang',
        choices=SUPPORTED_LANGS,
        default='en',
        help='Language to build (default: en)'
    )
    parser.add_argument(
        '--check',
        action='store_true',
        help='Check if SPEC.md is up-to-date without overwriting'
    )
    args = parser.parse_args()
    
    lang = args.lang
    spec_dir = get_spec_dir(lang)
    output_path = get_output_path(lang)
    
    # Check if spec/ directory exists
    if not spec_dir.exists():
        print(get_string(lang, 'error_dir_not_found', path=spec_dir), file=sys.stderr)
        sys.exit(1)
    
    # Find specification files
    files = find_spec_files(spec_dir, lang)
    
    if not files:
        print(get_string(lang, 'error_no_files', path=spec_dir),
              file=sys.stderr)
        sys.exit(1)
    
    print(get_string(lang, 'found_files', count=len(files)))
    for prefix, file_path in files:
        print(f"  {prefix:02d}: {file_path.name}")
    
    # Build specification
    spec_content = build_spec(files, lang)
    
    if args.check:
        # Check mode: compare with existing file
        if not output_path.exists():
            print(f"\n{get_string(lang, 'error_file_not_exist', path=output_path)}", file=sys.stderr)
            print(get_string(lang, 'run_to_generate', language=lang), file=sys.stderr)
            sys.exit(1)
        
        existing_content = output_path.read_text(encoding='utf-8')
        
        if existing_content == spec_content:
            print(f"\n{get_string(lang, 'file_up_to_date', name=output_path.name)}")
            sys.exit(0)
        else:
            print(f"\n{get_string(lang, 'file_outdated', name=output_path.name)}", file=sys.stderr)
            print(get_string(lang, 'run_to_update', language=lang), file=sys.stderr)
            sys.exit(1)
    else:
        # Generate mode: write file
        try:
            output_path.write_text(spec_content, encoding='utf-8')
            print(f"\n{get_string(lang, 'generated', path=output_path)}")
        except PermissionError:
            print(f"\n{get_string(lang, 'error_no_write', path=output_path)}", file=sys.stderr)
            sys.exit(1)
        except OSError as e:
            print(f"\n{get_string(lang, 'error_write', error=e)}", file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
