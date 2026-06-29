# Building Timeskein on Windows

## Build Commands

| Where | Command |
|-------|---------|
| WSL terminal | `./scripts/build-win.sh` |
| Windows CMD / PowerShell | `scripts\build-win.cmd` |
| pnpm (WSL) | `pnpm build:win` |
| pnpm (native Windows) | `pnpm build:win:native` |

Both `build-win.sh` (WSL wrapper) and `build-win.cmd` (native entrypoint) accept:
- `--release` (default) or `--debug`
- `--app <path>` to override Tauri app directory (default: `apps/desktop`)

## System Prerequisites

### 1. Visual Studio Build Tools

Install **Visual Studio Build Tools 2022** (or newer):
https://visualstudio.microsoft.com/visual-cpp-build-tools/

Required workload: **"Desktop development with C++"**

This provides:
- MSVC compiler (`cl.exe`)
- Windows linker (`link.exe`)
- Windows SDK

The build script finds VS automatically via `vswhere.exe`.

### 2. Rust (MSVC toolchain)

Install via https://rustup.rs/

Ensure you select the `x86_64-pc-windows-msvc` target (default on Windows).

Verify:
```
rustc --version
cargo --version
```

### 3. Node.js 20+

Install via https://nodejs.org/ or via `nvm-windows`.

### 4. pnpm 9+

```
npm install -g pnpm
```

### 5. WebView2 Runtime

Required by Tauri 2. Comes pre-installed on Windows 10 (1803+) and Windows 11.
If missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## How the Build Works

1. `build-win.cmd` locates Visual Studio via `vswhere.exe`
2. Calls `vcvars64.bat` to set up the MSVC x64 environment (puts `cl.exe`/`link.exe` in PATH)
3. Runs `pnpm install --frozen-lockfile` (CI mode)
4. Builds the `@timeskein/contracts` package
5. Runs `pnpm tauri build` inside `apps/desktop`

Build artifacts land in `apps/desktop/src-tauri/target/release/bundle/`.

## Building from WSL

The WSL wrapper (`build-win.sh`) converts paths and delegates to `build-win.cmd` via `cmd.exe`.

**Important:** The repository **must** be on a Windows filesystem mount (e.g. `/mnt/c/...`).
If the repo is on the WSL filesystem (`~/projects/...`), the Windows build tools cannot access the files. The script detects this and prints an error.

```bash
# Good: repo on Windows drive
cd /mnt/c/Users/yourname/git/timeskein
./scripts/build-win.sh

# Bad: repo on WSL filesystem (will fail)
cd ~/git/timeskein
./scripts/build-win.sh
# ERROR: Repository is on the WSL filesystem.
```

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) uses the same `scripts\build-win.cmd` entrypoint on a `windows-latest` runner.

## Troubleshooting

### "vswhere.exe not found"

Visual Studio Build Tools not installed, or installed in a non-standard location.
Install from https://visualstudio.microsoft.com/visual-cpp-build-tools/ with the "Desktop development with C++" workload.

### "No Visual Studio installation with C++ tools found"

Build Tools installed but without the C++ workload. Re-run the Visual Studio Installer, modify the installation, and add "Desktop development with C++".

### "vcvars64.bat not found"

Partial installation. Re-install Build Tools with the full C++ workload.

### "link.exe" is Git's link.exe, not MSVC

The build script calls `vcvars64.bat` which prepends the correct MSVC directories to PATH. If you still get link errors, make sure nothing else is re-ordering PATH after vcvars runs.

### "Repository is on the WSL filesystem"

Move or clone the repo to `/mnt/c/Users/yourname/git/timeskein` (or another Windows drive mount). Windows build tools cannot traverse `\\wsl$\...` paths reliably.

### "Mixed node_modules (Linux/Windows)"

If you previously ran `pnpm install` on Linux/WSL and then try to build on Windows (or vice versa), native modules may be incompatible. Fix:

```bash
rm -rf node_modules apps/desktop/node_modules packages/*/node_modules
pnpm install
```

### Tauri build fails with "failed to bundle project"

Check that:
- Icons exist in `apps/desktop/src-tauri/icons/` (32x32.png, 128x128.png, icon.ico)
- `tauri.conf.json` points to valid icon paths
- The frontend builds successfully (`pnpm --filter @timeskein/desktop build:frontend`)
