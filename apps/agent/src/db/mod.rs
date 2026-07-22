//! Database module - SQLite persistence layer

mod app_events;
mod captures;
mod connection;
mod day_contracts;
mod day_events;
mod evidence;
mod focus_sessions;
mod operational_reality;
mod refs;
mod semantics;
mod settings;
mod work_items;
mod working_memory;

pub use connection::Database;
pub use operational_reality::causal_record_views;
