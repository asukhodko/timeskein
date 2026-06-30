//! Timeskein Agent Library
//!
//! Exposes modules for testing and embedding.

pub mod api;
pub mod db;
pub mod domain;
pub mod runtime;

use crate::db::Database;

/// Application state shared across handlers
pub struct AppState {
    pub db: Database,
    pub start_time: std::time::Instant,
}
