@echo off
setlocal enabledelayedexpansion

rem ==========================================================================
rem  Timeskein Windows Build Entrypoint
rem  Usage: scripts\build-win.cmd [--release] [--debug] [--app <path>]
rem
rem  This script:
rem    1. Finds Visual Studio via vswhere and sets up MSVC environment
rem    2. Installs pnpm dependencies (CI mode)
rem    3. Builds the Tauri desktop application
rem
rem  Can be run from any working directory.
rem ==========================================================================

rem -- Resolve repo root (directory containing this script's parent) ---------
pushd "%~dp0.."
set "REPO_ROOT=%CD%"
popd

echo [timeskein] Repo root: %REPO_ROOT%

rem -- Configuration ---------------------------------------------------------
set "BUILD_MODE=--release"
set "TAURI_APP_DIR=%REPO_ROOT%\apps\desktop"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--debug" (
    set "BUILD_MODE=--debug"
    shift
    goto parse_args
)
if /i "%~1"=="--release" (
    set "BUILD_MODE=--release"
    shift
    goto parse_args
)
if /i "%~1"=="--app" (
    if "%~2"=="" (
        echo [timeskein] ERROR: --app requires a path argument
        exit /b 1
    )
    set "TAURI_APP_DIR=%~2"
    shift
    shift
    goto parse_args
)
echo [timeskein] WARNING: Unknown argument: %~1
shift
goto parse_args
:args_done

echo [timeskein] Build mode: %BUILD_MODE%
echo [timeskein] Tauri app dir: %TAURI_APP_DIR%

rem -- Verify Tauri app directory exists -------------------------------------
if not exist "%TAURI_APP_DIR%\src-tauri\tauri.conf.json" (
    echo [timeskein] ERROR: tauri.conf.json not found at %TAURI_APP_DIR%\src-tauri\tauri.conf.json
    echo [timeskein] Check --app path or TAURI_APP_DIR environment variable
    exit /b 1
)

rem -- Step 1: Find Visual Studio via vswhere --------------------------------
echo.
echo [timeskein] === Step 1: Setting up MSVC environment ===

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"

if not exist "%VSWHERE%" (
    echo [timeskein] ERROR: vswhere.exe not found at:
    echo   %VSWHERE%
    echo.
    echo [timeskein] Install Visual Studio Build Tools:
    echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo   Required workload: "Desktop development with C++"
    exit /b 1
)

rem -- Find latest VS installation with C++ tools ----------------------------
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "VS_INSTALL_DIR=%%i"
)

if not defined VS_INSTALL_DIR (
    echo [timeskein] ERROR: No Visual Studio installation with C++ tools found.
    echo.
    echo [timeskein] Install Visual Studio Build Tools with "Desktop development with C++" workload.
    exit /b 1
)

echo [timeskein] Found VS at: %VS_INSTALL_DIR%

rem -- Activate x64 MSVC environment ----------------------------------------
set "VCVARS=%VS_INSTALL_DIR%\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" (
    echo [timeskein] ERROR: vcvars64.bat not found at:
    echo   %VCVARS%
    echo.
    echo [timeskein] The C++ workload may not be fully installed.
    exit /b 1
)

echo [timeskein] Activating x64 MSVC environment...
call "%VCVARS%" >nul 2>&1
if errorlevel 1 (
    echo [timeskein] ERROR: vcvars64.bat failed.
    exit /b 1
)

rem -- Verify link.exe is MSVC (not Git) ------------------------------------
where link.exe >nul 2>&1
if errorlevel 1 (
    echo [timeskein] ERROR: link.exe not found after vcvars activation.
    exit /b 1
)

echo [timeskein] MSVC environment ready.

rem -- Step 2: Check prerequisites -------------------------------------------
echo.
echo [timeskein] === Step 2: Checking prerequisites ===

where node >nul 2>&1
if errorlevel 1 (
    echo [timeskein] ERROR: node not found. Install Node.js 20+
    echo   https://nodejs.org/
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo [timeskein] Node: %%v

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [timeskein] ERROR: pnpm not found. Install pnpm 9+
    echo   npm install -g pnpm
    exit /b 1
)

for /f "tokens=*" %%v in ('pnpm --version') do echo [timeskein] pnpm: %%v

where rustc >nul 2>&1
if errorlevel 1 (
    echo [timeskein] ERROR: rustc not found. Install Rust (MSVC toolchain)
    echo   https://rustup.rs/
    exit /b 1
)

for /f "tokens=*" %%v in ('rustc --version') do echo [timeskein] Rust: %%v

rem -- Step 3: Install dependencies ------------------------------------------
echo.
echo [timeskein] === Step 3: Installing dependencies ===

pushd "%REPO_ROOT%"
set "CI=true"
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo [timeskein] WARNING: --frozen-lockfile failed, retrying without...
    call pnpm install
    if errorlevel 1 (
        echo [timeskein] ERROR: pnpm install failed.
        popd
        exit /b 1
    )
)
popd

rem -- Step 4: Build contracts -----------------------------------------------
echo.
echo [timeskein] === Step 4: Building contracts ===

pushd "%REPO_ROOT%"
call pnpm --filter @timeskein/contracts build
if errorlevel 1 (
    echo [timeskein] ERROR: contracts build failed.
    popd
    exit /b 1
)
popd

rem -- Step 5: Build Tauri app -----------------------------------------------
echo.
echo [timeskein] === Step 5: Building Tauri desktop app ===

pushd "%TAURI_APP_DIR%"
call pnpm tauri build %BUILD_MODE%
if errorlevel 1 (
    echo [timeskein] ERROR: Tauri build failed.
    popd
    exit /b 1
)
popd

rem -- Done ------------------------------------------------------------------
echo.
echo [timeskein] === Build complete ===
echo [timeskein] Artifacts in: %TAURI_APP_DIR%\src-tauri\target\release\bundle\

exit /b 0
