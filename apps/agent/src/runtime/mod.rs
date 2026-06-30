//! Runtime module - Lifecycle and single-instance management

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use tracing::info;

/// Get the data directory path
pub fn get_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Timeskein")
}

/// Ensure data directory exists
pub fn ensure_data_dir() -> Result<PathBuf> {
    let data_dir = get_data_dir();

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .with_context(|| format!("Failed to create data directory: {}", data_dir.display()))?;
        info!("Created data directory: {}", data_dir.display());
    }

    Ok(data_dir)
}

/// Write port file for UI discovery
pub fn write_port_file(data_dir: &PathBuf, port: u16) -> Result<()> {
    let port_file = data_dir.join("agent.port");
    fs::write(&port_file, port.to_string())
        .with_context(|| format!("Failed to write port file: {}", port_file.display()))?;
    info!("Port file written: {} -> {}", port_file.display(), port);
    Ok(())
}

/// Read port from port file
pub fn read_port_file(data_dir: &PathBuf) -> Result<Option<u16>> {
    let port_file = data_dir.join("agent.port");

    if !port_file.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&port_file)
        .with_context(|| format!("Failed to read port file: {}", port_file.display()))?;

    let port: u16 = content
        .trim()
        .parse()
        .with_context(|| format!("Invalid port in port file: {}", content))?;

    Ok(Some(port))
}

/// Single-instance lock
pub struct SingleInstanceLock {
    lock_path: PathBuf,
}

impl SingleInstanceLock {
    /// Acquire the single-instance lock
    pub fn acquire(data_dir: &PathBuf) -> Result<Self> {
        let lock_path = data_dir.join("agent.lock");

        // Check if lock file exists and if process is still running
        if lock_path.exists() {
            // Try to read PID from lock file
            if let Ok(content) = fs::read_to_string(&lock_path) {
                if let Ok(pid) = content.trim().parse::<u32>() {
                    if is_process_running(pid) {
                        anyhow::bail!("Another instance is already running (PID: {})", pid);
                    }
                }
            }
            // Stale lock, remove it
            fs::remove_file(&lock_path).ok();
        }

        // Write current PID to lock file
        let pid = std::process::id();
        fs::write(&lock_path, pid.to_string())
            .with_context(|| format!("Failed to write lock file: {}", lock_path.display()))?;

        Ok(Self { lock_path })
    }
}

impl Drop for SingleInstanceLock {
    fn drop(&mut self) {
        // Remove lock file on exit
        fs::remove_file(&self.lock_path).ok();
    }
}

/// Check if a process is running
#[cfg(windows)]
fn is_process_running(pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => {
                let _ = CloseHandle(handle);
                true
            }
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
fn is_process_running(pid: u32) -> bool {
    use std::process::Command;

    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}
