//! Timeskein Agent - Main Entry Point
//!
//! Local-first work inventory backend with SQLite storage and Local API.

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::RwLock;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use timeskein_agent::api::create_router;
use timeskein_agent::db::Database;
use timeskein_agent::domain::{AppEvent, AppEventKind, AppEventSource};
use timeskein_agent::runtime::{ensure_data_dir, write_port_file, SingleInstanceLock};
use timeskein_agent::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let _subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .with_thread_ids(false)
        .compact()
        .init();

    info!("Starting Timeskein Agent v{}", env!("CARGO_PKG_VERSION"));

    // Ensure data directory exists
    let data_dir = ensure_data_dir()?;
    info!("Data directory: {}", data_dir.display());

    // Acquire single-instance lock
    let _lock = SingleInstanceLock::acquire(&data_dir)?;
    info!("Single-instance lock acquired");

    // Initialize database
    let db_path = data_dir.join("timeskein.db");
    let db = Database::new(&db_path).await?;
    let _ = db
        .log_app_event(&AppEvent::new(
            AppEventSource::Agent,
            AppEventKind::AgentStarted,
        ))
        .await;
    info!("Database initialized: {}", db_path.display());

    // Create application state
    let state = Arc::new(RwLock::new(AppState {
        db,
        start_time: std::time::Instant::now(),
    }));

    // Build router
    let app = create_router(state);

    // Find available port and start server
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let actual_addr = listener.local_addr()?;

    // Write port file for UI discovery
    write_port_file(&data_dir, actual_addr.port())?;

    info!("Timeskein Agent listening on http://{}", actual_addr);
    info!("API endpoint: POST http://{}/api", actual_addr);

    // Run server
    axum::serve(listener, app).await?;

    Ok(())
}
