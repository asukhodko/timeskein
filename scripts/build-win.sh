#!/usr/bin/env bash
# ==========================================================================
#  Timeskein Windows Build — WSL wrapper
#  Usage: ./scripts/build-win.sh [--release] [--debug]
#
#  This script:
#    1. Resolves the repo root
#    2. Converts to a Windows path via wslpath
#    3. Validates the repo is on a Windows filesystem (/mnt/...)
#    4. Calls scripts\build-win.cmd via cmd.exe
# ==========================================================================

set -euo pipefail

# -- Resolve repo root (parent of the directory containing this script) -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[timeskein-wsl] Repo root (Linux): $REPO_ROOT"

# -- Convert to Windows path ------------------------------------------------
WIN_REPO_ROOT="$(wslpath -w "$REPO_ROOT" 2>/dev/null)" || {
    echo "[timeskein-wsl] ERROR: wslpath failed. Are you running inside WSL?"
    exit 1
}

echo "[timeskein-wsl] Repo root (Windows): $WIN_REPO_ROOT"

# -- Validate: repo must be on Windows filesystem, not \\wsl$ ---------------
if [[ "$WIN_REPO_ROOT" == '\\wsl$'* ]] || [[ "$WIN_REPO_ROOT" == '\\wsl.localhost'* ]]; then
    echo ""
    echo "[timeskein-wsl] ERROR: Repository is on the WSL filesystem."
    echo ""
    echo "  The Windows build toolchain (MSVC, link.exe) cannot access files"
    echo "  on the WSL virtual filesystem (\\\\wsl\$\\...)."
    echo ""
    echo "  Move or clone the repository to a Windows drive, e.g.:"
    echo "    /mnt/c/Users/\$USER/git/timeskein"
    echo ""
    echo "  Then run this script from there."
    exit 1
fi

# -- Validate: not inside \\\\wsl paths that wslpath might not catch --------
if [[ "$REPO_ROOT" != /mnt/* ]]; then
    echo ""
    echo "[timeskein-wsl] WARNING: Repo path does not start with /mnt/."
    echo "  Path: $REPO_ROOT"
    echo ""
    echo "  This may cause issues with Windows build tools."
    echo "  Recommended: use a path like /mnt/c/Users/\$USER/git/timeskein"
    echo ""
    # Continue anyway — some custom mounts may work
fi

# -- Convert script path for cmd.exe ----------------------------------------
WIN_SCRIPT="$WIN_REPO_ROOT\\scripts\\build-win.cmd"

echo "[timeskein-wsl] Calling: cmd.exe /c $WIN_SCRIPT $*"
echo ""

# -- Execute -----------------------------------------------------------------
cmd.exe /c "$WIN_SCRIPT" "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "[timeskein-wsl] Build failed with exit code $EXIT_CODE"
    exit $EXIT_CODE
fi

echo ""
echo "[timeskein-wsl] Build succeeded."
